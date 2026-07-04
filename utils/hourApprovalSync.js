const fs = require('node:fs');
const path = require('node:path');
const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} = require('discord.js');
const sheetsManager = require('./sheets');

const stateFilePath = path.join(__dirname, '..', 'data', 'hour-approval-state.json');
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_SESSION_HOURS = 168; // 7 days

// Rows we have already notified for (or recorded as baseline at startup). Persisted
// so a restart never re-DMs the same request. Sessions for live DM buttons are
// persisted alongside so they survive a restart too.
let notifiedRows = new Set();
// Whether the first sync after process start has run. The first sync records all
// existing pending rows as baseline WITHOUT notifying, so a restart never blasts
// DMs for the backlog — only rows that newly appear while running are notified.
let baselineSeeded = false;
let pollIntervalMinutes = 5; // updated by startHourApprovalSync

/**
 * @returns {{ notifiedRowNumbers: number[], sessions: Object }}
 */
function readStateFile() {
	try {
		if (fs.existsSync(stateFilePath)) {
			const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
			return {
				notifiedRowNumbers: data.notifiedRowNumbers || [],
				sessions: data.sessions || {},
			};
		}
	}
	catch (error) {
		console.error('[HourApproval] Error loading state file:', error);
	}
	return { notifiedRowNumbers: [], sessions: {} };
}

/**
 * Persist notified rows and the serializable parts of the live sessions.
 * @param {import('discord.js').Client} client
 */
function persistState(client) {
	// sessions: { [rowNumber]: { [approverId]: sessionData } }
	const sessions = {};
	if (client.hourApprovalPending) {
		for (const [rowNumber, rowSessions] of client.hourApprovalPending) {
			sessions[rowNumber] = {};
			for (const [approverId, session] of rowSessions) {
				sessions[rowNumber][approverId] = {
					request: session.request,
					confirmerColumnIndex: session.confirmerColumnIndex,
					approverId: session.approverId,
					approverSheetName: session.approverSheetName,
					messageId: session.messageId,
					channelId: session.channelId,
					expiresAt: session.expiresAt,
				};
			}
		}
	}

	try {
		fs.writeFileSync(
			stateFilePath,
			JSON.stringify({ notifiedRowNumbers: [...notifiedRows], sessions }, null, 2),
			'utf8',
		);
	}
	catch (error) {
		console.error('[HourApproval] Error saving state file:', error);
	}
}

// Seed the in-memory notified set from disk at module load so any early
// persistState (e.g. from a button handler) never clobbers existing state.
notifiedRows = new Set(readStateFile().notifiedRowNumbers || []);

/**
 * Rebuild live button sessions from disk after a restart and re-arm their
 * expiry timers. Sessions whose deadline already passed are expired immediately
 * (the DM is edited with a sheet link) instead of being left dangling.
 * @param {import('discord.js').Client} client
 */
async function restoreHourApprovalSessions(client) {
	const state = readStateFile();
	notifiedRows = new Set(state.notifiedRowNumbers || []);

	if (!client.hourApprovalPending) {
		client.hourApprovalPending = new Map();
	}

	const now = Date.now();
	let restored = 0;
	let expired = 0;

	for (const [rowKey, rowData] of Object.entries(state.sessions || {})) {
		const rowNumber = parseInt(rowKey, 10);

		// Detect old single-session format (direct `request` property means pre-multi-approver format).
		// Those sessions used button IDs without an approverId suffix and can't be routed
		// anymore, so skip them rather than trying to restore.
		if (rowData && typeof rowData === 'object' && rowData.request) {
			console.log(`[HourApproval] Skipping old-format session for row ${rowNumber} (button IDs changed)`);
			continue;
		}

		const rowSessions = new Map();
		client.hourApprovalPending.set(rowNumber, rowSessions);

		for (const [approverId, session] of Object.entries(rowData || {})) {
			rowSessions.set(approverId, { ...session, timeoutId: null });

			const remaining = (session.expiresAt || 0) - now;
			if (remaining <= 0) {
				await expireHourApprovalSession(client, rowNumber, approverId);
				expired++;
			}
			else {
				const timeoutId = setTimeout(() => {
					expireHourApprovalSession(client, rowNumber, approverId);
				}, remaining);
				const entry = rowSessions.get(approverId);
				if (entry) {
					entry.timeoutId = timeoutId;
				}
				restored++;
			}
		}

		if (rowSessions.size === 0) {
			client.hourApprovalPending.delete(rowNumber);
		}
	}

	if (restored > 0 || expired > 0) {
		console.log(
			`[HourApproval] Restored ${restored} active session(s), expired ${expired} stale session(s) on startup`,
		);
	}

	persistState(client);
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
			{ name: 'Link', value: request.link || 'none', inline: true },
			{ name: 'Description', value: request.description || 'No description provided' },
		)
		.setFooter({ text: 'Project NexTech Hour Verification' })
		.setTimestamp();
}

/**
 * @param {number} rowNumber
 * @returns {ActionRowBuilder}
 */
function buildApprovalButtons(rowNumber, approverId) {
	return new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`hour_approve_${rowNumber}_${approverId}`)
				.setLabel('Approve')
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅'),
			new ButtonBuilder()
				.setCustomId(`hour_change_${rowNumber}_${approverId}`)
				.setLabel('Change')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('✏️'),
			new ButtonBuilder()
				.setCustomId(`hour_deny_${rowNumber}_${approverId}`)
				.setLabel('Deny')
				.setStyle(ButtonStyle.Danger)
				.setEmoji('❌'),
		);
}

/**
 * @param {string} value
 * @returns {number|null}
 */
function parseHoursInput(value) {
	const trimmed = (value || '').trim();
	if (!trimmed) {
		return null;
	}

	const hours = parseFloat(trimmed);
	if (Number.isNaN(hours) || hours <= 0) {
		return null;
	}

	return hours;
}

/**
 * @param {import('discord.js').ButtonInteraction|import('discord.js').ModalSubmitInteraction} interaction
 * @param {number} rowNumber
 * @param {string} approverId - Discord user ID encoded in the button/modal customId
 * @returns {Promise<Object|null>} Pending session, or null if already replied
 */
async function getHourApprovalSession(interaction, rowNumber, approverId) {
	const rowSessions = interaction.client.hourApprovalPending?.get(rowNumber);
	if (!rowSessions?.has(approverId)) {
		await interaction.reply({
			content: '❌ This approval request has expired or was already handled.',
			ephemeral: true,
		});
		return null;
	}

	if (interaction.user.id !== approverId) {
		await interaction.reply({
			content: '❌ Only the assigned confirmer can use these controls.',
			ephemeral: true,
		});
		return null;
	}

	return rowSessions.get(approverId);
}

/**
 * Cancel all active sessions for a row after one approver acts (or the request
 * is no longer pending). Edits every sibling DM to remove buttons and show the
 * outcome; skips the acting approver's own DM (that is handled by the caller).
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 * @param {string|null} actingApproverId - Discord ID of the approver who acted (their DM is already handled)
 * @param {string|null} siblingStatusText - Summary shown in sibling DMs (null → generic "no longer pending")
 */
async function cancelAllSessionsForRow(client, rowNumber, actingApproverId, siblingStatusText) {
	const rowSessions = client.hourApprovalPending?.get(rowNumber);
	if (!rowSessions) return;

	for (const [approverId, session] of rowSessions) {
		if (session.timeoutId) clearTimeout(session.timeoutId);

		if (approverId !== actingApproverId) {
			try {
				const channel = await client.channels.fetch(session.channelId);
				const dmMessage = await channel.messages.fetch(session.messageId);
				const desc = siblingStatusText
					? `This request was already actioned: **${siblingStatusText}**. No further action needed.`
					: 'This request is no longer pending. No further action needed.';
				const embed = EmbedBuilder.from(dmMessage.embeds[0])
					.setColor(0x95A5A6)
					.setTitle('✅ Already Handled')
					.setDescription(desc);
				await dmMessage.edit({ embeds: [embed], components: [] });
			}
			catch (err) {
				console.error(
					`[HourApproval] Failed to cancel sibling DM for row ${rowNumber}, approver ${approverId}:`,
					err.message,
				);
			}
		}
	}

	client.hourApprovalPending.delete(rowNumber);
	persistState(client);
}

/**
 * @param {number} rowNumber
 * @param {number} confirmerColumnIndex
 * @returns {Promise<boolean>}
 */
async function isHourRequestStillPending(rowNumber, confirmerColumnIndex) {
	return sheetsManager.isConfirmerRowPending(rowNumber, confirmerColumnIndex);
}

/**
 * Send approval DMs to all resolved approvers for a request.
 * Sessions are stored as Map<rowNumber, Map<approverId, session>>.
 * @param {import('discord.js').Client} client
 * @param {Object} request
 * @param {Array} approvers - array of contact objects from getApproversForConfirmer
 */
async function notifyApprovers(client, request, approvers) {
	if (!client.hourApprovalPending) {
		client.hourApprovalPending = new Map();
	}

	if (!client.hourApprovalPending.has(request.rowNumber)) {
		client.hourApprovalPending.set(request.rowNumber, new Map());
	}
	const rowSessions = client.hourApprovalPending.get(request.rowNumber);

	const sessionHours = parseFloat(process.env.HOUR_APPROVAL_SESSION_HOURS) || DEFAULT_SESSION_HOURS;
	const timeoutMs = sessionHours * 60 * 60 * 1000;
	const expiresAt = Date.now() + timeoutMs;

	const volunteerNameNorm = (request.name || '').toLowerCase().trim();
	for (const approverContact of approvers) {
		// Strip quoted nicknames (e.g. 'Pryya "Sompan" Surarujiroj' → 'Pryya Surarujiroj') before comparing.
		const approverNameNorm = (approverContact.name || '').replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
		if (approverNameNorm === volunteerNameNorm) {
			console.log(`[HourApproval] Skipping self-approval DM for row ${request.rowNumber}: ${approverContact.name} is the volunteer`);
			continue;
		}

		try {
			const approverUser = await client.users.fetch(approverContact.discordId);
			const embed = buildHourApprovalEmbed(request);
			const components = [buildApprovalButtons(request.rowNumber, approverContact.discordId)];
			const dmMessage = await approverUser.send({ embeds: [embed], components });

			const timeoutId = setTimeout(() => {
				expireHourApprovalSession(client, request.rowNumber, approverContact.discordId);
			}, timeoutMs);

			rowSessions.set(approverContact.discordId, {
				request,
				// Store the column index specific to this approver (null → overall Verdict col).
				confirmerColumnIndex: approverContact.confirmerColumnIndex ?? null,
				approverId: approverContact.discordId,
				approverSheetName: approverContact.name,
				messageId: dmMessage.id,
				channelId: dmMessage.channel.id,
				expiresAt,
				timeoutId,
			});

			console.log(`[HourApproval] New request — row ${request.rowNumber} "${request.name}" — DM sent to ${approverContact.name}`);
		}
		catch (error) {
			console.error(
				`[HourApproval] Failed to DM ${approverContact.name} for row ${request.rowNumber}:`,
				error.message,
			);
		}
	}

	notifiedRows.add(request.rowNumber);
	persistState(client);
}

/**
 * Expire a session whose DM buttons were never clicked: drop the in-memory
 * session and edit the original DM to remove the (now-dead) buttons and point
 * the approver at the exact sheet cell to action manually.
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 */
async function expireHourApprovalSession(client, rowNumber, approverId) {
	const rowSessions = client.hourApprovalPending?.get(rowNumber);
	const pending = rowSessions?.get(approverId);
	if (!pending) {
		return;
	}

	if (pending.timeoutId) {
		clearTimeout(pending.timeoutId);
	}
	rowSessions.delete(approverId);
	if (rowSessions.size === 0) {
		client.hourApprovalPending.delete(rowNumber);
	}
	// Keep the row in notifiedRows so the next sync does not re-DM it.
	persistState(client);

	try {
		const channel = await client.channels.fetch(pending.channelId);
		const dmMessage = await channel.messages.fetch(pending.messageId);

		const cellUrl = await sheetsManager.buildHourVerificationCellUrl(
			pending.request.rowNumber,
			pending.confirmerColumnIndex,
		);

		const embed = EmbedBuilder.from(dmMessage.embeds[0])
			.setColor(0x95A5A6)
			.setTitle('⌛ Hour Approval Expired')
			.setDescription(
				'These buttons expired before this request was actioned. '
				+ 'Please update the verdict directly in the sheet:\n'
				+ `[Open row ${pending.request.rowNumber} in the Hour Verification sheet](${cellUrl})`,
			);

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

		const isBaseline = !baselineSeeded;
		let baselineCount = 0;

		for (const request of result.requests) {
			if (notifiedRows.has(request.rowNumber) || client.hourApprovalPending?.has(request.rowNumber)) {
				continue;
			}

			// On the first sync after (re)start, record every pre-existing pending
			// row as baseline without DMing. Only rows that newly appear while the
			// bot is running get a notification.
			if (isBaseline) {
				notifiedRows.add(request.rowNumber);
				baselineCount++;
				continue;
			}

			const confirmer = request.confirmer && request.confirmer !== 'N/A'
				? request.confirmer.trim()
				: null;

			if (!confirmer) continue;

			const approvers = await sheetsManager.getApproversForConfirmer(confirmer);

			if (approvers.length === 0) {
				console.warn(
					`[HourApproval] No leadership contacts with Discord IDs found for confirmer "${confirmer}" `
					+ `(row ${request.rowNumber}). Ensure members have Discord IDs on the Leadership sheet.`,
				);
				continue;
			}

			await notifyApprovers(client, request, approvers);
		}

		if (isBaseline) {
			baselineSeeded = true;
			persistState(client);
			console.log(
				`[HourApproval] Startup baseline established — ${baselineCount} existing pending row(s) recorded. `
				+ `Watching for new submissions (checking every ${pollIntervalMinutes} minute(s)).`,
			);
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
async function startHourApprovalSync(client, intervalMinutes) {
	pollIntervalMinutes = intervalMinutes;
	console.log(`[HourApproval] Starting automatic hour approval sync (every ${intervalMinutes} minutes)`);

	// Rebuild any live button sessions from disk so DMs sent before a restart
	// remain actionable (and stale ones get expired) before the first sync runs.
	await restoreHourApprovalSessions(client);

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
	const rowSessions = client.hourApprovalPending?.get(rowNumber);
	if (!rowSessions) return;

	for (const [, session] of rowSessions) {
		if (session.timeoutId) clearTimeout(session.timeoutId);
	}

	client.hourApprovalPending.delete(rowNumber);
	persistState(client);
}

/**
 * Handle Approve / Deny button clicks on hour approval DMs
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} True if this handler consumed the interaction
 */
async function handleHourApprovalButton(interaction) {
	if (!interaction.isButton()) {
		return false;
	}

	const approveMatch = interaction.customId.match(/^hour_approve_(\d+)_(\d+)$/);
	const denyMatch = interaction.customId.match(/^hour_deny_(\d+)_(\d+)$/);
	const changeMatch = interaction.customId.match(/^hour_change_(\d+)_(\d+)$/);
	const match = approveMatch || denyMatch || changeMatch;

	if (!match) {
		return false;
	}

	const rowNumber = parseInt(match[1], 10);
	const approverId = match[2];
	const pending = await getHourApprovalSession(interaction, rowNumber, approverId);
	if (!pending) {
		return true;
	}

	if (changeMatch) {
		const currentHours = pending.request.hours === 'N/A' ? '' : String(pending.request.hours);
		const modal = new ModalBuilder()
			.setCustomId(`hour_change_${rowNumber}_${approverId}`)
			.setTitle('Change Requested Hours');

		const hoursInput = new TextInputBuilder()
			.setCustomId('new_hours')
			.setLabel('Revised hours (recorded in Notes column)')
			.setStyle(TextInputStyle.Short)
			.setPlaceholder('e.g. 2 or 1.5')
			.setValue(currentHours)
			.setRequired(true)
			.setMaxLength(10);

		modal.addComponents(new ActionRowBuilder().addComponents(hoursInput));
		await interaction.showModal(modal);
		return true;
	}

	if (denyMatch) {
		const modal = new ModalBuilder()
			.setCustomId(`hour_deny_${rowNumber}_${approverId}`)
			.setTitle('Deny Hour Request');

		const reasonInput = new TextInputBuilder()
			.setCustomId('deny_reason')
			.setLabel('Reason for denying (added to Notes)')
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder('e.g. request too old, duplicate request, inaccurate request, etc.')
			.setRequired(true)
			.setMaxLength(500);

		modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
		await interaction.showModal(modal);
		return true;
	}

	// Only Approve reaches here
	await interaction.deferUpdate();

	const confirmerColumnIndex = pending.confirmerColumnIndex;
	if (!await isHourRequestStillPending(rowNumber, confirmerColumnIndex)) {
		await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, null);
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
	const success = await sheetsManager.setConfirmerHourStatus(
		rowNumber,
		confirmerColumnIndex,
		'Approved',
		null,
		approverName,
	);

	if (!success) {
		await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, null);
		await interaction.editReply({
			content: '❌ Failed to update Google Sheets. Please update the row manually.',
			embeds: interaction.message.embeds,
			components: [],
		});
		return true;
	}

	await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, `Approved by ${approverName}`);

	const embed = EmbedBuilder.from(interaction.message.embeds[0])
		.setColor(0x57F287)
		.setTitle('✅ Hour Request Approved')
		.setDescription(`Set **Approved** (by **${approverName}**).`);

	await interaction.editReply({
		content: null,
		embeds: [embed],
		components: [],
	});

	console.log(`[HourApproval] Row ${rowNumber} approved by ${interaction.user.tag}`);

	return true;
}

/**
 * Handle modal submission to change hours and approve
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function handleHourApprovalModal(interaction) {
	if (!interaction.isModalSubmit()) {
		return false;
	}

	const changeMatch = interaction.customId.match(/^hour_change_(\d+)_(\d+)$/);
	const denyMatch = interaction.customId.match(/^hour_deny_(\d+)_(\d+)$/);
	const match = changeMatch || denyMatch;
	if (!match) {
		return false;
	}

	const rowNumber = parseInt(match[1], 10);
	const approverId = match[2];
	const pending = await getHourApprovalSession(interaction, rowNumber, approverId);
	if (!pending) {
		return true;
	}

	await interaction.deferReply({ ephemeral: true });

	const confirmerColumnIndex = pending.confirmerColumnIndex;
	if (!await isHourRequestStillPending(rowNumber, confirmerColumnIndex)) {
		await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, null);
		await interaction.editReply({ content: '❌ This request is no longer pending in the sheet.' });
		return true;
	}

	const approverName = pending.approverSheetName
		|| interaction.member?.displayName
		|| interaction.user.displayName
		|| interaction.user.username;

	if (changeMatch) {
		const newHours = parseHoursInput(interaction.fields.getTextInputValue('new_hours'));
		if (newHours === null) {
			await interaction.editReply({
				content: '❌ Enter a valid number of hours greater than zero (e.g. `2` or `1.5`).',
			});
			return true;
		}

		const formattedHours = String(newHours);
		const oldHours = String(pending.request.hours);
		const noteText = `${oldHours}->${formattedHours}`;

		// Mark the confirmer's verdict as "Changed" WITHOUT touching column B or C.
		// The `oldHours->newHours` note plus the "Changed" verdict drive the sheet's
		// own formulas, which update columns B and C automatically.
		const statusSuccess = await sheetsManager.setConfirmerHourStatus(
			rowNumber,
			confirmerColumnIndex,
			'Changed',
			null,
			approverName,
		);

		if (!statusSuccess) {
			await interaction.editReply({ content: '❌ Failed to update Google Sheets. Please update the row manually.' });
			return true;
		}

		const noteSuccess = await sheetsManager.setHourVerificationNote(rowNumber, noteText);
		if (!noteSuccess) {
			console.warn(`[HourApproval] Row ${rowNumber}: verdict set to Changed but failed to write the Note column`);
		}

		const statusSummary = `Changed (${noteText}) by ${approverName}`;
		await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, statusSummary);

		try {
			const channel = await interaction.client.channels.fetch(pending.channelId);
			const dmMessage = await channel.messages.fetch(pending.messageId);
			const sourceEmbed = EmbedBuilder.from(dmMessage.embeds[0])
				.setColor(0x57F287)
				.setTitle('✏️ Hours Changed')
				.setDescription(
					`Set **Changed** by **${approverName}** `
					+ `and wrote **${noteText}** to the Note column. Hour(s) number update automatically.`,
				);
			await dmMessage.edit({ embeds: [sourceEmbed], components: [] });
		}
		catch (error) {
			console.error(`[HourApproval] Failed to edit DM after change for row ${rowNumber}:`, error.message);
		}

		const noteWarning = noteSuccess ? '' : ' (⚠️ could not write the Note column — update it manually)';
		await interaction.editReply({
			content: `✅ Set **Changed** and wrote **${noteText}** to the Note column.${noteWarning}`,
		});

		console.log(`[HourApproval] Row ${rowNumber} changed (${noteText}) by ${interaction.user.tag}`);
		return true;
	}

	// Deny with reason
	const reason = interaction.fields.getTextInputValue('deny_reason').trim();

	const statusSuccess = await sheetsManager.setConfirmerHourStatus(
		rowNumber,
		confirmerColumnIndex,
		'Denied',
		null,
		approverName,
	);

	if (!statusSuccess) {
		await interaction.editReply({ content: '❌ Failed to update Google Sheets. Please update the row manually.' });
		return true;
	}

	const noteSuccess = await sheetsManager.setHourVerificationNote(rowNumber, reason);
	if (!noteSuccess) {
		console.warn(`[HourApproval] Row ${rowNumber}: verdict set to Denied but failed to write the Note column`);
	}

	const statusSummary = `Denied by ${approverName}`;
	await cancelAllSessionsForRow(interaction.client, rowNumber, approverId, statusSummary);

	try {
		const channel = await interaction.client.channels.fetch(pending.channelId);
		const dmMessage = await channel.messages.fetch(pending.messageId);
		const sourceEmbed = EmbedBuilder.from(dmMessage.embeds[0])
			.setColor(0xED4245)
			.setTitle('❌ Hour Request Denied')
			.setDescription(
				`Set **Denied** by **${approverName}**. `
				+ `Reason: ${reason}`,
			);
		await dmMessage.edit({ embeds: [sourceEmbed], components: [] });
	}
	catch (error) {
		console.error(`[HourApproval] Failed to edit DM after denial for row ${rowNumber}:`, error.message);
	}

	const noteWarning = noteSuccess ? '' : ' (⚠️ could not write the Note column — update it manually)';
	await interaction.editReply({
		content: `✅ Set **Denied** and wrote reason to the Note column.${noteWarning}`,
	});

	console.log(`[HourApproval] Row ${rowNumber} denied by ${interaction.user.tag}: ${reason}`);
	return true;
}

module.exports = {
	startHourApprovalSync,
	syncHourApprovalRequests,
	handleHourApprovalButton,
	handleHourApprovalModal,
	buildHourApprovalEmbed,
	clearHourApprovalSession,
	restoreHourApprovalSessions,
};
