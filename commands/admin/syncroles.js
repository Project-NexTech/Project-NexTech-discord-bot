const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { hasRequiredRole } = require('../../utils/helpers');

module.exports = {
	cooldown: 60,
	data: new SlashCommandBuilder()
		.setName('syncroles')
		.setDescription('Sync NT Enrolled/Unenrolled roles based on membership status')
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async execute(interaction) {
		// Check if user has required role or permissions
		const allowedRoleIds = [
			process.env.VERIFICATION_TEAM_ROLE_ID,
			process.env.EC_ROLE_ID,
		].filter(Boolean); // Filter out undefined values
		const member = interaction.member;

		if (!hasRequiredRole(member, allowedRoleIds)) {
			return interaction.reply({
				content: '❌ You do not have permission to use this command. Only EC and Administrators can sync roles.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply();

		try {
		// Get the roles
		const ntEnrolledRole = interaction.guild.roles.cache.find(role =>
			role.name.toLowerCase().includes('nt enrolled'),
		);
		const ntUnenrolledRole = interaction.guild.roles.cache.find(role =>
			role.name.toLowerCase().includes('nt unenrolled'),
		);
		const ntBoardMemberRole = interaction.guild.roles.cache.find(role =>
			role.name.toLowerCase().includes('nt board member'),
		);

		if (!ntEnrolledRole || !ntUnenrolledRole) {
			return interaction.editReply({
				content: '❌ Could not find NT Enrolled or NT Unenrolled roles. Please check role names.',
				flags: MessageFlags.Ephemeral,
			});
		}			// Fetch membership data
			const membershipData = await sheetsManager.getMembershipStatus();

			if (!membershipData || membershipData.length === 0) {
				return interaction.editReply({
					content: '❌ No membership data found.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Counters
			let enrolled = 0;
			let unenrolled = 0;
			let skipped = 0;
			let errors = 0;
			let newlyAssigned = 0;
			let enrolledToUnenrolled = 0;
			let unenrolledToEnrolled = 0;

		// Process each member
		for (const data of membershipData) {
			try {
				// Skip if status is Unknown or user not found
				if (data.status === 'Unknown' || !data.discordId) {
					skipped++;
					continue;
				}

				// Try to fetch the member from the guild
				let guildMember;
				try {
					// Try to get from cache first, then fetch if not found
					guildMember = interaction.guild.members.cache.get(data.discordId);
					if (!guildMember) {
						guildMember = await interaction.guild.members.fetch(data.discordId);
					}
				}
				catch (fetchError) {
					// User not in server
					skipped++;
					continue;
				}

				// Skip if user has NT Board Member role
				if (ntBoardMemberRole && guildMember.roles.cache.has(ntBoardMemberRole.id)) {
					skipped++;
					continue;
				}					// Determine which role to add/remove based on status
					// Normalize status by trimming whitespace
					const normalizedStatus = data.status ? data.status.trim() : null;

					// Capture role state before making changes
					const hadEnrolled = guildMember.roles.cache.has(ntEnrolledRole.id);
					const hadUnenrolled = guildMember.roles.cache.has(ntUnenrolledRole.id);

					if (normalizedStatus === 'Not a Member' || !normalizedStatus) {
						// Remove NT Enrolled, Add NT Unenrolled
						if (hadEnrolled) {
							await guildMember.roles.remove(ntEnrolledRole);
						}
						if (!hadUnenrolled) {
							await guildMember.roles.add(ntUnenrolledRole);
						}
						unenrolled++;
						if (hadEnrolled) {
							enrolledToUnenrolled++;
						}
						else if (!hadUnenrolled) {
							newlyAssigned++;
						}
					}
					else if (normalizedStatus === 'Paused' || normalizedStatus === 'Member' || normalizedStatus === 'New Member') {
						// Remove NT Unenrolled, Add NT Enrolled
						if (hadUnenrolled) {
							await guildMember.roles.remove(ntUnenrolledRole);
						}
						if (!hadEnrolled) {
							await guildMember.roles.add(ntEnrolledRole);
						}
						enrolled++;
						if (hadUnenrolled) {
							unenrolledToEnrolled++;
						}
						else if (!hadEnrolled) {
							newlyAssigned++;
						}
					}
					else {
						// Unknown status
						skipped++;
					}
				}
				catch (error) {
					console.error(`Error processing user ${data.name}:`, error);
					errors++;
				}
			}

			// Create success embed
			const embed = new EmbedBuilder()
				.setColor(0x57F287)
				.setTitle('✅ Role Sync Complete')
				.setDescription('Membership roles have been synchronized with the Google Sheet.')
				.addFields(
					{ name: '✅ NT Enrolled', value: enrolled.toString(), inline: true },
					{ name: '❌ NT Unenrolled', value: unenrolled.toString(), inline: true },
					{ name: '⏭️ Skipped', value: skipped.toString(), inline: true },
					{ name: '⚠️ Errors', value: errors.toString(), inline: true },
					{ name: '📊 Total Processed', value: membershipData.length.toString(), inline: true },				{ name: '🆕 Newly Assigned', value: newlyAssigned.toString(), inline: true },
				{ name: '📉 Enrolled → Unenrolled', value: enrolledToUnenrolled.toString(), inline: true },
				{ name: '📈 Unenrolled → Enrolled', value: unenrolledToEnrolled.toString(), inline: true },				)
				.setTimestamp()
				.setFooter({ text: 'Project NexTech Role Sync' });

			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('Error in /syncroles command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while syncing roles. Please try again later.',
			});
		}
	},
};
