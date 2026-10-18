/**
 * Posts a Discord notification when Apps Script creates a media folder for a
 * new event in Program Bookings. Triggered via POST /events/folder in
 * utils/memberEndpoint.js.
 *
 * Environment variables required:
 *   EVENT_FOLDER_CHANNEL_ID - channel (or thread) ID to post the folder embed into
 *
 * Expected body:
 *   { folderUrl, folderName, eventName, eventCode, date, dateIso, location, uuid }
 *   Only folderUrl is required; everything else falls back to "unknown".
 */

const { EmbedBuilder } = require('discord.js');

const FIELD_VALUE_LIMIT = 1024;

const clean = (v, fallback = 'unknown') => {
	const s = v === undefined || v === null ? '' : String(v).trim();
	if (!s) return fallback;
	return s.length <= FIELD_VALUE_LIMIT ? s : s.slice(0, FIELD_VALUE_LIMIT - 1) + '…';
};

function buildEventFolderEmbed(payload) {
	const embed = new EmbedBuilder()
		.setColor(0x3498DB)
		.setTitle('📁 New event media folder')
		.setURL(payload.folderUrl)
		// Folder names contain "[1.1]"-style codes; escape brackets so the markdown link doesn't break.
		.setDescription(`[${clean(payload.folderName, 'Open folder').replace(/[[\]]/g, '\\$&')}](${payload.folderUrl})`)
		.addFields(
			{ name: 'Course', value: clean(payload.eventName), inline: false },
			{ name: 'Date', value: clean(payload.date), inline: true },
			{ name: 'Location', value: clean(payload.location), inline: true },
		)
		.setFooter({ text: 'Upload photos and videos from this event to the folder above.' })
		.setTimestamp();
	return embed;
}

async function postEventFolder(client, payload) {
	const channelId = process.env.EVENT_FOLDER_CHANNEL_ID;
	if (!channelId) throw new Error('EVENT_FOLDER_CHANNEL_ID not configured');

	const channel = await client.channels.fetch(channelId);
	if (!channel || !channel.isTextBased()) {
		throw new Error('Event folder channel not found or not text-based');
	}

	await channel.send({ embeds: [buildEventFolderEmbed(payload)] });
}

module.exports = { buildEventFolderEmbed, postEventFolder };
