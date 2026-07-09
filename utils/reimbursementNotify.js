/**
 * Posts a Discord notification when a reimbursement request form is submitted.
 * Triggered via POST /reimbursement/submit in utils/memberEndpoint.js.
 *
 * Environment variables required:
 *   REIMBURSEMENT_THREAD_ID - thread ID to post the request embed into
 *   EC_ROLE_ID              - role pinged alongside BD_ROLE_ID
 *   BD_ROLE_ID              - role pinged alongside EC_ROLE_ID
 */

const { EmbedBuilder } = require('discord.js');
const memberCache = require('./memberCache');

function formatDiscordField(rawUsername) {
	if (!rawUsername) return 'none';
	const match = memberCache.findByUsername(rawUsername);
	return match ? `<@${match.id}> (${rawUsername})` : rawUsername;
}

function buildReimbursementEmbed(payload) {
	return new EmbedBuilder()
		.setColor(0xFAA61A)
		.setTitle('💵 New Reimbursement Request')
		.addFields(
			{ name: 'Requester', value: payload.name, inline: true },
			{ name: 'Discord', value: formatDiscordField(payload.discordUsername), inline: true },
			{ name: 'Amount', value: String(payload.amount), inline: true },
			{ name: 'Date of Purchase', value: String(payload.purchaseDate), inline: true },
			{ name: 'Type of Purchase', value: payload.purchaseType, inline: true },
			{ name: 'Method of Receipt', value: payload.receiptMethod, inline: true },
			{ name: 'Evidence', value: payload.evidenceLink || 'none', inline: false },
			{ name: 'Additional Details', value: payload.details || 'None provided', inline: false },
		)
		.setFooter({ text: 'Project NexTech Reimbursement Requests' })
		.setTimestamp();
}

async function postReimbursementRequest(client, payload) {
	const threadId = process.env.REIMBURSEMENT_THREAD_ID;
	if (!threadId) throw new Error('REIMBURSEMENT_THREAD_ID not configured');

	const thread = await client.channels.fetch(threadId);
	if (!thread || !thread.isTextBased()) {
		throw new Error('Reimbursement thread not found or not text-based');
	}

	const content = `<@&${process.env.EC_ROLE_ID}> <@&${process.env.BD_ROLE_ID}>`;
	const embed = buildReimbursementEmbed(payload);
	await thread.send({ content, embeds: [embed] });
}

module.exports = { buildReimbursementEmbed, postReimbursementRequest };
