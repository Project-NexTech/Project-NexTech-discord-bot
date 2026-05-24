const fs = require('node:fs');
const path = require('node:path');
const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require('discord.js');
const sheetsManager = require('./sheets');

const notifiedFilePath = path.join(__dirname, '..', 'data', 'hour-approval-notified.json');
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_POLL_MINUTES = 5;
const DEFAULT_SESSION_HOURS = 168; // 7 days

/**
 * @returns {Set<number>}
 */
function loadNotifiedRows() {
	try {
		if (fs.existsSync(notifiedFilePath)) {
			const data = JSON.parse(fs.readFileSync(notifiedFilePath, 'utf8'));
			return new Set(data.notifiedRowNumbers || []);
		}
	}
	catch (error) {
		console.error('[HourApproval] Error loading notified rows:', error);
	}
	return new Set();
}

/**
 * @param {Set<number>} notifiedRows
 */
function saveNotifiedRows(notifiedRows) {
	try {
		fs.writeFileSync(
			notifiedFilePath,
			JSON.stringify({ notifiedRowNumbers: [...notifiedRows] }, null, 2),
			'utf8',
		);
	}
	catch (error) {
		console.error('[HourApproval] Error saving notified rows:', error);
	}
}

/**
 * @param {Object} request
 * @returns {EmbedBuilder}
 */
function buildHourApprovalEmbed(request) {
	return new EmbedBuilder()
		.setColor(0xFAA61A)
		.setTitle('⏳ Hour Request Needs Approval')
		.setDescription(`A volunteer submitted hours that need your review.`)
		.addFields(
			{ name: 'Volunteer', value: request.name, inline: true },
			{ name: 'Hours', value: String(request.hours), inline: true },
			{ name: 'Confirmer', value: request.confirmer, inline: true },
			{ name: 'Department', value: request.department, inline: true },
			{ name: 'Date', value: String(request.date), inline: true },
			{ name: 'Type', value: String(request.type), inline: true },
			{ name: 'Sheet Row', value: String(request.rowNumber), inline: true },
			{ name: 'Description', value: request.description || 'No description provided' },
		)
		.setFooter({ text: 'Project NexTech Hour Verification' })
		.setTimestamp();
}

/**
 * @param {number} rowNumber
 * @returns {ActionRowBuilder}
 */
function buildApprovalButtons(rowNumber) {
	return new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`hour_approve_${rowNumber}`)
				.setLabel('Approve')
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅'),
			new ButtonBuilder()
				.setCustomId(`hour_decline_${rowNumber}`)
				.setLabel('Decline')
				.setStyle(ButtonStyle.Danger)
				.setEmoji('❌'),
		);
}

/**
 * @param {import('discord.js').Client} client
 * @param {Object} request
 * @param {Object} approverContact
 * @param {Set<number>} notifiedRows
 */
async function notifyApprover(client, request, approverContact, notifiedRows) {
	try {
		const approverUser = await client.users.fetch(approverContact.discordId);
		const embed = buildHourApprovalEmbed(request);
		const components = [buildApprovalButtons(request.rowNumber)];

		const dmMessage = await approverUser.send({ embeds: [embed], components });

		if (!client.hourApprovalPending) {
			client.hourApprovalPending = new Map();
		}

		const sessionHours = parseInt(process.env.HOUR_APPROVAL_SESSION_HOURS, 10) || DEFAULT_SESSION_HOURS;
		const timeoutMs = sessionHours * 60 * 60 * 1000;

		const timeoutId = setTimeout(() => {
			expireHourApprovalSession(client, request.rowNumber, dmMessage);
		}, timeoutMs);

		client.hourApprovalPending.set(request.rowNumber, {
			request,
			approverId: approverContact.discordId,
			approverSheetName: approverContact.name,
			messageId: dmMessage.id,
			channelId: dmMessage.channel.id,
			timeoutId,
		});

		notifiedRows.add(request.rowNumber);
		saveNotifiedRows(notifiedRows);

		console.log(
			`[HourApproval] Sent approval DM for row ${request.rowNumber} `
			+ `(${request.name}) to ${approverContact.name}`,
		);
	}
	catch (error) {
		console.error(
			`[HourApproval] Failed to DM approver for row ${request.rowNumber}:`,
			error.message,
		);
	}
}

/**
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 * @param {import('discord.js').Message} dmMessage
 */
async function expireHourApprovalSession(client, rowNumber, dmMessage) {
	const pending = client.hourApprovalPending?.get(rowNumber);
	if (!pending) {
		return;
	}

	client.hourApprovalPending.delete(rowNumber);

	try {
		const embed = EmbedBuilder.from(dmMessage.embeds[0])
			.setColor(0x95A5A6)
			.setTitle('⌛ Hour Approval Expired')
			.setDescription('This request was not actioned in time. You can still update the sheet manually.');

		await dmMessage.edit({ embeds: [embed], components: [] });
	}
	catch (error) {
		console.error(`[HourApproval] Failed to expire session for row ${rowNumber}:`, error.message);
	}
}

/**
 * @param {import('discord.js').Client} client
 */
async function syncHourApprovalRequests(client) {
	try {
		const lookbackDays = parseInt(process.env.HOUR_APPROVAL_LOOKBACK_DAYS, 10) || DEFAULT_LOOKBACK_DAYS;
		const result = await sheetsManager.getNewHourVerificationRequests(lookbackDays);

		if (!result) {
			console.error('[HourApproval] Skipping sync — could not read Hour Verification sheet');
			return;
		}

		const notifiedRows = loadNotifiedRows();
		let notifiedCount = 0;

		for (const request of result.requests) {
			if (notifiedRows.has(request.rowNumber)) {
				continue;
			}

			if (client.hourApprovalPending?.has(request.rowNumber)) {
				continue;
			}

			const confirmer = request.confirmer && request.confirmer !== 'N/A'
				? request.confirmer.trim()
				: null;

			if (!confirmer) {
				console.warn(
					`[HourApproval] Row ${request.rowNumber} has no confirmer — cannot find approver`,
				);
				continue;
			}

			const approver = await sheetsManager.getContactByName(confirmer);

			if (!approver) {
				console.warn(
					`[HourApproval] No leadership contact with Discord ID for confirmer "${confirmer}" `
					+ `(row ${request.rowNumber})`,
				);
				continue;
			}

			await notifyApprover(client, request, approver, notifiedRows);
			notifiedCount++;
		}

		if (notifiedCount > 0) {
			console.log(`[HourApproval] Sync completed — sent ${notifiedCount} new notification(s)`);
		}
	}
	catch (error) {
		console.error('[HourApproval] Error during sync:', error);
	}
}

/**
 * @param {import('discord.js').Client} client
 * @param {number} intervalMinutes
 */
function startHourApprovalSync(client, intervalMinutes) {
	console.log(`[HourApproval] Starting automatic hour approval sync (every ${intervalMinutes} minutes)`);

	syncHourApprovalRequests(client);

	setInterval(() => {
		syncHourApprovalRequests(client);
	}, intervalMinutes * 60 * 1000);
}

/**
 * Clear a pending hour approval session
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 */
function clearHourApprovalSession(client, rowNumber) {
	const pending = client.hourApprovalPending?.get(rowNumber);
	if (!pending) {
		return;
	}

	if (pending.timeoutId) {
		clearTimeout(pending.timeoutId);
	}

	client.hourApprovalPending.delete(rowNumber);
}

/**
 * Handle Approve / Decline button clicks on hour approval DMs
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} True if this handler consumed the interaction
 */
async function handleHourApprovalButton(interaction) {
	if (!interaction.isButton()) {
		return false;
	}

	const approveMatch = interaction.customId.match(/^hour_approve_(\d+)$/);
	const declineMatch = interaction.customId.match(/^hour_decline_(\d+)$/);
	const match = approveMatch || declineMatch;

	if (!match) {
		return false;
	}

	const rowNumber = parseInt(match[1], 10);
	const isApprove = Boolean(approveMatch);

	if (!interaction.client.hourApprovalPending?.has(rowNumber)) {
		await interaction.reply({
			content: '❌ This approval request has expired or was already handled.',
			ephemeral: true,
		});
		return true;
	}

	const pending = interaction.client.hourApprovalPending.get(rowNumber);

	if (interaction.user.id !== pending.approverId) {
		await interaction.reply({
			content: '❌ Only the assigned department approver can use these buttons.',
			ephemeral: true,
		});
		return true;
	}

	await interaction.deferUpdate();

	const freshData = await sheetsManager.getNewHourVerificationRequests(
		parseInt(process.env.HOUR_APPROVAL_LOOKBACK_DAYS, 10) || DEFAULT_LOOKBACK_DAYS,
	);
	const stillPending = freshData?.requests.some(req => req.rowNumber === rowNumber);

	if (!stillPending) {
		clearHourApprovalSession(interaction.client, rowNumber);
		await interaction.editReply({
			content: '❌ This request is no longer pending in the sheet.',
			embeds: interaction.message.embeds,
			components: [],
		});
		return true;
	}

	const approverName = pending.approverSheetName
		|| interaction.member?.displayName
		|| interaction.user.displayName
		|| interaction.user.username;
	const verdict = isApprove ? 'Approved' : 'Denied';
	const success = await sheetsManager.updateHourVerificationVerdict(
		rowNumber,
		verdict,
		isApprove ? approverName : null,
	);

	clearHourApprovalSession(interaction.client, rowNumber);

	if (!success) {
		await interaction.editReply({
			content: '❌ Failed to update Google Sheets. Please update the row manually.',
			embeds: interaction.message.embeds,
			components: [],
		});
		return true;
	}

	const embed = EmbedBuilder.from(interaction.message.embeds[0])
		.setColor(isApprove ? 0x57F287 : 0xED4245)
		.setTitle(isApprove ? '✅ Hour Request Approved' : '❌ Hour Request Declined')
		.setDescription(
			isApprove
				? `Marked **Approved** in the sheet (approver: **${approverName}**).`
				: 'Marked **Denied** in the sheet.',
		);

	await interaction.editReply({
		content: null,
		embeds: [embed],
		components: [],
	});

	console.log(
		`[HourApproval] Row ${rowNumber} ${verdict.toLowerCase()} by ${interaction.user.tag}`,
	);

	return true;
}

module.exports = {
	startHourApprovalSync,
	syncHourApprovalRequests,
	handleHourApprovalButton,
	buildHourApprovalEmbed,
	clearHourApprovalSession,
	loadNotifiedRows,
	saveNotifiedRows,
};
