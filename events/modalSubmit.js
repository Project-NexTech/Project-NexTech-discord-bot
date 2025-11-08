const { Events, EmbedBuilder, MessageFlags } = require('discord.js');
const sheetsManager = require('../utils/sheets');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isModalSubmit()) return;

		// Handle nickname conflict resolution modal
		if (interaction.customId.startsWith('nickname_conflict_')) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			try {
				const ids = interaction.customId.replace('nickname_conflict_', '').split('_');
				const newUserId = ids[0];
				const conflictingUserId = ids[1];

				// Get pending verification data
				if (!interaction.client.verificationPending || !interaction.client.verificationPending.has(newUserId)) {
					return interaction.editReply({
						content: '❌ Verification session expired. Please run the /verifyuser command again.',
					});
				}

				const pendingData = interaction.client.verificationPending.get(newUserId);
				const {
					userData,
					targetMember,
					conflictingMember,
					regionRole,
					countryRole,
					ntMemberRole,
					serverMemberRole,
					onlineMemberRole,
					ntUnenrolledRole,
					ntChatChannelId,
					staffChatChannelId,
					missingFields,
					warningMessage,
					timeoutId,
					hadNtUnverified,
					hadCombinedUnverified,
				} = pendingData;

				// Clear the timeout since modal was submitted
				if (timeoutId) {
					clearTimeout(timeoutId);
				}

				// Get nicknames from modal
				const newUserNickname = interaction.fields.getTextInputValue('new_user_nickname');
				const existingUserNickname = interaction.fields.getTextInputValue('existing_user_nickname');

				// Assign roles first
				const rolesToRemove = [];
				if (hadNtUnverified && targetMember.roles.cache.has(targetMember.guild.roles.cache.find(r => r.name.toLowerCase().includes('nextech unverified'))?.id)) {
					const ntUnverifiedRole = targetMember.guild.roles.cache.find(r => r.name.toLowerCase().includes('nextech unverified'));
					if (ntUnverifiedRole) rolesToRemove.push(ntUnverifiedRole);
				}
				if (hadCombinedUnverified && targetMember.roles.cache.has(targetMember.guild.roles.cache.find(r => r.name.toLowerCase().includes('combined unverified'))?.id)) {
					const combinedUnverifiedRole = targetMember.guild.roles.cache.find(r => r.name.toLowerCase().includes('combined unverified'));
					if (combinedUnverifiedRole) rolesToRemove.push(combinedUnverifiedRole);
				}

				if (rolesToRemove.length > 0) {
					await targetMember.roles.remove(rolesToRemove.filter(Boolean));
				}

				if (ntMemberRole) {
					await targetMember.roles.add(ntMemberRole);
				}

				if (hadCombinedUnverified) {
					if (userData.hasIRLConnection && serverMemberRole) {
						await targetMember.roles.add(serverMemberRole);
					}
					else if (!userData.hasIRLConnection && onlineMemberRole) {
						await targetMember.roles.add(onlineMemberRole);
					}
				}

				// Add NT Unenrolled role
				if (ntUnenrolledRole) {
					await targetMember.roles.add(ntUnenrolledRole);
				}

				// Add region and country roles if selected
				if (regionRole) {
					await targetMember.roles.add(regionRole);
				}
				if (countryRole) {
					await targetMember.roles.add(countryRole);
				}

				// Set both nicknames
				try {
					await targetMember.setNickname(`[ɴᴛ] ${newUserNickname}`);
					console.log(`Set nickname for ${targetMember.user.tag} to [ɴᴛ] ${newUserNickname}`);
				} catch (nickError) {
					console.error(`Failed to set nickname for ${targetMember.user.tag}:`, nickError);
				}

				try {
					await conflictingMember.setNickname(`[ɴᴛ] ${existingUserNickname}`);
					console.log(`Set nickname for ${conflictingMember.user.tag} to [ɴᴛ] ${existingUserNickname}`);
				} catch (nickError) {
					console.error(`Failed to set nickname for ${conflictingMember.user.tag}:`, nickError);
				}

				// Log verification to Google Sheets
				const sheetLogged = await sheetsManager.verifyUser(userData);
				if (!sheetLogged) {
					console.error('Failed to log verification to Google Sheets');
					await interaction.followUp({
						content: '⚠️ Warning: Verification completed but failed to log to Google Sheets. Please manually add the entry.',
						flags: MessageFlags.Ephemeral,
					});
				}

				// Create success embed
				const embed = new EmbedBuilder()
					.setColor(0x57F287)
					.setTitle('✅ User Verified Successfully')
					.setDescription(`${targetMember.user} has been verified and logged in the system.\n\n**Nickname Conflict Resolved:**\n• ${targetMember.user}: \`[ɴᴛ] ${newUserNickname}\`\n• ${conflictingMember.user}: \`[ɴᴛ] ${existingUserNickname}\``)
					.addFields(
						{ name: 'Name', value: userData.name, inline: true },
						{ name: 'Grade', value: userData.grade || 'N/A', inline: true },
						{ name: 'School', value: userData.school || 'N/A', inline: true },
						{ name: 'Region', value: userData.region || 'N/A', inline: true },
						{ name: 'Robotics Team', value: userData.roboticsTeam || 'N/A', inline: true },
						{ name: 'Invite Source', value: userData.inviteSource || 'N/A', inline: true },
						{ name: 'IRL Connection', value: userData.hasIRLConnection ? 'Yes' : 'No', inline: true },
						{ name: 'Verified By', value: interaction.user.username, inline: true },
					)
					.setTimestamp()
					.setFooter({ text: 'Project NexTech Verification' });

				if (warningMessage) {
					embed.setDescription(embed.data.description + warningMessage);
				}

				// Send embed to staff chat channel
				if (staffChatChannelId) {
					try {
						const staffChatChannel = await interaction.client.channels.fetch(staffChatChannelId);
						if (staffChatChannel) {
							await staffChatChannel.send({ embeds: [embed] });
						} else {
							console.error('Staff chat channel not found');
						}
					} catch (channelError) {
						console.error('Could not send verification embed to staff chat:', channelError);
					}
				}

				// Send confirmation to the command user
				await interaction.editReply({
					content: `✅ Successfully verified ${targetMember.user}!\n\n**Nicknames Updated:**\n• ${targetMember.user}: \`[ɴᴛ] ${newUserNickname}\`\n• ${conflictingMember.user}: \`[ɴᴛ] ${existingUserNickname}\`\n\nDetails have been logged to staff chat.`,
				});

				// Send welcome message to NT chat channel
				try {
					if (ntChatChannelId) {
						const ntChatChannel = await interaction.client.channels.fetch(ntChatChannelId);
						if (ntChatChannel) {
							const welcomeChannelMessage = `Welcome to Project NexTech, ${targetMember.user}! Please check <#1231776603126890671> for updates every few days and get your roles in <#1231777272906649670>. You can select any departments/subjects you are interested in. <#1386576733674668052> has useful information to get started. New members should go to one of our online info sessions. We will announce in <#1231776603126890671> when we will have one.`;
							await ntChatChannel.send(welcomeChannelMessage);
						}
					}
				} catch (channelError) {
					console.error('Could not send welcome message to NT chat channel:', channelError);
				}

				// Clean up pending verification data
				interaction.client.verificationPending.delete(newUserId);

			} catch (error) {
				console.error('Error processing nickname conflict resolution:', error);
				console.error(error.stack);
				await interaction.editReply({
					content: '❌ An error occurred while resolving the nickname conflict. Please try again.',
				});
			}
			return;
		}

		if (interaction.customId === 'verificationModal') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			try {
				const fullName = interaction.fields.getTextInputValue('fullName');
				const grade = interaction.fields.getTextInputValue('grade');
				const school = interaction.fields.getTextInputValue('school');
				const region = interaction.fields.getTextInputValue('region');
				const roboticsAndReferral = interaction.fields.getTextInputValue('roboticsAndReferral');
				
				// Parse the combined field (Line 1: How found us, Line 2: Robotics team)
				const lines = roboticsAndReferral.split('\n');
				const referralSource = lines[0]?.trim() || 'Not specified';
				const roboticsTeam = lines.slice(1).join('\n').trim() || 'N/A';

				// Get staff chat channel for verification review
				const verificationChannelId = process.env.STAFF_CHAT_CHANNEL_ID;
				if (!verificationChannelId) {
					console.error('STAFF_CHAT_CHANNEL_ID not set in environment variables');
					return interaction.editReply({
						content: '❌ Verification system is not properly configured. Please contact an administrator.',
						flags: MessageFlags.Ephemeral,
					});
				}

				const verificationChannel = await interaction.client.channels.fetch(verificationChannelId);
				if (!verificationChannel) {
					console.error('Could not find staff chat channel');
					return interaction.editReply({
						content: '❌ Could not access verification channel. Please contact an administrator.',
						flags: MessageFlags.Ephemeral,
					});
				}

				// Create verification submission embed
				const embed = new EmbedBuilder()
					.setColor(0x5865F2)
					.setTitle('🆕 New Verification Submission')
					.setDescription(`${interaction.user} has submitted a verification request.`)
					.setThumbnail(interaction.user.displayAvatarURL())
					.addFields(
						{ name: '👤 Discord User', value: `<@${interaction.user.id}>\n${interaction.user.tag}`, inline: false },
						{ name: '📝 Full Name', value: fullName, inline: true },
						{ name: '🎓 Grade', value: grade, inline: true },
						{ name: '🏫 School', value: school, inline: true },
						{ name: '📍 Region', value: region, inline: true },
						{ name: '🤖 Robotics Team', value: roboticsTeam, inline: true },
						{ name: '💡 How They Found Us', value: referralSource, inline: false },
					)
					.setTimestamp()
					.setFooter({ text: `User ID: ${interaction.user.id}` });

				await verificationChannel.send({ 
					content: `<@&${process.env.VERIFICATION_TEAM_ROLE_ID || '000000000000000000'}> New verification pending!`,
					embeds: [embed],
				});

				// Send confirmation to user
				const confirmationEmbed = new EmbedBuilder()
					.setColor(0x57F287)
					.setTitle('✅ Verification Submitted')
					.setDescription('Thank you for submitting your verification! Our team will review your information shortly.')
					.addFields(
						{ name: '⏱️ What\'s Next?', value: 'A member of the verification team will review your submission and grant you access to the server. This usually takes a few hours.' },
					)
					.setTimestamp()
					.setFooter({ text: 'Project NexTech' });

				await interaction.editReply({ embeds: [confirmationEmbed] });

			}
			catch (error) {
				console.error('Error processing verification submission:', error);
				await interaction.editReply({
					content: '❌ An error occurred while submitting your verification. Please try again later or contact an administrator.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
