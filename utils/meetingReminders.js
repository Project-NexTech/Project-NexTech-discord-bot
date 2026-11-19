const ical = require('node-ical');
const { ChannelType, ThreadAutoArchiveDuration } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const stateFilePath = path.join(__dirname, '..', 'data', 'meeting-reminders.json');
const DEFAULT_CHANNEL_ID = '1233599250131193996';
const DEFAULT_HOURS_BEFORE = 24;
const KEEP_SENT_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;

const sentReminders = new Map();
let syncInProgress = false;

function loadState() {
	try {
		if (fs.existsSync(stateFilePath)) {
			const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
			sentReminders.clear();
			for (const [key, startISO] of Object.entries(data.sent || {})) {
				sentReminders.set(key, startISO);
			}
			console.log(`[MeetingReminders] Loaded ${sentReminders.size} sent reminder(s) from file`);
		}
	}
	catch (error) {
		console.error('[MeetingReminders] Error loading state file:', error);
	}
}

function persistState() {
	try {
		fs.writeFileSync(stateFilePath, JSON.stringify({ sent: Object.fromEntries(sentReminders) }, null, 2), 'utf8');
	}
	catch (error) {
		console.error('[MeetingReminders] Error saving state file:', error);
	}
}

function getHoursBefore() {
	const parsed = parseFloat(process.env.MEETING_REMINDER_HOURS_BEFORE);
	return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_HOURS_BEFORE : parsed;
}

function getCalendarUrl(calendarId) {
	return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

function cleanDescription(text) {
	return String(text || '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function getZoneOffsetMs(timestamp, timeZone) {
	const parts = {};
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
	for (const { type, value } of formatter.formatToParts(new Date(timestamp))) {
		parts[type] = value;
	}
	const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
	return asUtc - Math.floor(timestamp / 1000) * 1000;
}

function wallTimeToInstant(floatingDate, timeZone) {
	if (!timeZone) return floatingDate;
	try {
		const wall = floatingDate.getTime();
		let instant = wall - getZoneOffsetMs(wall, timeZone);
		instant = wall - getZoneOffsetMs(instant, timeZone);
		return new Date(instant);
	}
	catch {
		return floatingDate;
	}
}

function isAllDay(event) {
	return event.datetype === 'date' || event.start?.dateOnly === true;
}

function toOccurrence(event, start) {
	const durationMs = event.end ? event.end.getTime() - event.start.getTime() : 0;
	return {
		uid: event.uid,
		summary: event.summary || 'Untitled meeting',
		description: cleanDescription(event.description),
		location: event.location || '',
		start,
		end: new Date(start.getTime() + durationMs),
	};
}

function getOccurrences(event, from, to) {
	if (event.type !== 'VEVENT' || !event.start || isAllDay(event)) return [];

	if (!event.rrule) {
		return event.start >= from && event.start <= to ? [toOccurrence(event, event.start)] : [];
	}

	const timeZone = event.rrule.origOptions?.tzid;
	const excluded = new Set(Object.values(event.exdate || {}).map(date => new Date(date).getTime()));
	const overrides = Object.values(event.recurrences || {});
	const overriddenStarts = new Set(overrides
		.filter(override => override.recurrenceid)
		.map(override => new Date(override.recurrenceid).getTime()));

	const dayMs = 24 * 60 * 60 * 1000;
	const occurrences = [];
	for (const floating of event.rrule.between(new Date(from.getTime() - dayMs), new Date(to.getTime() + dayMs), true)) {
		const start = wallTimeToInstant(floating, timeZone);
		if (start < from || start > to) continue;
		if (excluded.has(start.getTime()) || overriddenStarts.has(start.getTime())) continue;
		occurrences.push(toOccurrence(event, start));
	}

	for (const override of overrides) {
		if (override.status === 'CANCELLED' || !override.start || isAllDay(override)) continue;
		if (override.start >= from && override.start <= to) {
			occurrences.push(toOccurrence({ ...event, ...override }, override.start));
		}
	}

	return occurrences;
}

function isReminderEvent(occurrence) {
	return /\bremind/i.test(`${occurrence.summary}\n${occurrence.description}`);
}

function normalizeName(value) {
	return value.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveRole(guild, description) {
	for (const match of description.matchAll(/\bremind\b[ \t:-]*(?:all[ \t]+)?(?:the[ \t]+)?([^\n]*)/gi)) {
		const phrase = normalizeName(match[1]);
		if (!phrase) continue;

		const aliasMatch = phrase.match(/^(ec|bd)\b/);
		if (aliasMatch) {
			const roleId = aliasMatch[1] === 'ec' ? process.env.EC_ROLE_ID : process.env.BD_ROLE_ID;
			const role = roleId ? guild.roles.cache.get(roleId) : null;
			if (role) return role;
		}

		let best = null;
		for (const role of guild.roles.cache.values()) {
			if (role.id === guild.id || role.managed) continue;
			const name = normalizeName(role.name);
			if (!name) continue;
			const startsWithName = phrase === name || phrase.startsWith(`${name} `)
				|| phrase === `${name}s` || phrase.startsWith(`${name}s `);
			if (startsWithName && (!best || name.length > normalizeName(best.name).length)) {
				best = role;
			}
		}
		if (best) return best;

		console.warn(`[MeetingReminders] No role matches "${match[1].trim()}" — posting without a ping`);
		return null;
	}
	return null;
}

async function fetchTextChannel(guild, id) {
	const channel = await guild.channels.fetch(id).catch(() => null);
	return channel?.guildId === guild.id && channel.isTextBased() ? channel : null;
}

async function resolveChannel(guild, description) {
	for (const [id] of description.matchAll(/\b\d{17,20}\b/g)) {
		const channel = await fetchTextChannel(guild, id);
		if (channel) return channel;
	}

	const defaultId = process.env.MEETING_REMINDER_DEFAULT_CHANNEL_ID || DEFAULT_CHANNEL_ID;
	const channel = await fetchTextChannel(guild, defaultId);
	if (channel) return channel;

	console.error(`[MeetingReminders] Default channel ${defaultId} not found or not a text channel`);
	return null;
}

function normalizeVoiceName(name) {
	return normalizeName(name.replace(/\([^)]*\)/g, ''));
}

function resolveVoiceChannels(guild, occurrence) {
	const text = `${occurrence.summary}\n${occurrence.description}\n${occurrence.location}`;
	const voiceChannels = [...guild.channels.cache.values()]
		.filter(channel => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type));

	const found = new Map();
	for (const match of text.matchAll(/((?:[\w'-]+[ \t]+)?[\w'-]+)[ \t]+(?:vc|voice(?:[ \t]+(?:channel|chat))?)\b/gi)) {
		const words = normalizeName(match[1]).split(' ');
		for (const candidate of [words.join(' '), words[words.length - 1]]) {
			const channel = voiceChannels.find(vc => normalizeVoiceName(vc.name) === candidate);
			if (channel) {
				found.set(channel.id, channel);
				break;
			}
		}
	}
	return [...found.values()];
}

function getMeetingDetails(description) {
	return description
		.split('\n')
		.filter(line => !/^\s*(automated\s+)?remind/i.test(line))
		.filter(line => !/^\s*(channel(\s*id)?\s*[:#-]?\s*)?<?#?\d{17,20}>?\s*$/i.test(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

async function postDetailsThread(message, occurrence) {
	const details = getMeetingDetails(occurrence.description);
	if (!details) return;
	if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(message.channel.type)) return;

	try {
		const thread = await message.startThread({
			name: occurrence.summary.slice(0, 100),
			autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
		});
		const content = details.length > MAX_MESSAGE_LENGTH ? `${details.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : details;
		await thread.send({ content, allowedMentions: { parse: [] } });
	}
	catch (error) {
		console.error(`[MeetingReminders] Failed to create details thread for "${occurrence.summary}":`, error.message);
	}
}

function buildReminderMessage(occurrence, role, voiceChannels) {
	const unix = Math.floor(occurrence.start.getTime() / 1000);
	const lines = [
		`${role ? `${role} ` : ''}**Reminder:** ${occurrence.summary}`,
		`🕒 <t:${unix}:F> (<t:${unix}:R>)`,
	];
	if (occurrence.location) lines.push(`📍 ${occurrence.location}`);
	if (voiceChannels.length) lines.push(`🔊 ${voiceChannels.map(channel => `<#${channel.id}>`).join(' ')}`);
	return lines.join('\n');
}

async function syncMeetingReminders(client) {
	if (syncInProgress) return;
	syncInProgress = true;

	try {
		const calendarId = process.env.MEETING_REMINDER_CALENDAR_ID;
		const guild = await client.guilds.fetch(process.env.GUILD_ID);
		await guild.roles.fetch();
		await guild.channels.fetch();

		let events;
		try {
			events = await ical.async.fromURL(getCalendarUrl(calendarId));
		}
		catch (error) {
			console.error('[MeetingReminders] Error fetching calendar:', error.message);
			return;
		}

		const now = new Date();
		const remindWindowEnd = new Date(now.getTime() + getHoursBefore() * 60 * 60 * 1000);
		let changed = false;

		for (const event of Object.values(events)) {
			for (const occurrence of getOccurrences(event, now, remindWindowEnd)) {
				if (!isReminderEvent(occurrence)) continue;

				const key = `${occurrence.uid}|${occurrence.start.toISOString()}`;
				if (sentReminders.has(key)) continue;

				const channel = await resolveChannel(guild, occurrence.description);
				if (!channel) continue;
				const role = resolveRole(guild, occurrence.description);

				let message;
				try {
					message = await channel.send({
						content: buildReminderMessage(occurrence, role, resolveVoiceChannels(guild, occurrence)),
						allowedMentions: { roles: role ? [role.id] : [] },
					});
				}
				catch (error) {
					console.error(`[MeetingReminders] Failed to send reminder for "${occurrence.summary}":`, error.message);
					continue;
				}

				sentReminders.set(key, occurrence.start.toISOString());
				persistState();
				console.log(`[MeetingReminders] Reminded #${channel.name} about "${occurrence.summary}" (${occurrence.start.toISOString()})`);
				await postDetailsThread(message, occurrence);
			}
		}

		for (const [key, startISO] of sentReminders) {
			if (new Date(startISO).getTime() < now.getTime() - KEEP_SENT_MS) {
				sentReminders.delete(key);
				changed = true;
			}
		}

		if (changed) persistState();
	}
	catch (error) {
		console.error('[MeetingReminders] Error during sync:', error);
	}
	finally {
		syncInProgress = false;
	}
}

function startMeetingReminders(client, intervalMinutes) {
	console.log(`[MeetingReminders] Checking calendar every ${intervalMinutes} minute(s), reminding ${getHoursBefore()} hour(s) ahead`);
	loadState();
	syncMeetingReminders(client);
	setInterval(() => syncMeetingReminders(client), intervalMinutes * 60 * 1000);
}

module.exports = {
	startMeetingReminders,
	syncMeetingReminders,
	getOccurrences,
};
