const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasRequiredRole } = require('../../utils/helpers');
const {
	getProjectGroupCategoryIds,
	resolveProjectGroupChannel,
	addMemberToProjectGroup,
	logProjectGroupAddition,
	getProjectGroupAutocompleteChoices,
} = require('../../utils/projectGroups');

/**
 * Build the "nothing matched" reply.
 * @param {string} groupInput - The raw group option value
 * @param {Object} resolution - Result of resolveProjectGroupChannel
 * @returns {string} User-facing error message
 */
function buildNotFoundMessage(groupInput, resolution) {
	const fallbackLine = resolution.slug
		? `no channel named \`#${resolution.slug}\` in the project group categories`
		: 'input has no valid channel-name characters';

	return `❌ Could not find a project group channel for \`${groupInput}\`.\n` +
		`• Channel name: ${fallbackLine}\n\n` +
		'Use the autocomplete suggestions, or create the channel first with `/createprojectgroup`.';
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('addtoprojectgroup')
		.setDescription('Add a member to a project group channel.')
		.addUserOption(option =>
			option.setName('user')
				.setDescription('The member to add to the project group channel')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('group')
				.setDescription('Project group channel name')
				.setRequired(true)
				.setAutocomplete(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async autocomplete(interaction) {
		try {
			const focusedValue = interaction.options.getFocused();
			await interaction.respond(await getProjectGroupAutocompleteChoices(interaction.guild, focusedValue));
		}
		catch (error) {
			console.error('Error in addtoprojectgroup autocomplete:', error);
			try {
				await interaction.respond([]);
			}
			catch (respondError) {
				console.error('Failed to respond to autocomplete:', respondError);
			}
		}
	},
	async execute(interaction) {
		try {
			// Permission guard: Verification Team + EC (Administrators always allowed)
			const allowedRoleIds = [
				process.env.VERIFICATION_TEAM_ROLE_ID,
				process.env.EC_ROLE_ID,
			].filter(Boolean);

			if (!hasRequiredRole(interaction.member, allowedRoleIds)) {
				return interaction.reply({
					content: '❌ You do not have permission to use this command. Only Verification Team, NT Executive Committee, and Administrators can add members to project groups.',
					flags: MessageFlags.Ephemeral,
				});
			}

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const targetUser = interaction.options.getUser('user');
			const groupInput = interaction.options.getString('group').trim();

			// 'none' is the autocomplete empty-state sentinel (same as /verifyuser regions)
			if (!groupInput || groupInput === 'none') {
				return interaction.editReply({
					content: '❌ No project group selected. Pick one from the autocomplete suggestions.',
				});
			}

			if (getProjectGroupCategoryIds().length === 0) {
				return interaction.editReply({
					content: '❌ No project group categories are configured (`PROJECT_GROUPS_CATEGORY_ID` / `PROJECT_GROUPS_CATEGORY_2_ID`). Please contact an administrator.',
				});
			}

			// The target must still be in the server — an overwrite for a missing member is useless
			const targetMember = interaction.guild.members.cache.get(targetUser.id)
				|| await interaction.guild.members.fetch(targetUser.id).catch(() => null);
			if (!targetMember) {
				return interaction.editReply({
					content: `❌ ${targetUser} is not a member of this server.`,
				});
			}

			const resolution = await resolveProjectGroupChannel(interaction.guild, groupInput);

			if (!resolution.channel) {
				return interaction.editReply({
					content: buildNotFoundMessage(groupInput, resolution),
				});
			}

			const addResult = await addMemberToProjectGroup(resolution.channel, targetUser.id);

			if (addResult.status === 'already') {
				return interaction.editReply({
					content: `ℹ️ ${targetUser} already has access to <#${resolution.channel.id}>. No changes made.`,
				});
			}

			if (addResult.status === 'failed') {
				return interaction.editReply({
					content: `❌ Failed to grant access to <#${resolution.channel.id}>: ${addResult.error}. Check that the bot has Manage Permissions on that channel.`,
				});
			}

			await logProjectGroupAddition(interaction.client, {
				userId: targetUser.id,
				channel: resolution.channel,
				executorId: interaction.user.id,
				source: 'command',
			});

			return interaction.editReply({
				content: `✅ Added ${targetUser} to <#${resolution.channel.id}>.`,
			});
		}
		catch (error) {
			console.error('[AddToProjectGroup] Error:', error);
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
