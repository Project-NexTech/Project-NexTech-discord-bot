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
	MessageFlags,
} = require('discord.js');
const sheetsManager = require('./sheets');

// hourApprovalSync.js requires this module — never require it back (circular require).

const stateFilePath = path.join(__dirname, '..', 'data', 'hour-audit-state.json');
const DEFAULT_AUDIT_CHANCE = 0.025; // 1 in 40
const DEFAULT_AUDIT_SESSION_HOURS = 168; // 7 days

/**
 * @returns {{ sessions: Object }}
 */
function readAuditStateFile() {
	try {
		if (fs.existsSync(stateFilePath)) {
			const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
			return { sessions: data.sessions || {} };
		}
	}
	catch (error) {
		console.error('[HourAudit] Error loading state file:', error);
	}
	return { sessions: {} };
}

/**
 * Persist the serializable parts of live audit sessions so the buttons in
 * #nt-leaders stay actionable across restarts.
 * @param {import('discord.js').Client} client
 */
function persistAuditState(client) {
	const sessions = {};
	if (client.hourAuditPending) {
		for (const [rowNumber, session] of client.hourAuditPending) {
			sessions[rowNumber] = {
				rowNumber: session.rowNumber,
				request: session.request,
				targetColumnIndex: session.targetColumnIndex,
				originalVerdict: session.originalVerdict,
				originalNote: session.originalNote,
				originalNewHours: session.originalNewHours,
				originalApproverId: session.originalApproverId,
				originalApproverName: session.originalApproverName,
				decidedAt: session.decidedAt,
				status: session.status,
				reviewerId: session.reviewerId,
				reviewerName: session.reviewerName,
				channelId: session.channelId,
				messageId: session.messageId,
				decisionMessageId: session.decisionMessageId,
				expiresAt: session.expiresAt,
			};
		}
	}

	try {
		fs.writeFileSync(stateFilePath, JSON.stringify({ sessions }, null, 2), 'utf8');
	}
	catch (error) {
		console.error('[HourAudit] Error saving state file:', error);
	}
}

/**
 * @returns {number} Probability in [0, 1]; 0 disables audits, 1 always triggers
 */
function getAuditChance() {
	// NaN-checked instead of ||-defaulted so an explicit 0 stays 0 (disabled).
	const parsed = parseFloat(process.env.HOUR_AUDIT_CHANCE);
	return Number.isNaN(parsed) ? DEFAULT_AUDIT_CHANCE : parsed;
}

/**
 * Mirrors parseHoursInput in hourApprovalSync.js — kept local to avoid a circular require.
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
 * Resolve the exact column the original decision was written to, so a BD
 * override lands in the same cell. Mirrors the fallback resolution inside
 * setConfirmerHourStatus: explicit index, then approver-name lookup, then
 * the overall Verdict column (C).
 * @param {Object} payload - maybeTriggerHourAudit payload
 * @returns {Promise<number>} 0-based column index
 */
async function resolveAuditTargetColumn(payload) {
	if (payload.confirmerColumnIndex !== null && payload.confirmerColumnIndex !== undefined) {
		return payload.confirmerColumnIndex;
	}

	const grid = await sheetsManager.fetchHourVerificationGrid();
	if (grid && payload.approverName) {
		const resolved = sheetsManager.resolveConfirmerColumnIndex(payload.approverName, grid.confirmerColumnMap);
		if (resolved !== null && resolved !== undefined) {
			return resolved;
		}
	}

	return 2;
}

/**
 * @param {Object} session
 * @returns {EmbedBuilder}
 */
function buildHourAuditEmbed(session) {
	const request = session.request;

	let description = 'This decision was randomly selected for an additional BD review. '
		+ 'Please double-check the request and the decision below, then click the button to take the review.';
	const checklistUrl = process.env.HOUR_AUDIT_CHECKLIST_URL;
	if (checklistUrl) {
		description += `\nChecklist: [Article 11, Section 2](${checklistUrl})`;
	}

	const embed = new EmbedBuilder()
		.setColor(0xFAA61A)
		.setTitle('🔍 Random BD Audit — Hour Request Decision')
		.setDescription(description)
		.addFields(
			{ name: 'Volunteer', value: request.name, inline: true },
			{ name: 'Hours', value: String(request.hours), inline: true },
			{ name: 'Confirmer', value: request.confirmer, inline: true },
			{ name: 'Department', value: request.department, inline: true },
			{ name: 'Date', value: String(request.date), inline: true },
			{ name: 'Type', value: String(request.type), inline: true },
			{ name: 'Link', value: request.link || 'none', inline: true },
			{ name: 'Description', value: request.description || 'No description provided' },
			{ name: 'Decision', value: `**${session.originalVerdict}** by ${session.originalApproverName}` },
		)
		.setFooter({ text: 'Project NexTech Hour Audit' })
		.setTimestamp();

	if (session.originalNote) {
		embed.addFields({ name: 'Note', value: session.originalNote });
	}

	return embed;
}

/**
 * @param {number} rowNumber
 * @returns {ActionRowBuilder}
 */
function buildClaimButton(rowNumber) {
	return new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`hour_audit_claim_${rowNumber}`)
				.setLabel('Take this review')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('🔍'),
		);
}

/**
 * @param {number} rowNumber
 * @returns {ActionRowBuilder}
 */
function buildAuditDecisionButtons(rowNumber) {
	return new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`hour_audit_approve_${rowNumber}`)
				.setLabel('Approve')
				.setStyle(ButtonStyle.Success)
				.setEmoji('✅'),
			new ButtonBuilder()
				.setCustomId(`hour_audit_change_${rowNumber}`)
				.setLabel('Change')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('✏️'),
			new ButtonBuilder()
				.setCustomId(`hour_audit_deny_${rowNumber}`)
				.setLabel('Deny')
				.setStyle(ButtonStyle.Danger)
				.setEmoji('❌'),
		);
}

/**
 * Human-readable form of the original decision (includes changed hours if any)
 * @param {Object} session
 * @returns {string}
 */
function describeOriginalDecision(session) {
	if (session.originalVerdict === 'Changed' && session.originalNote) {
		return `Changed (${session.originalNote})`;
	}
	return session.originalVerdict;
}

/**
 * Clear the timer and drop the session from memory + disk.
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 */
function endAuditSession(client, rowNumber) {
	const session = client.hourAuditPending?.get(rowNumber);
	if (!session) {
		return;
	}

	if (session.timeoutId) {
		clearTimeout(session.timeoutId);
	}
	client.hourAuditPending.delete(rowNumber);
	persistAuditState(client);
}

/**
 * Roll the audit dice after a finalized hour decision and, on a hit, post the
 * BD review request in #nt-leaders. Never throws — an audit failure must not
 * affect the decision flow that called us.
 * @param {import('discord.js').Client} client
 * @param {Object} payload
 * @param {Object} payload.request - original request snapshot from the approval session
 * @param {number|null} payload.confirmerColumnIndex - column the decision was written to (null → resolved from approverName)
 * @param {string} payload.verdict - 'Approved' | 'Changed' | 'Denied'
 * @param {string|null} payload.note - 'X->Y' for Changed, deny reason for Denied
 * @param {number|null} payload.newHours - corrected hours when verdict is 'Changed'
 * @param {string} payload.approverId - Discord ID of the decider
 * @param {string} payload.approverName - sheet name of the decider
 */
async function maybeTriggerHourAudit(client, payload) {
	try {
		const rowNumber = payload.request.rowNumber;
		const chance = getAuditChance();
		const roll = Math.random();
		const triggered = roll < chance;
		console.log(
			`[HourAudit] Roll for row ${rowNumber}: ${roll.toFixed(4)} vs chance ${chance} → ${triggered ? 'TRIGGERED' : 'no audit'}`,
		);
		if (!triggered) {
			return;
		}

		if (client.hourAuditPending?.has(rowNumber)) {
			console.log(`[HourAudit] Row ${rowNumber} already has an active audit — skipping`);
			return;
		}

		const channelId = process.env.NT_LEADERS_CHANNEL_ID;
		if (!channelId) {
			console.warn('[HourAudit] Audit triggered but NT_LEADERS_CHANNEL_ID is not set — skipping');
			return;
		}

		const channel = await client.channels.fetch(channelId);
		if (!channel || !channel.isTextBased()) {
			console.warn('[HourAudit] NT_LEADERS_CHANNEL_ID does not resolve to a text channel — skipping');
			return;
		}

		if (!client.hourAuditPending) {
			client.hourAuditPending = new Map();
		}

		const sessionHours = parseFloat(process.env.HOUR_AUDIT_SESSION_HOURS) || DEFAULT_AUDIT_SESSION_HOURS;
		const timeoutMs = sessionHours * 60 * 60 * 1000;

		const session = {
			rowNumber,
			request: payload.request,
			targetColumnIndex: await resolveAuditTargetColumn(payload),
			originalVerdict: payload.verdict,
			originalNote: payload.note ?? null,
			originalNewHours: payload.newHours ?? null,
			originalApproverId: payload.approverId,
			originalApproverName: payload.approverName,
			decidedAt: Date.now(),
			status: 'unclaimed',
			reviewerId: null,
			reviewerName: null,
			channelId: channel.id,
			messageId: null,
			decisionMessageId: null,
			expiresAt: Date.now() + timeoutMs,
			timeoutId: null,
		};

		const message = await channel.send({
			content: `<@&${process.env.BD_ROLE_ID}>`,
			embeds: [buildHourAuditEmbed(session)],
			components: [buildClaimButton(rowNumber)],
		});

		session.messageId = message.id;
		session.timeoutId = setTimeout(() => {
			expireHourAuditSession(client, rowNumber);
		}, timeoutMs);

		client.hourAuditPending.set(rowNumber, session);
		persistAuditState(client);
		console.log(`[HourAudit] Audit posted for row ${rowNumber} (decision: ${payload.verdict} by ${payload.approverName})`);
	}
	catch (error) {
		console.error(`[HourAudit] Failed to trigger audit for row ${payload?.request?.rowNumber}:`, error.message);
	}
}

/**
 * Expire an audit nobody completed: drop the session and edit the message(s)
 * to remove the dead buttons and point at the exact sheet row.
 * @param {import('discord.js').Client} client
 * @param {number} rowNumber
 */
async function expireHourAuditSession(client, rowNumber) {
	const session = client.hourAuditPending?.get(rowNumber);
	if (!session) {
		return;
	}

	endAuditSession(client, rowNumber);

	try {
		const cellUrl = await sheetsManager.buildHourVerificationCellUrl(rowNumber, session.targetColumnIndex);
		const channel = await client.channels.fetch(session.channelId);
		const message = await channel.messages.fetch(session.messageId);
		const embed = EmbedBuilder.from(message.embeds[0])
			.setColor(0x95A5A6)
			.setTitle('⌛ Audit Expired')
			.setDescription(
				'No BD member completed this review before it expired. '
				+ `If it still needs a second look, use [row ${rowNumber} in the Hour Verification sheet](${cellUrl}).`,
			);
		await message.edit({ embeds: [embed], components: [] });

		if (session.decisionMessageId) {
			const decisionMessage = await channel.messages.fetch(session.decisionMessageId);
			await decisionMessage.edit({ components: [] });
		}
	}
	catch (error) {
		console.error(`[HourAudit] Failed to edit expired audit message for row ${rowNumber}:`, error.message);
	}

	console.log(`[HourAudit] Audit for row ${rowNumber} expired`);
}

/**
 * Rebuild audit sessions from disk after a restart and re-arm their expiry
 * timers, so claim/decision buttons posted before the restart keep working.
 * @param {import('discord.js').Client} client
 */
async function restoreHourAuditSessions(client) {
	const state = readAuditStateFile();

	if (!client.hourAuditPending) {
		client.hourAuditPending = new Map();
	}

	const now = Date.now();
	let restored = 0;
	let expired = 0;

	for (const [rowKey, session] of Object.entries(state.sessions || {})) {
		const rowNumber = parseInt(rowKey, 10);
		client.hourAuditPending.set(rowNumber, { ...session, timeoutId: null });

		const remaining = (session.expiresAt || 0) - now;
		if (remaining <= 0) {
			await expireHourAuditSession(client, rowNumber);
			expired++;
		}
		else {
			const entry = client.hourAuditPending.get(rowNumber);
			entry.timeoutId = setTimeout(() => {
				expireHourAuditSession(client, rowNumber);
			}, remaining);
			restored++;
		}
	}

	if (restored > 0 || expired > 0) {
		console.log(`[HourAudit] Restored ${restored} active audit(s), expired ${expired} stale audit(s) on startup`);
	}

	persistAuditState(client);
}

/**
 * Resolve the reviewer's name from the Leadership sheet so sheet notes and
 * audit messages use the same names the sheet does (matching how the original
 * approver's name is recorded). Falls back to the Discord display name if the
 * reviewer isn't on the sheet or the sheet is unreachable.
 * @param {string} userId - Reviewer's Discord ID
 * @param {string} fallbackName - Discord display name
 * @returns {Promise<string>}
 */
async function resolveReviewerSheetName(userId, fallbackName) {
	try {
		const contacts = await sheetsManager.getContacts();
		const match = contacts.find(contact => contact.discordId === userId);
		if (match && match.name && match.name !== 'Unknown') {
			return match.name;
		}
	}
	catch (error) {
		console.error('[HourAudit] Failed to resolve reviewer name from Leadership sheet:', error.message);
	}
	console.warn(`[HourAudit] Reviewer ${userId} not found on the Leadership sheet — using Discord display name "${fallbackName}"`);
	return fallbackName;
}

/**
 * Handle a BD member claiming the review from message #1.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Object} session
 */
async function handleAuditClaim(interaction, session) {
	if (session.status !== 'unclaimed') {
		await interaction.reply({
			content: `❌ This audit is already being reviewed by <@${session.reviewerId}>.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const bdRoleId = process.env.BD_ROLE_ID;
	if (!interaction.inGuild() || !bdRoleId || !interaction.member?.roles?.cache?.has(bdRoleId)) {
		await interaction.reply({
			content: '❌ Only members of the Board of Directors can take this review.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (interaction.user.id === session.originalApproverId) {
		await interaction.reply({
			content: '❌ You made the original decision on this request — a different BD member must review it.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Claim synchronously (before any await) so a double-click can't win the race.
	session.status = 'claimed';
	session.reviewerId = interaction.user.id;
	session.reviewerName = interaction.member.displayName || interaction.user.username;

	try {
		await interaction.deferUpdate();

		// Swap in the reviewer's Leadership-sheet name for notes and messages.
		session.reviewerName = await resolveReviewerSheetName(session.reviewerId, session.reviewerName);

		const decisionEmbed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('🔍 Record Your Audit Decision')
			.setDescription(
				`<@${session.reviewerId}> re-review row ${session.rowNumber} `
				+ `(**${describeOriginalDecision(session)}** by ${session.originalApproverName}) and record your own decision. `
				+ 'Approve/Deny apply immediately; Change opens a modal for the corrected hours.',
			);
		const decisionMessage = await interaction.channel.send({
			embeds: [decisionEmbed],
			components: [buildAuditDecisionButtons(session.rowNumber)],
		});
		session.decisionMessageId = decisionMessage.id;
	}
	catch (error) {
		// Roll the claim back so the audit isn't stranded in a claimed state
		// with no decision buttons.
		session.status = 'unclaimed';
		session.reviewerId = null;
		session.reviewerName = null;
		session.decisionMessageId = null;
		console.error(`[HourAudit] Failed to start review for row ${session.rowNumber}:`, error.message);
		await interaction.followUp({
			content: '❌ Failed to start the review — please try again.',
			flags: MessageFlags.Ephemeral,
		}).catch(() => null);
		return;
	}

	try {
		const claimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
			.addFields({ name: 'Reviewer', value: `Being reviewed by <@${session.reviewerId}>` });
		await interaction.message.edit({ embeds: [claimedEmbed], components: [] });
	}
	catch (error) {
		// Non-fatal: the claim gate already rejects further claim clicks.
		console.error(`[HourAudit] Failed to edit audit message after claim for row ${session.rowNumber}:`, error.message);
	}

	persistAuditState(interaction.client);
	console.log(`[HourAudit] Row ${session.rowNumber} audit claimed by ${interaction.user.tag}`);
}

/**
 * Apply the reviewer's decision: confirm (note only) or override (sheet write),
 * then close out the audit messages and session.
 * @param {import('discord.js').ButtonInteraction|import('discord.js').ModalSubmitInteraction} interaction
 * @param {Object} session
 * @param {string} newVerdict - 'Approved' | 'Changed' | 'Denied'
 * @param {number|null} newHours - corrected hours when newVerdict is 'Changed'
 */
async function finalizeAuditDecision(interaction, session, newVerdict, newHours) {
	const client = interaction.client;
	const rowNumber = session.rowNumber;

	// Guard against a second decision racing this one (e.g. rapid double-click).
	if (session.finalizing || !client.hourAuditPending?.has(rowNumber)) {
		if (interaction.isModalSubmit()) {
			await interaction.editReply({ content: '❌ This audit was already completed.' }).catch(() => null);
		}
		return;
	}
	session.finalizing = true;

	const respondEphemeral = async (content) => {
		try {
			if (interaction.isModalSubmit()) {
				await interaction.editReply({ content });
			}
			else {
				await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
			}
		}
		catch (error) {
			console.error(`[HourAudit] Failed to reply for row ${rowNumber}:`, error.message);
		}
	};

	const isSame = newVerdict === session.originalVerdict
		&& (newVerdict !== 'Changed' || Number(newHours) === Number(session.originalNewHours));

	const newDecisionText = newVerdict === 'Changed'
		? `Changed (${session.originalNewHours ?? session.request.hours}->${newHours})`
		: newVerdict;

	let noteSuccess = true;

	if (isSame) {
		noteSuccess = await sheetsManager.appendHourVerificationNote(
			rowNumber,
			`BD review: ${newVerdict} confirmed by ${session.reviewerName}`,
		);
	}
	else {
		// Abort if the cell no longer holds the verdict being audited (manual sheet edit).
		const currentValue = await sheetsManager.getHourVerificationCellValue(rowNumber, session.targetColumnIndex);
		if (currentValue !== null && currentValue.trim() !== session.originalVerdict) {
			const cellUrl = await sheetsManager.buildHourVerificationCellUrl(rowNumber, session.targetColumnIndex);
			endAuditSession(client, rowNumber);
			try {
				const channel = await client.channels.fetch(session.channelId);
				const decisionMessage = await channel.messages.fetch(session.decisionMessageId);
				const embed = new EmbedBuilder()
					.setColor(0x95A5A6)
					.setTitle('⚠️ Audit Aborted — Sheet Changed')
					.setDescription(
						`The verdict cell was edited after the original decision (it now reads "${currentValue.trim() || 'empty'}"). `
						+ `Nothing was written. Please handle this manually: [open row ${rowNumber}](${cellUrl})`,
					);
				await decisionMessage.edit({ embeds: [embed], components: [] });
			}
			catch (error) {
				console.error(`[HourAudit] Failed to edit decision message for row ${rowNumber}:`, error.message);
			}
			await respondEphemeral('⚠️ Audit aborted — the sheet cell was changed since the original decision. Nothing was written.');
			return;
		}

		const statusSuccess = await sheetsManager.setConfirmerHourStatus(
			rowNumber,
			session.targetColumnIndex,
			newVerdict,
			null,
			null,
		);

		if (!statusSuccess) {
			// Keep the session and buttons alive so the reviewer can retry.
			session.finalizing = false;
			const cellUrl = await sheetsManager.buildHourVerificationCellUrl(rowNumber, session.targetColumnIndex);
			await respondEphemeral(
				`❌ Failed to update Google Sheets — try again, or update the cell manually: [open row ${rowNumber}](${cellUrl})`,
			);
			return;
		}

		if (newVerdict === 'Changed') {
			// The new hour numbers must lead the Notes cell for the sheet's
			// formulas; earlier content (e.g. the original X->Y) and the BD
			// annotation are kept after them.
			const effectiveOldHours = session.originalNewHours ?? session.request.hours;
			noteSuccess = await sheetsManager.setHourVerificationChangedNote(
				rowNumber,
				`${effectiveOldHours}->${newHours}`,
				`BD review: ${session.reviewerName} overrode ${session.originalVerdict} -> Changed`,
			);
		}
		else {
			noteSuccess = await sheetsManager.appendHourVerificationNote(
				rowNumber,
				`BD review: ${session.reviewerName} overrode ${session.originalVerdict} -> ${newVerdict}`,
			);
		}
	}

	// Tear down before message edits so a Discord failure can't leave a live
	// session pointing at an already-recorded decision.
	endAuditSession(client, rowNumber);

	let noteWarning = '';
	if (!noteSuccess) {
		const cellUrl = await sheetsManager.buildHourVerificationCellUrl(rowNumber, session.targetColumnIndex);
		noteWarning = `\n⚠️ Could not write the audit note — [add it manually](${cellUrl}).`;
		console.warn(`[HourAudit] Row ${rowNumber}: audit completed but failed to append the Note column`);
	}

	try {
		const channel = await client.channels.fetch(session.channelId);
		const decisionMessage = await channel.messages.fetch(session.decisionMessageId);
		const embed = isSame
			? new EmbedBuilder()
				.setColor(0x57F287)
				.setTitle('✅ Audit Complete — Decision Confirmed')
				.setDescription(
					`**${newVerdict}** confirmed by **${session.reviewerName}** `
					+ `(original decision by **${session.originalApproverName}**).${noteWarning}`,
				)
			: new EmbedBuilder()
				.setColor(0xED4245)
				.setTitle('🔁 Audit Complete — Decision Overridden')
				.setDescription(
					`Row ${rowNumber}: **${describeOriginalDecision(session)}** → **${newDecisionText}** `
					+ `by **${session.reviewerName}**.${noteWarning}`,
				);
		await decisionMessage.edit({ embeds: [embed], components: [] });

		if (isSame) {
			await channel.send(
				`✅ Audit of row ${rowNumber}: **${newVerdict}** confirmed by <@${session.reviewerId}>.`,
			);
		}
		else {
			await channel.send(
				`🔁 <@${session.reviewerId}> you overrode the original decision on row ${rowNumber} `
				+ `(**${describeOriginalDecision(session)}** → **${newDecisionText}**, originally by ${session.originalApproverName}). `
				+ 'Please post your reasoning in this channel.',
			);
		}
	}
	catch (error) {
		console.error(`[HourAudit] Failed to post audit outcome for row ${rowNumber}:`, error.message);
	}

	if (interaction.isModalSubmit()) {
		await respondEphemeral(
			isSame
				? `✅ Recorded **${newVerdict}** — matches the original decision.`
				: `✅ Recorded **${newDecisionText}** — overrides the original decision. Please post your reasoning in the channel.`,
		);
	}

	console.log(
		`[HourAudit] Row ${rowNumber} audit completed by ${interaction.user.tag}: `
		+ (isSame ? `confirmed ${newVerdict}` : `overrode ${session.originalVerdict} -> ${newDecisionText}`),
	);
}

/**
 * Handle claim and decision button clicks on audit messages in #nt-leaders
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} True if this handler consumed the interaction
 */
async function handleHourAuditButton(interaction) {
	if (!interaction.isButton()) {
		return false;
	}

	const claimMatch = interaction.customId.match(/^hour_audit_claim_(\d+)$/);
	const approveMatch = interaction.customId.match(/^hour_audit_approve_(\d+)$/);
	const changeMatch = interaction.customId.match(/^hour_audit_change_(\d+)$/);
	const denyMatch = interaction.customId.match(/^hour_audit_deny_(\d+)$/);
	const match = claimMatch || approveMatch || changeMatch || denyMatch;
	if (!match) {
		return false;
	}

	const rowNumber = parseInt(match[1], 10);
	const session = interaction.client.hourAuditPending?.get(rowNumber);
	if (!session) {
		await interaction.reply({
			content: '❌ This audit has expired or was already completed.',
			flags: MessageFlags.Ephemeral,
		});
		return true;
	}

	if (claimMatch) {
		await handleAuditClaim(interaction, session);
		return true;
	}

	// Decision buttons — only the claiming reviewer may act.
	if (session.status !== 'claimed' || interaction.user.id !== session.reviewerId) {
		await interaction.reply({
			content: '❌ Only the BD member who claimed this audit can use these buttons.',
			flags: MessageFlags.Ephemeral,
		});
		return true;
	}

	if (changeMatch) {
		const effectiveHours = session.originalNewHours ?? session.request.hours;
		const modal = new ModalBuilder()
			.setCustomId(`hour_audit_change_${rowNumber}`)
			.setTitle('Change Requested Hours');

		const hoursInput = new TextInputBuilder()
			.setCustomId('new_hours')
			.setLabel('Revised hours (recorded in Notes column)')
			.setStyle(TextInputStyle.Short)
			.setPlaceholder('e.g. 2 or 1.5')
			.setValue(effectiveHours === 'N/A' ? '' : String(effectiveHours))
			.setRequired(true)
			.setMaxLength(10);

		modal.addComponents(new ActionRowBuilder().addComponents(hoursInput));
		await interaction.showModal(modal);
		return true;
	}

	await interaction.deferUpdate();
	await finalizeAuditDecision(interaction, session, approveMatch ? 'Approved' : 'Denied', null);
	return true;
}

/**
 * Handle the audit Change modal submission
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @returns {Promise<boolean>} True if this handler consumed the interaction
 */
async function handleHourAuditModal(interaction) {
	if (!interaction.isModalSubmit()) {
		return false;
	}

	const match = interaction.customId.match(/^hour_audit_change_(\d+)$/);
	if (!match) {
		return false;
	}

	const rowNumber = parseInt(match[1], 10);
	// Re-fetch: the session may have expired while the modal was open.
	const session = interaction.client.hourAuditPending?.get(rowNumber);
	if (!session) {
		await interaction.reply({
			content: '❌ This audit has expired or was already completed.',
			flags: MessageFlags.Ephemeral,
		});
		return true;
	}

	if (session.status !== 'claimed' || interaction.user.id !== session.reviewerId) {
		await interaction.reply({
			content: '❌ Only the BD member who claimed this audit can record a decision.',
			flags: MessageFlags.Ephemeral,
		});
		return true;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const newHours = parseHoursInput(interaction.fields.getTextInputValue('new_hours'));
	if (newHours === null) {
		await interaction.editReply({
			content: '❌ Enter a valid number of hours greater than zero (e.g. `2` or `1.5`). Click Change to try again.',
		});
		return true;
	}

	await finalizeAuditDecision(interaction, session, 'Changed', newHours);
	return true;
}

module.exports = {
	maybeTriggerHourAudit,
	handleHourAuditButton,
	handleHourAuditModal,
	restoreHourAuditSessions,
};
