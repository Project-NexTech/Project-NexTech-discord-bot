const ical = require('node-ical');
const { GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// Store mapping of calendar event UIDs to Discord event IDs
const eventMapping = new Map();
const mappingFilePath = path.join(__dirname, '..', 'event-mapping.json');

/**
 * Loads the event mapping from file
 */
function loadEventMapping() {
	try {
		if (fs.existsSync(mappingFilePath)) {
			const data = fs.readFileSync(mappingFilePath, 'utf8');
			const obj = JSON.parse(data);
			eventMapping.clear();
			for (const [key, value] of Object.entries(obj)) {
				eventMapping.set(key, value);
			}
			console.log(`[CalendarSync] Loaded ${eventMapping.size} event mapping(s) from file`);
		}
	} catch (error) {
		console.error('[CalendarSync] Error loading event mapping:', error);
	}
}

/**
 * Saves the event mapping to file
 */
function saveEventMapping() {
	try {
		const obj = Object.fromEntries(eventMapping);
		fs.writeFileSync(mappingFilePath, JSON.stringify(obj, null, 2), 'utf8');
	} catch (error) {
		console.error('[CalendarSync] Error saving event mapping:', error);
	}
}

/**
 * Fetches and parses the iCal calendar
 * @param {string} calendarUrl - The iCal URL to fetch
 * @returns {Promise<Array>} Array of calendar events
 */
async function fetchCalendarEvents(calendarUrl) {
	try {
		const events = await ical.async.fromURL(calendarUrl);
		const infoSessions = [];

		for (const event of Object.values(events)) {
			// Only process VEVENT type events that contain "Info Session"
			if (event.type === 'VEVENT' && event.summary && event.summary.includes('Info Session')) {
				infoSessions.push({
					uid: event.uid,
					summary: event.summary,
					start: event.start,
					end: event.end,
					description: event.description || '',
					location: event.location || '',
				});
			}
		}

		return infoSessions;
	} catch (error) {
		console.error('[CalendarSync] Error fetching calendar:', error);
		return [];
	}
}

/**
 * Creates a Discord scheduled event
 * @param {Guild} guild - The Discord guild
 * @param {Object} calendarEvent - The calendar event data
 * @returns {Promise<GuildScheduledEvent>} The created Discord event
 */
async function createDiscordEvent(guild, calendarEvent) {
	try {
		const stageChannelId = process.env.INFO_SESSION_CHANNEL_ID_ID; // Using the correct env variable
		
		if (!stageChannelId) {
			console.error('[CalendarSync] INFO_SESSION_CHANNEL_ID_ID not found in environment variables');
			return null;
		}
		
		// Fetch the actual channel object to ensure it's valid
		const stageChannel = await guild.channels.fetch(stageChannelId);
		
		if (!stageChannel) {
			console.error(`[CalendarSync] Could not fetch channel with ID: ${stageChannelId}`);
			return null;
		}
		
		if (stageChannel.type !== 13) { // 13 = GUILD_STAGE_VOICE
			console.error(`[CalendarSync] Channel ${stageChannelId} is not a stage channel (type: ${stageChannel.type})`);
			return null;
		}
		
		// Get banner image (supports both URL and local file path)
		let bannerImage = null;
		const bannerSource = process.env.INFO_SESSION_BANNER_URL;
		
		if (bannerSource) {
			// Check if it's a URL or local file path
			if (bannerSource.startsWith('http://') || bannerSource.startsWith('https://')) {
				// It's a URL, use it directly
				bannerImage = bannerSource;
			} else {
				// It's a local file path, read and convert to base64
				try {
					const bannerPath = path.isAbsolute(bannerSource) 
						? bannerSource 
						: path.join(__dirname, '..', bannerSource);
					
					if (fs.existsSync(bannerPath)) {
						const imageBuffer = fs.readFileSync(bannerPath);
						const base64Image = imageBuffer.toString('base64');
						const ext = path.extname(bannerPath).slice(1).toLowerCase();
						const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
						bannerImage = `data:${mimeType};base64,${base64Image}`;
					} else {
						console.warn(`[CalendarSync] Banner image not found at: ${bannerPath}`);
					}
				} catch (error) {
					console.error('[CalendarSync] Error reading banner image:', error);
				}
			}
		}
		
		const discordEvent = await guild.scheduledEvents.create({
			name: 'Project NexTech Info Session',
			description: `placeholder description`,
			scheduledStartTime: calendarEvent.start,
			scheduledEndTime: calendarEvent.end,
			privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
			entityType: GuildScheduledEventEntityType.StageInstance,
			channel: stageChannel, // Pass the channel object instead of ID
			image: bannerImage, // Set banner image from URL or base64
		});

		eventMapping.set(calendarEvent.uid, discordEvent.id);
		saveEventMapping(); // Persist to file
		console.log(`[CalendarSync] Created Discord event for: ${calendarEvent.summary}`);
		return discordEvent;
	} catch (error) {
		console.error('[CalendarSync] Error creating Discord event:', error);
		return null;
	}
}

/**
 * Updates an existing Discord scheduled event
 * @param {Guild} guild - The Discord guild
 * @param {string} discordEventId - The Discord event ID
 * @param {Object} calendarEvent - The updated calendar event data
 * @returns {Promise<GuildScheduledEvent>} The updated Discord event
 */
async function updateDiscordEvent(guild, discordEventId, calendarEvent) {
	try {
		const discordEvent = await guild.scheduledEvents.fetch(discordEventId);
		
		// Check if times have changed
		const startChanged = discordEvent.scheduledStartAt.getTime() !== calendarEvent.start.getTime();
		const endChanged = discordEvent.scheduledEndAt?.getTime() !== calendarEvent.end.getTime();

		if (startChanged || endChanged) {
			await discordEvent.edit({
				scheduledStartTime: calendarEvent.start,
				scheduledEndTime: calendarEvent.end,
			});
			console.log(`[CalendarSync] Updated Discord event times for: ${calendarEvent.summary}`);
		}

		return discordEvent;
	} catch (error) {
		console.error('[CalendarSync] Error updating Discord event:', error);
		return null;
	}
}

/**
 * Deletes a Discord scheduled event
 * @param {Guild} guild - The Discord guild
 * @param {string} discordEventId - The Discord event ID
 * @returns {Promise<void>}
 */
async function deleteDiscordEvent(guild, discordEventId) {
	try {
		const discordEvent = await guild.scheduledEvents.fetch(discordEventId);
		await discordEvent.delete();
		console.log(`[CalendarSync] Deleted Discord event: ${discordEvent.name}`);
	} catch (error) {
		console.error('[CalendarSync] Error deleting Discord event:', error);
	}
}

/**
 * Synchronizes calendar events with Discord scheduled events
 * @param {Client} client - The Discord client
 * @returns {Promise<void>}
 */
async function syncCalendarEvents(client) {
	const calendarUrl = process.env.CALENDAR_ICAL_URL;
	const guildId = process.env.GUILD_ID;

	if (!calendarUrl) {
		console.error('[CalendarSync] CALENDAR_ICAL_URL not found in environment variables');
		return;
	}

	if (!guildId) {
		console.error('[CalendarSync] GUILD_ID not found in environment variables');
		return;
	}

	try {
		const guild = await client.guilds.fetch(guildId);
		const calendarEvents = await fetchCalendarEvents(calendarUrl);
		const currentCalendarUids = new Set(calendarEvents.map(e => e.uid));

		// Fetch all existing Discord scheduled events
		const discordEvents = await guild.scheduledEvents.fetch();
		
		// Filter for our managed events (Project NexTech Info Session)
		const managedDiscordEvents = discordEvents.filter(
			event => event.name === 'Project NexTech Info Session'
		);

		// Process calendar events
		for (const calendarEvent of calendarEvents) {
			// Skip past events (more than 1 hour ago)
			if (calendarEvent.start < new Date(Date.now() - 3600000)) {
				continue;
			}

			const discordEventId = eventMapping.get(calendarEvent.uid);

			if (discordEventId) {
				// Event exists, check if it needs updating
				const discordEvent = managedDiscordEvents.get(discordEventId);
				if (discordEvent) {
					await updateDiscordEvent(guild, discordEventId, calendarEvent);
				} else {
					// Discord event was deleted manually or doesn't exist, recreate it
					eventMapping.delete(calendarEvent.uid);
					saveEventMapping(); // Persist the deletion
					await createDiscordEvent(guild, calendarEvent);
				}
			} else {
				// New event, create it
				await createDiscordEvent(guild, calendarEvent);
			}
		}

		// Delete Discord events that no longer exist in calendar
		for (const [uid, discordEventId] of eventMapping.entries()) {
			if (!currentCalendarUids.has(uid)) {
				await deleteDiscordEvent(guild, discordEventId);
				eventMapping.delete(uid);
				saveEventMapping(); // Persist the deletion
			}
		}

		console.log(`[CalendarSync] Sync completed. Tracking ${eventMapping.size} event(s)`);
	} catch (error) {
		console.error('[CalendarSync] Error during sync:', error);
	}
}

/**
 * Starts the automatic calendar synchronization
 * @param {Client} client - The Discord client
 * @param {number} intervalMinutes - Sync interval in minutes
 */
function startCalendarSync(client, intervalMinutes) {
	console.log(`[CalendarSync] Starting automatic calendar sync (every ${intervalMinutes} minutes)`);
	
	// Load existing event mappings from file
	loadEventMapping();
	
	// Initial sync
	syncCalendarEvents(client);
	
	// Set up periodic sync
	setInterval(() => {
		syncCalendarEvents(client);
	}, intervalMinutes * 60 * 1000);
}

module.exports = {
	startCalendarSync,
	syncCalendarEvents,
};
