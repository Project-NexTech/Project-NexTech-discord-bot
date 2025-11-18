const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasRequiredRole } = require('../../utils/helpers');

module.exports = {
	cooldown: 60, // 1 minute cooldown to prevent spam
	data: new SlashCommandBuilder()
		.setName('broadcast')
		.setDescription('Send a DM to all NT Members')
		.addStringOption(option =>
			option.setName('message')
				.setDescription('The message to broadcast')
				.setRequired(true)),
	async execute(interaction) {
		try {
			console.log('[Broadcast] Command started');
			
			// Check if user has required role
			const allowedRoleIds = [
				process.env.EC_ROLE_ID
			].filter(Boolean); // Filter out undefined values
			const member = interaction.member;

			if (!hasRequiredRole(member, allowedRoleIds)) {
				console.log('[Broadcast] User does not have required role');
				return interaction.reply({
					content: '❌ You do not have permission to use this command. EC and Administrators can broadcast messages.',
					flags: MessageFlags.Ephemeral,
				});
			}

			console.log('[Broadcast] Permission check passed');
			
			// Defer reply early to prevent timeout
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			console.log('[Broadcast] Reply deferred');
			
			const message = interaction.options.getString('message');

			// Get the NT Member role to count recipients
			const ntMemberRoleId = process.env.NT_MEMBER_ROLE_ID;
			console.log('[Broadcast] NT Member Role ID:', ntMemberRoleId);
			
			const ntMemberRole = interaction.guild.roles.cache.get(ntMemberRoleId);

			if (!ntMemberRole) {
				console.log('[Broadcast] NT Member role not found');
				return interaction.editReply({
					content: `❌ Could not find NT Member role with ID: ${ntMemberRoleId}`,
				});
			}

			console.log('[Broadcast] Checking member cache...');
			// Check if we need to fetch members (cache might be cold)
			// The ready.js event keeps the cache warm, but we'll check just in case
			if (interaction.guild.members.cache.size === 0) {
				console.log('[Broadcast] Cache is empty, fetching members...');
				await interaction.guild.members.fetch({ force: true });
				console.log('[Broadcast] Members fetched');
			} else {
				console.log(`[Broadcast] Using cached members (${interaction.guild.members.cache.size} in cache)`);
			}
			
			const ntMembers = interaction.guild.members.cache.filter(m => 
				m.roles.cache.has(ntMemberRoleId) && !m.user.bot
			);

			console.log(`[Broadcast] Found ${ntMembers.size} NT Members`);

			if (ntMembers.size === 0) {
				return interaction.editReply({
					content: '❌ No NT Members found to broadcast to.',
				});
			}

			// Create confirmation buttons
			const confirmButton = new ButtonBuilder()
				.setCustomId(`broadcast_confirm_${interaction.id}`)
				.setLabel('✅ Send Broadcast')
				.setStyle(ButtonStyle.Danger);

			const cancelButton = new ButtonBuilder()
				.setCustomId(`broadcast_cancel_${interaction.id}`)
				.setLabel('❌ Cancel')
				.setStyle(ButtonStyle.Secondary);

			const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

			// Create preview embed
			const previewEmbed = new EmbedBuilder()
				.setColor(0xFFAA00)
				.setTitle('⚠️ Broadcast Confirmation Required')
				.setDescription(`You are about to send the following message to **${ntMembers.size} NT Member(s)**:`)
				.addFields(
					{ name: '📝 Message Preview', value: message },
					{ name: '👥 Recipients', value: `${ntMembers.size} NT Members` }
				)
				.setFooter({ text: 'Click "Send Broadcast" to confirm or "Cancel" to abort' })
				.setTimestamp();

			console.log('[Broadcast] Sending confirmation message...');
			await interaction.editReply({
				embeds: [previewEmbed],
				components: [row],
			});
			console.log('[Broadcast] Confirmation message sent');

			// Create collector for button interactions
			const collectorFilter = i => {
				return i.user.id === interaction.user.id && 
				       (i.customId === `broadcast_confirm_${interaction.id}` || 
				        i.customId === `broadcast_cancel_${interaction.id}`);
			};

			// Get the message from the interaction to attach the collector
			const response = await interaction.fetchReply();
			const collector = response.createMessageComponentCollector({ 
				filter: collectorFilter, 
				time: 60_000 
			});

			collector.on('collect', async (buttonInteraction) => {
				try {
					if (buttonInteraction.customId === `broadcast_cancel_${interaction.id}`) {
						await buttonInteraction.update({
							content: '❌ Broadcast cancelled.',
							embeds: [],
							components: [],
						});
						collector.stop();
						return;
					}

					// User confirmed, proceed with broadcast
					await buttonInteraction.update({
						content: `📤 Broadcasting message to ${ntMembers.size} NT Member(s)...\n\n**Message:**\n${message}`,
						embeds: [],
						components: [],
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
					collector.stop();
					
				} catch (error) {
					console.error('[Broadcast] Error in button handler:', error);
					await buttonInteraction.update({
						content: `❌ An error occurred while broadcasting: ${error.message}`,
						embeds: [],
						components: [],
					});
					collector.stop();
				}
			});

			collector.on('end', async (collected, reason) => {
				if (reason === 'time') {
					// Timeout occurred
					await interaction.editReply({
						content: '❌ Broadcast confirmation timed out after 60 seconds. Please try again.',
						embeds: [],
						components: [],
					});
				}
			});
		} catch (error) {
			console.error('[Broadcast] Error in execute:', error);
			console.error(error.stack);
			
			// Try to respond with error if we haven't replied yet
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: `❌ An error occurred: ${error.message}`,
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.editReply({
					content: `❌ An error occurred: ${error.message}`,
				});
			}
		}
	},
};
