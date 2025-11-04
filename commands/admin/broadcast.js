const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasRequiredRole } = require('../../utils/helpers');

module.exports = {
	cooldown: 300, // 5 minute cooldown to prevent spam
	data: new SlashCommandBuilder()
		.setName('broadcast')
		.setDescription('Send a DM to all NT Members')
		.addStringOption(option =>
			option.setName('message')
				.setDescription('The message to broadcast')
				.setRequired(true))
		.addBooleanOption(option =>
			option.setName('confirm')
				.setDescription('Confirm you want to send this message to all NT Members')
				.setRequired(true)),
	async execute(interaction) {
		// Check if user has required role
		const allowedRoles = ['NT Executive Committee'];
		const member = interaction.member;

		if (!hasRequiredRole(member, allowedRoles)) {
			return interaction.reply({
				content: '❌ You do not have permission to use this command. Only EC members can broadcast messages.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const message = interaction.options.getString('message');
		const confirm = interaction.options.getBoolean('confirm');

		if (!confirm) {
			return interaction.reply({
				content: '❌ You must confirm to send the broadcast. Set the `confirm` option to `True`.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			// Get the NT Member role
			const ntMemberRoleId = process.env.NT_MEMBER_ROLE_ID;
			const ntMemberRole = interaction.guild.roles.cache.get(ntMemberRoleId);

			if (!ntMemberRole) {
				return interaction.editReply({
					content: `❌ Could not find NT Member role with ID: ${ntMemberRoleId}`,
				});
			}

			// Fetch all members with the NT Member role
			await interaction.guild.members.fetch();
			const ntMembers = interaction.guild.members.cache.filter(m => 
				m.roles.cache.has(ntMemberRoleId) && !m.user.bot
			);

			if (ntMembers.size === 0) {
				return interaction.editReply({
					content: '❌ No NT Members found to broadcast to.',
				});
			}

			// Send initial status
			await interaction.editReply({
				content: `📤 Broadcasting message to ${ntMembers.size} NT Member(s)...\n\n**Message:**\n${message}`,
			});

			// Send DMs to all NT Members
			let successCount = 0;
			let failCount = 0;
			const failedMembers = [];

			for (const [memberId, member] of ntMembers) {
				try {
					// Create an embed for the broadcast message
					const embed = new EmbedBuilder()
						.setColor(0x0099FF)
						.setTitle('Message from Project NexTech Leadership')
						.setDescription(message)
						.setFooter({ 
							text: `Sent by ${interaction.user.tag}`,
							iconURL: interaction.user.displayAvatarURL({ dynamic: true })
						})
						.setTimestamp();

					await member.send({ embeds: [embed] });
					successCount++;
				} catch (error) {
					failCount++;
					failedMembers.push(`${member.user.tag} (${member.user.id})`);
					console.error(`[Broadcast] Failed to send DM to ${member.user.tag}:`, error.message);
				}

				// Add a small delay to avoid rate limits
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			// Send final report
			const reportEmbed = new EmbedBuilder()
				.setColor(successCount > failCount ? 0x00FF00 : 0xFFAA00)
				.setTitle('📊 Broadcast Complete')
				.addFields(
					{ name: '✅ Successful', value: `${successCount}`, inline: true },
					{ name: '❌ Failed', value: `${failCount}`, inline: true },
					{ name: '📝 Message', value: message.length > 100 ? message.substring(0, 100) + '...' : message }
				)
				.setTimestamp();

			if (failedMembers.length > 0 && failedMembers.length <= 10) {
				reportEmbed.addFields({
					name: '⚠️ Failed Recipients',
					value: failedMembers.join('\n')
				});
			} else if (failedMembers.length > 10) {
				reportEmbed.addFields({
					name: '⚠️ Failed Recipients',
					value: `${failedMembers.length} members (too many to list)`
				});
			}

			await interaction.followUp({ embeds: [reportEmbed], flags: MessageFlags.Ephemeral });

		} catch (error) {
			console.error('[Broadcast] Error:', error);
			await interaction.editReply({
				content: `❌ An error occurred while broadcasting: ${error.message}`,
			});
		}
	},
};
