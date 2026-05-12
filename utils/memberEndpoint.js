/**
 * HTTP endpoint for the member onboarding Apps Script.
 *
 * Add this to your existing discord.js bot. Call setupMemberEndpoint(client)
 * after your bot is logged in.
 *
 * Environment variables required:
 *   ONBOARD_PORT           - port to listen on (e.g. 25599 for PebbleHost)
 *   ONBOARD_SECRET         - shared secret; must match DISCORD_BOT_SECRET in Apps Script
 *   STAFF_CHAT_CHANNEL_ID  - channel ID where /members/report posts its summary embed
 *
 * Routes:
 *   POST /members/add     - triggers role sync; body ignored (cap 8 KB)
 *   POST /members/report  - posts an onboarding summary embed to the staff channel
 *                           (JSON body, cap 16 KB)
 *
 * Both routes use Bearer auth with ONBOARD_SECRET.
 *
 * Response (success): 200 { ok: true, ... }
 * Response (failure): 4xx/5xx { ok: false, error: "..." }
 */

const http = require('http');
const { EmbedBuilder } = require('discord.js');
const { performRoleSync } = require('../commands/admin/syncroles');

function setupMemberEndpoint(client) {
	const port = parseInt(process.env.ONBOARD_PORT, 10);
	const secret = process.env.ONBOARD_SECRET;

	if (!port || !secret) {
		console.error('[onboard] ONBOARD_PORT and ONBOARD_SECRET must be set; endpoint disabled.');
		return;
	}

	const server = http.createServer((req, res) => {
		if (req.method !== 'POST') {
			return sendJson(res, 404, { ok: false, error: 'Not found' });
		}

		const isAdd = req.url === '/members/add';
		const isReport = req.url === '/members/report';
		if (!isAdd && !isReport) {
			return sendJson(res, 404, { ok: false, error: 'Not found' });
		}

		// Auth check (constant-time comparison to avoid timing attacks)
		const authHeader = req.headers['authorization'] || '';
		const expected = 'Bearer ' + secret;
		if (!safeEqual(authHeader, expected)) {
			return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
		}

		// /members/add ignores the body; /members/report parses JSON up to 16 KB.
		const sizeCap = isReport ? 16384 : 8192;
		let body = '';
		let tooLarge = false;
		req.on('data', chunk => {
			body += chunk;
			if (body.length > sizeCap) {
				tooLarge = true;
				req.destroy();
			}
		});
		req.on('end', async () => {
			if (tooLarge) {
				return sendJson(res, 413, { ok: false, error: 'Payload too large' });
			}

			if (isAdd) {
				try {
					const detail = await handleAddMember(client);
					sendJson(res, 200, { ok: true, detail: detail });
				}
				catch (e) {
					console.error('[onboard] handleAddMember failed:', e);
					sendJson(res, 500, { ok: false, error: String(e.message || e) });
				}
				return;
			}

			// /members/report
			let report;
			try {
				report = JSON.parse(body);
			}
			catch {
				return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
			}

			try {
				await handlePostReport(client, report);
				sendJson(res, 200, { ok: true });
			}
			catch (e) {
				console.error('[onboard] handlePostReport failed:', e);
				sendJson(res, 500, { ok: false, error: String(e.message || e) });
			}
		});
		req.on('error', err => {
			console.error('[onboard] request error:', err);
		});
	});

	server.listen(port, () => {
		console.log('[onboard] listening on port ' + port);
	});

	server.on('error', err => {
		console.error('[onboard] server error:', err);
	});
}

/**
 * Calls the existing syncroles logic to update member roles
 */
async function handleAddMember(client) {
	// Call the syncroles method
	const guild = client.guilds.cache.first();
	if (!guild) {
		return 'No guilds found; skipping sync.';
	}

	try {
		const result = await performRoleSync(guild);

		if (result.success && result.embed) {
			const logChannelId = process.env.LOG_CHANNEL_ID;
			if (logChannelId) {
				const logChannel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
				if (logChannel) {
					await logChannel.send({
						content: `🔄 Automatic role sync triggered by member onboarding:`,
						embeds: [result.embed],
					});
				}
			}
			return 'Synced roles successfully';
		}
		else {
			return `Sync failed: ${result.message || 'Unknown error'}`;
		}
	}
	catch (e) {
		console.error('[onboard] Error during automatic role sync:', e);
		return `Sync failed: ${e.message}`;
	}
}

// ---------- /members/report ----------

const COLOR_GREEN = 0x2ECC71;
const COLOR_YELLOW = 0xF1C40F;
const COLOR_RED = 0xE74C3C;

const FIELD_VALUE_LIMIT = 1024;

const statusLine = (step) =>
	(step.ok ? '✅ ' : '❌ ') + (step.detail || (step.ok ? 'ok' : 'failed'));

const truncate = (s, n) => (!s || s.length <= n) ? s : s.slice(0, n - 1) + '…';

function buildReportEmbed(report) {
	const steps = report.steps || {};
	const lookup = steps.lookup || { ok: false, detail: '' };
	const tracker = steps.tracker || { ok: false, detail: '' };
	const membership = steps.membership || { ok: false, detail: '' };
	const sort = steps.sort || { ok: false, detail: '' };
	const form = steps.form || { ok: false, detail: '' };
	const drive = steps.drive || { ok: false, results: [] };
	const bot = steps.bot || { ok: false, detail: '' };

	const crashed = !!report.crashed;
	const allOk = lookup.ok && tracker.ok && membership.ok && sort.ok && form.ok && drive.ok && bot.ok;

	let title;
	if (crashed) {
		title = `❌ New member: ${report.memberName} (crashed)`;
	}
	else if (allOk) {
		title = `✅ New member: ${report.memberName}`;
	}
	else {
		title = `⚠️ New member: ${report.memberName}`;
	}

	let color;
	if (crashed || !lookup.ok) {
		color = COLOR_RED;
	}
	else if (allOk) {
		color = COLOR_GREEN;
	}
	else {
		color = COLOR_YELLOW;
	}

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setColor(color);

	embed.addFields(
		{ name: 'Lookup (info sheet)', value: statusLine(lookup), inline: false },
		{ name: 'Tracker tab', value: statusLine(tracker), inline: true },
		{ name: 'Membership Status tab', value: statusLine(membership), inline: true },
		{ name: 'Alphabetical sort', value: statusLine(sort), inline: false },
		{ name: 'Hour request form update', value: statusLine(form), inline: false },
	);

	const driveResults = Array.isArray(drive.results) ? drive.results : [];
	let driveValue;
	if (driveResults.length === 0) {
		driveValue = '_no emails_';
	}
	else {
		const lines = driveResults.map(r =>
			r.ok ? `✅ ${r.email}` : `❌ ${r.email} — ${r.detail || 'failed'}`,
		);
		driveValue = lines.join('\n');
		if (driveValue.length > FIELD_VALUE_LIMIT) {
			driveValue = driveValue.slice(0, FIELD_VALUE_LIMIT - 1) + '…';
		}
	}
	embed.addFields({ name: 'Shared drive', value: driveValue, inline: false });

	let botValue = statusLine(bot);
	if (!bot.ok) {
		botValue += '\n⚠️ Run the slash command manually for this member.';
	}
	embed.addFields({ name: 'Discord bot command', value: truncate(botValue, FIELD_VALUE_LIMIT), inline: false });

	if (crashed) {
		const crashValue = truncate(report.crashDetail || '', FIELD_VALUE_LIMIT) || '_no detail_';
		embed.addFields({ name: 'Crash detail', value: crashValue, inline: false });
	}

	if (report.adminEmail) {
		embed.setFooter({ text: `Initiated by ${report.adminEmail}` });
	}

	if (report.timestamp) {
		const d = new Date(report.timestamp);
		if (!isNaN(d.getTime())) {
			embed.setTimestamp(d);
		}
	}

	return embed;
}

async function handlePostReport(client, report) {
	const channelId = process.env.STAFF_CHAT_CHANNEL_ID;
	if (!channelId) throw new Error('STAFF_CHAT_CHANNEL_ID not configured');

	const channel = await client.channels.fetch(channelId);
	if (!channel || !channel.isTextBased()) {
		throw new Error('Report channel not found or not text-based');
	}

	const embed = buildReportEmbed(report);
	await channel.send({ embeds: [embed] });
}

// ---------- helpers ----------

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(body),
	});
	res.end(body);
}

function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

module.exports = { setupMemberEndpoint };
