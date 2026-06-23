const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { hasRequiredRole } = require('../../utils/helpers');

/**
 * Convert a display name into a valid Discord channel name.
 * @param {string} name - Original display name
 * @returns {string} Slugified channel name
 */
function slugify(name) {
	return name
		.toLowerCase()
		.replace(/\s+/g, '-') // whitespace runs -> single dash
		.replace(/[^a-z0-9-]/g, '') // strip invalid characters
		.replace(/-+/g, '-') // collapse consecutive dashes
		.replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('createprojectgroup')
		.setDescription('Create a Discord channel for a project group.')
		.addStringOption(option =>
			option.setName('name')
				.setDescription('Display name for the channel (will be slugified automatically)')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('code')
				.setDescription('Project group code — must match a tab name in the Project Group Tracker')
				.setRequired(true)),
	async execute(interaction) {
		try {
			// Permission guard: NT Executive Committee only (Administrators always allowed)
			const allowedRoleIds = [process.env.EC_ROLE_ID].filter(Boolean);

			if (!hasRequiredRole(interaction.member, allowedRoleIds)) {
				return interaction.reply({
					content: '❌ You do not have permission to use this command. Only NT Executive Committee can create project group channels.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Step 1 — Defer ephemerally (sheet lookups may be slow)
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const name = interaction.options.getString('name');
			const code = interaction.options.getString('code');
			const slugifiedName = slugify(name);

			if (!slugifiedName) {
				return interaction.editReply({
					content: '❌ The provided name has no valid channel-name characters (letters or numbers). Please choose a different name.',
				});
			}

			// Validate the target category before doing any sheet work
			const categoryId = process.env.PROJECT_GROUPS_CATEGORY_ID;
			if (!categoryId) {
				return interaction.editReply({
					content: '❌ `PROJECT_GROUPS_CATEGORY_ID` is not configured. Please contact an administrator.',
				});
			}

			let category;
			try {
				category = await interaction.guild.channels.fetch(categoryId);
			}
			catch {
				category = null;
			}

			if (!category) {
				return interaction.editReply({
					content: '❌ Could not fetch the Project Groups category. Check that `PROJECT_GROUPS_CATEGORY_ID` is correct.',
				});
			}

			// Step 2 — Sheet lookup
			const result = await sheetsManager.getProjectGroupMembers(code);

			if (result === null) {
				return interaction.editReply({
					content: '❌ Failed to access the Project Group Tracker sheet. Check bot logs.',
				});
			}

			if (!result.found) {
				return interaction.editReply({
					content: `❌ No project group tab found with code \`${code}\`.`,
				});
			}

			// Step 3 — Name resolution against the Verification sheet
			const resolution = await sheetsManager.resolveNamesToDiscordIds(result.rawNames);

			if (resolution === null) {
				return interaction.editReply({
					content: '❌ Failed to access the Verification sheet for name resolution. Check bot logs.',
				});
			}

			const { matched, unmatched } = resolution;

			// Members who left the server (red row) can't be granted access — skip them
			const activeMatched = matched.filter(m => !m.left);
			const leftMatched = matched.filter(m => m.left);

			// Step 4 — Confirmation message
			const matchedList = activeMatched.length > 0
				? activeMatched.map(m => `<@${m.discordId}> — ${m.name}`).join('\n')
				: '(none found)';

			const channelLineSuffix = slugifiedName !== name ? ` (original input: \`${name}\`)` : '';

			const embed = new EmbedBuilder()
				.setColor(0xF24C02)
				.setTitle('📁 Create Project Group Channel')
				.addFields(
					{ name: 'Channel to be created', value: `#${slugifiedName}${channelLineSuffix}`, inline: false },
					{ name: 'Category', value: category.name, inline: false },
					{ name: 'Members to be added', value: matchedList, inline: false },
				);

			if (leftMatched.length > 0) {
				embed.addFields({
					name: '⚠️ Left the server (will be skipped)',
					value: `${leftMatched.map(m => `${m.name}`).join('\n')}\n\n*These users left the server and will not be added.*`,
					inline: false,
				});
			}

			if (unmatched.length > 0) {
				embed.addFields({
					name: '⚠️ Names not found in Verification sheet',
					value: `${unmatched.join('\n')}\n\n*These users will not be added to the channel.*`,
					inline: false,
				});
			}

			const confirmButton = new ButtonBuilder()
				.setCustomId(`confirm_cpg_${interaction.id}`)
				.setLabel('Create Channel')
				.setStyle(ButtonStyle.Success);

			const cancelButton = new ButtonBuilder()
				.setCustomId(`cancel_cpg_${interaction.id}`)
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Danger);

			const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

			// Step 5 — Store pending state (auto-expires after 5 minutes)
			if (!interaction.client.projectGroupPending) {
				interaction.client.projectGroupPending = new Map();
			}

			interaction.client.projectGroupPending.set(interaction.id, {
				slugifiedName,
				originalName: name,
				code,
				matched,
				unmatched,
				executorId: interaction.user.id,
				timeoutId: setTimeout(() => interaction.client.projectGroupPending.delete(interaction.id), 5 * 60 * 1000),
			});

			await interaction.editReply({
				embeds: [embed],
				components: [row],
			});
		}
		catch (error) {
			console.error('[CreateProjectGroup] Error:', error);
			const errorMessage = `❌ An error occurred: ${error.message}`;

			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: errorMessage, embeds: [], components: [] }).catch(() => null);
			}
			else {
				await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => null);
			}
		}
	},
};
