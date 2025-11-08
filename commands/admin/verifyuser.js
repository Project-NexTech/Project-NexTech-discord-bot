const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { hasRequiredRole } = require('../../utils/helpers');

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('verifyuser')
		.setDescription('Verify a new member and assign roles')
		.addUserOption(option =>
			option
				.setName('user')
				.setDescription('The user to verify')
				.setRequired(true),
		)
		.addStringOption(option =>
			option
				.setName('name')
				.setDescription('Full name of the user')
				.setRequired(true),
		)
		.addBooleanOption(option =>
			option
				.setName('irl_connection')
				.setDescription('Does this person have an IRL connection to an existing member?')
				.setRequired(true),
		)
		.addStringOption(option =>
			option
				.setName('grade')
				.setDescription('Grade level')
				.setRequired(false)
				.addChoices(
					{ name: '7th grade', value: '7th grade' },
					{ name: '8th grade', value: '8th grade' },
					{ name: '9th grade', value: '9th grade' },
					{ name: '10th grade', value: '10th grade' },
					{ name: '11th grade', value: '11th grade' },
					{ name: '12th grade', value: '12th grade' },
					{ name: '1st year college', value: '1st year college' },
					{ name: '2nd year college', value: '2nd year college' },
					{ name: '3rd year college', value: '3rd year college' },
					{ name: 'Other college', value: 'Other college' },
				),
		)
		.addStringOption(option =>
			option
				.setName('school')
				.setDescription('School name')
				.setRequired(false),
		)
		.addStringOption(option =>
			option
				.setName('region')
				.setDescription('Region')
				.setRequired(false)
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option
				.setName('robotics_team')
				.setDescription('Robotics team number or name')
				.setRequired(false),
		)
		.addStringOption(option =>
			option
				.setName('invite_source')
				.setDescription('How they found out about NT')
				.setRequired(false),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async autocomplete(interaction) {
		try {
			const focusedValue = interaction.options.getFocused().toLowerCase();
			
			// Get all region roles that match the pattern: "Region Name (CC #)"
			// Example: "San Diego (US 1)"
			const regionPattern = /^.+\s\([A-Z]{2}\s\d+\)$/i; // Case insensitive
			
			const allRegionRoles = interaction.guild.roles.cache
				.filter(role => regionPattern.test(role.name))
				.map(role => ({
					name: role.name,
					value: role.name,
				}))
				.sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
			
			// Filter based on user input
			const filteredRoles = focusedValue 
				? allRegionRoles.filter(choice => choice.name.toLowerCase().includes(focusedValue))
				: allRegionRoles;
			
			// Limit to 25 choices
			const choices = filteredRoles.slice(0, 25);

			// Always return an array, even if empty
			await interaction.respond(choices.length > 0 ? choices : [{ name: 'No regions found', value: 'none' }]);
		}
		catch (error) {
			console.error('Error in verifyuser autocomplete:', error);
			console.error(error.stack);
			// Return empty response on error
			try {
				await interaction.respond([]);
			}
			catch (respondError) {
				console.error('Failed to respond to autocomplete:', respondError);
			}
		}
	},
	async execute(interaction) {
		// Check if user has required role or permissions
		const allowedRoles = ['Verification Team', 'EC', 'Leadership'];
		const member = interaction.member;

		if (!hasRequiredRole(member, allowedRoles) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({
				content: '❌ You do not have permission to use this command. Only Verification Team members, EC, Leadership, and Administrators can verify users.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const targetUser = interaction.options.getUser('user');
			const targetMember = await interaction.guild.members.fetch(targetUser.id);
			
			// Get all required roles at the start
			const ntUnverifiedRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('nextech unverified'),
			);
			const combinedUnverifiedRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('combined unverified'),
			);
			const ntMemberRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('nt member'),
			);
			const serverMemberRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('server member'),
			);
			const onlineMemberRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('online member'),
			);
			const ntUnenrolledRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('nt unenrolled'),
			);

			// Check if user has unverified role before proceeding
			const hasNtUnverified = ntUnverifiedRole && targetMember.roles.cache.has(ntUnverifiedRole.id);
			const hasCombinedUnverified = combinedUnverifiedRole && targetMember.roles.cache.has(combinedUnverifiedRole.id);

			if (!hasNtUnverified && !hasCombinedUnverified) {
				return interaction.editReply({
					content: `❌ **Cannot Verify User**\n\n${targetUser} does not have the "NexTech Unverified" or "Combined Unverified" role. This user may already be verified or may not need verification.`,
					flags: MessageFlags.Ephemeral,
				});
			}
			
			// Get region string and validate
			const regionName = interaction.options.getString('region');
			let regionRole = null;
			let countryRole = null;
			
			if (regionName && regionName !== 'none') {
				// Validate region format: "Region Name (CC #)"
				const regionPattern = /^.+\s\(([A-Z]{2})\s\d+\)$/i;
				const match = regionName.match(regionPattern);
				
				if (!match) {
					return interaction.editReply({
						content: '❌ Invalid region format. Please select a region from the autocomplete list.',
						flags: MessageFlags.Ephemeral,
					});
				}
				
				// Find the region role
				regionRole = interaction.guild.roles.cache.find(role => role.name === regionName);
				
				if (!regionRole) {
					return interaction.editReply({
						content: '❌ Region role not found. Please select a valid region from the autocomplete list.',
						flags: MessageFlags.Ephemeral,
					});
				}
				
				// Extract country code and find country role
				const countryCode = match[1]; // e.g., "US"
				// Country role format: "Country Name (CC)"
				countryRole = interaction.guild.roles.cache.find(role => {
					const countryPattern = new RegExp(`^.+\\s\\(${countryCode}\\)$`);
					return countryPattern.test(role.name) && !role.name.includes(countryCode + ' ');
				});
			}
			
			// Get all options
			const userData = {
				discordId: targetUser.id,
				username: targetUser.username,
				name: interaction.options.getString('name'),
				grade: interaction.options.getString('grade'),
				school: interaction.options.getString('school'),
				region: regionRole ? regionRole.name : null,
				roboticsTeam: interaction.options.getString('robotics_team'),
				inviteSource: interaction.options.getString('invite_source'),
				hasIRLConnection: interaction.options.getBoolean('irl_connection') ?? false,
				verifiedBy: interaction.user.username,
			};

			// Check for missing optional fields
			const missingFields = [];
			if (!userData.grade) missingFields.push('grade');
			if (!userData.school) missingFields.push('school');
			if (!userData.region) missingFields.push('region');
			if (!userData.roboticsTeam) missingFields.push('robotics team');
			if (!userData.inviteSource) missingFields.push('invite source');

			let warningMessage = '';
			if (missingFields.length > 0) {
				warningMessage = `\n⚠️ **Warning:** Missing optional fields: ${missingFields.join(', ')}`;
			}

			// Store which unverified roles the user had (needed for pending verification state)
			const hadNtUnverified = ntUnverifiedRole && targetMember.roles.cache.has(ntUnverifiedRole.id);
			const hadCombinedUnverified = combinedUnverifiedRole && targetMember.roles.cache.has(combinedUnverifiedRole.id);

			// ============================================
			// STEP 1: Handle nickname conflict detection BEFORE everything else
			// ============================================
			let newUserNickname = null;
			let conflictingMemberToUpdate = null;
			let conflictingMemberNewNickname = null;

			try {
				// Parse the user's name
				const nameParts = userData.name.trim().split(/\s+/);
				const firstName = nameParts[0];
				const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
				const lastInitial = lastName ? lastName.charAt(0).toUpperCase() : '';

				const ntMemberRoleCheck = interaction.guild.roles.cache.find(role =>
					role.name.toLowerCase().includes('nt member'),
				);
				
				let conflictingMember = null;
				
				if (ntMemberRoleCheck) {
					// Use cached members only (instant, no rate limit)
					// Discord.js automatically caches members with GuildMembers intent
					const membersToCheck = interaction.guild.members.cache;
					
					// Find ALL members with the same first name (ignore the [ɴᴛ] prefix)
					const membersWithSameFirstName = membersToCheck.filter(member => {
						if (member.id === targetMember.id) return false;
						if (!member.roles.cache.has(ntMemberRoleCheck.id)) return false;
						
						const nick = member.nickname || member.user.username;
						// Remove [ɴᴛ] prefix if it exists
						const cleanNick = nick.replace(/^\[ɴᴛ\]\s*/i, '');
						const nickFirstName = cleanNick.trim().split(/\s+/)[0];
						return nickFirstName.toLowerCase() === firstName.toLowerCase();
					});

					console.log(`[Nickname Conflict Debug] Found ${membersWithSameFirstName.size} member(s) with first name "${firstName}"`);

					if (membersWithSameFirstName.size > 0) {
						// Store info about all conflicting members
						const conflictInfo = [];
						
						for (const [, member] of membersWithSameFirstName) {
							const memberNick = member.nickname || member.user.username;
							const cleanMemberNick = memberNick.replace(/^\[ɴᴛ\]\s*/i, '');
							const hasLastInitialInNick = /^[A-Za-z]+\s+[A-Z]\.$/.test(cleanMemberNick.trim());
							
							// Get member's last initial from sheet or nickname
							let memberLastInitial = null;
							try {
								const sheetData = await sheetsManager.getVerificationData(member.id);
								if (sheetData && sheetData.name) {
									const memberNameParts = sheetData.name.trim().split(/\s+/);
									const memberLastName = memberNameParts.length > 1 ? memberNameParts[memberNameParts.length - 1] : '';
									memberLastInitial = memberLastName ? memberLastName.charAt(0).toUpperCase() : null;
								}
							} catch (sheetError) {
								console.error('Failed to get member data from sheet:', sheetError);
							}
							
							// If member has last initial in nickname, extract it
							if (hasLastInitialInNick && !memberLastInitial) {
								const nickParts = cleanMemberNick.trim().split(/\s+/);
								if (nickParts.length >= 2) {
									const lastPart = nickParts[nickParts.length - 1];
									if (/^[A-Z]\.$/.test(lastPart)) {
										memberLastInitial = lastPart.charAt(0);
									}
								}
							}
							
							console.log(`[Nickname Conflict Debug] Member: ${member.user.tag}, last initial: ${memberLastInitial}, hasLastInitialInNick: ${hasLastInitialInNick}`);
							
							conflictInfo.push({
								member,
								lastInitial: memberLastInitial,
								hasLastInitialInNick,
								nickname: memberNick,
							});
						}
						
						// Check if ANY member has the same last initial
						const memberWithSameLastInitial = conflictInfo.find(info => 
							info.lastInitial && info.lastInitial === lastInitial
						);
						
						console.log(`[Nickname Conflict Debug] New user: ${firstName} ${lastName}, last initial: ${lastInitial}`);
						
						if (memberWithSameLastInitial) {
							// SAME last initial - trigger manual modal
							console.log(`[Nickname Conflict Debug] SAME last initial detected with ${memberWithSameLastInitial.member.user.tag} - triggering modal`);
							conflictingMember = memberWithSameLastInitial.member;
							// Store the conflict info for use below
							conflictingMember._conflictInfo = memberWithSameLastInitial;
							conflictingMember._triggerModal = true;
						} else {
							// DIFFERENT last initials - auto-resolve (pick first member for updating)
							console.log(`[Nickname Conflict Debug] DIFFERENT last initials - auto-resolving`);
							conflictingMember = conflictInfo[0].member;
							// Store the conflict info for use below
							conflictingMember._conflictInfo = conflictInfo[0];
							conflictingMember._triggerModal = false;
						}
					}
				}

				if (conflictingMember) {
					// Found a member with the same first name
					const conflictingNick = conflictingMember.nickname || conflictingMember.user.username;
					
					if (!lastInitial) {
						// New user doesn't have a last name, cannot auto-resolve
						return interaction.editReply({
							content: `❌ **Nickname Conflict Detected**\n\n` +
								`A member with the first name "${firstName}" already exists: ${conflictingMember}\n\n` +
								`The new user "${userData.name}" doesn't have a last name provided. Please re-run the command with a full name (First Last) to resolve this conflict automatically.`,
						});
					}

					// Use the conflict info we already determined in the loop above
					const conflictInfo = conflictingMember._conflictInfo;
					const triggerModal = conflictingMember._triggerModal;
					const conflictingLastInitial = conflictInfo.lastInitial;
					const hasLastInitialInNick = conflictInfo.hasLastInitialInNick;

					// IMPORTANT: Check for SAME last initials FIRST (manual modal)
					// Then check for DIFFERENT last initials (auto-resolve)
					if (triggerModal) {
						// Last initials MATCH - require manual input via modal
						console.log('[Nickname Conflict Debug] Triggering manual modal - same last initials');
						if (!interaction.client.verificationPending) {
							interaction.client.verificationPending = new Map();
						}
						
						interaction.client.verificationPending.set(targetUser.id, {
							userData,
							targetMember,
							conflictingMember,
							interaction,
							regionRole,
							countryRole,
							hadNtUnverified,
							hadCombinedUnverified,
							ntMemberRole,
							serverMemberRole,
							onlineMemberRole,
							ntUnenrolledRole,
							ntChatChannelId: process.env.NT_CHAT_CHANNEL_ID,
							staffChatChannelId: process.env.STAFF_CHAT_CHANNEL_ID,
							missingFields,
							warningMessage,
						});

						// Set a timeout to clean up pending verification if modal is not submitted (5 minutes)
						const timeoutId = setTimeout(() => {
							if (interaction.client.verificationPending && interaction.client.verificationPending.has(targetUser.id)) {
								interaction.client.verificationPending.delete(targetUser.id);
								console.log(`Verification timeout for user ${targetUser.id} - modal was not submitted`);
							}
						}, 5 * 60 * 1000); // 5 minutes

						interaction.client.verificationPending.get(targetUser.id).timeoutId = timeoutId;

						const { ButtonBuilder, ButtonStyle } = require('discord.js');
						const resolveButton = new ButtonBuilder()
							.setCustomId(`resolve_nickname_conflict_${targetUser.id}`)
							.setLabel('Resolve Nickname Conflict')
							.setStyle(ButtonStyle.Primary);

						const cancelButton = new ButtonBuilder()
							.setCustomId(`cancel_verification_${targetUser.id}`)
							.setLabel('Cancel Verification')
							.setStyle(ButtonStyle.Danger);

						const buttonRow = new ActionRowBuilder().addComponents(resolveButton, cancelButton);

						await interaction.editReply({
							content: `⚠️ **Nickname Conflict - Manual Resolution Required**\n\n` +
								`${targetUser} cannot be automatically verified because a member with the first name "${firstName}" and the same last initial "${lastInitial}" already exists: ${conflictingMember}\n` +
								`Current nickname: \`${conflictingNick}\`\n\n` +
								`**Both users' nicknames need to be updated manually** because they share the same first name and last initial.\n\n` +
								`**Action Required:** Click "Resolve Nickname Conflict" to specify what both users' nicknames should be (without [ɴᴛ] prefix), or "Cancel Verification" to abort.`,
							components: [buttonRow],
						});

						// STOP EXECUTION - wait for modal
						return;
					} else if (hasLastInitialInNick || conflictingLastInitial) {
						// Existing member has a last initial but DIFFERENT from new user - auto-resolve with both having initials
						console.log('[Nickname Conflict Debug] Auto-resolving - different last initials or existing member has distinguishable nickname');
						newUserNickname = `[ɴᴛ] ${firstName} ${lastInitial}.`;
						
						// Update the existing member's nickname ONLY if they don't already have a last initial
						if (!hasLastInitialInNick && conflictingLastInitial) {
							// They don't have a last initial yet, so add it
							conflictingMemberToUpdate = conflictingMember;
							conflictingMemberNewNickname = `[ɴᴛ] ${firstName} ${conflictingLastInitial}.`;
							
							// Add notification to warning message
							const conflictResolutionMsg = `\n\n**✅ Nickname Conflict Auto-Resolved:**\n` +
								`• ${targetUser}: \`${newUserNickname}\`\n` +
								`• ${conflictingMember}: \`${conflictingMemberNewNickname}\``;
							
							warningMessage += conflictResolutionMsg;
						} else {
							// They already have a last initial (from a previous conflict), don't change it
							const conflictResolutionMsg = `\n\n**✅ Nickname Conflict Auto-Resolved:**\n` +
								`• ${targetUser}: \`${newUserNickname}\`\n` +
								`• ${conflictingMember}: Nickname unchanged (already has last initial)`;
							
							warningMessage += conflictResolutionMsg;
						}
					}
				} else {
					// No conflict, set normal nickname
					newUserNickname = `[ɴᴛ] ${firstName}`;
				}
			}
			catch (nicknameError) {
				console.error('Failed to detect nickname conflict:', nicknameError);
				console.error(nicknameError.stack);
				// Continue with default nickname
				const firstName = userData.name.trim().split(/\s+/)[0];
				newUserNickname = `[ɴᴛ] ${firstName}`;
			}

			// ============================================
			// STEP 2: Log verification to Google Sheets
			// ============================================
			const sheetLogged = await sheetsManager.verifyUser(userData);
			if (!sheetLogged) {
				await interaction.editReply({
					content: '❌ Failed to log this verification to Google Sheets. Please try again later or contact an administrator.',
				});
				return;
			}

			// ============================================
			// STEP 3: Assign roles
			// ============================================
			try {
				const rolesToRemove = [];
				if (hadNtUnverified) rolesToRemove.push(ntUnverifiedRole);
				if (hadCombinedUnverified) rolesToRemove.push(combinedUnverifiedRole);

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
			} catch (roleError) {
				console.error('Failed to assign roles:', roleError);
				console.error(roleError.stack);
				return interaction.editReply({
					content: `❌ **Verification Cancelled**\n\nFailed to assign roles to ${targetUser}. The user has been logged in the verification sheet but roles were not updated. Please manually assign roles or try verifying again.`,
					flags: MessageFlags.Ephemeral,
				});
			}

			// ============================================
			// STEP 4: Set nicknames
			// ============================================
			try {
				if (newUserNickname) {
					await targetMember.setNickname(newUserNickname);
					console.log(`Set nickname for ${targetUser.tag} to ${newUserNickname}`);
				}

				if (conflictingMemberToUpdate && conflictingMemberNewNickname) {
					await conflictingMemberToUpdate.setNickname(conflictingMemberNewNickname);
					console.log(`Set nickname for ${conflictingMemberToUpdate.user.tag} to ${conflictingMemberNewNickname}`);
				}
			}
			catch (nicknameError) {
				console.error('Failed to update nickname:', nicknameError);
				console.error(nicknameError.stack);
				return interaction.editReply({
					content: `❌ **Verification Cancelled**\n\nFailed to set nickname for ${targetUser}. The user has been logged and roles have been assigned, but the nickname could not be set. Please manually set the nickname to: \`${newUserNickname}\``,
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create success embed (always shown regardless of DM status)
			const embed = new EmbedBuilder()
				.setColor(0x57F287)
				.setTitle('✅ User Verified Successfully')
				.setDescription(`${targetUser} has been verified and logged in the system.`)
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
			const staffChatChannelId = process.env.STAFF_CHAT_CHANNEL_ID;
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
			} else {
				console.error('STAFF_CHAT_CHANNEL_ID not set in environment variables');
			}

			// Delete the ephemeral nickname conflict message if it exists
			// This only applies if there was a manual nickname conflict resolution
			const userId = targetUser.id;
			if (interaction.client.verificationPending && interaction.client.verificationPending.has(userId)) {
				const pendingData = interaction.client.verificationPending.get(userId);
				try {
					// Delete the original ephemeral message with the conflict warning
					// Using Discord's webhook API: DELETE /webhooks/<app_id>/<token>/messages/@original
					const originalInteraction = pendingData.interaction;
					await originalInteraction.deleteReply();
					console.log('Deleted ephemeral nickname conflict message');
				} catch (deleteError) {
					console.error('Could not delete ephemeral conflict message:', deleteError);
					// Non-critical, continue with verification
				}
				
				// Clear pending verification data
				if (pendingData.timeoutId) {
					clearTimeout(pendingData.timeoutId);
				}
				interaction.client.verificationPending.delete(userId);
			}

			// Send confirmation to the command user
			await interaction.editReply({
				content: `Successfully verified ${targetUser}. Details have been logged to <#${staffChatChannelId}>.`,
			});

			// Send welcome message to NT chat channel
			try {
				const ntChatChannelId = process.env.NT_CHAT_CHANNEL_ID;
				if (ntChatChannelId) {
					const ntChatChannel = await interaction.client.channels.fetch(ntChatChannelId);
					if (ntChatChannel) {
						const welcomeChannelMessage = `Welcome to Project NexTech, ${targetUser}! Please check <#1231776603126890671> for updates every few days and get your roles in <#1231777272906649670>. You can select any departments/subjects you are interested in. <#1386576733674668052> has useful information to get started. New members should go to one of our online info sessions. We will announce in <#1231776603126890671> when we will have one.`;
						await ntChatChannel.send(welcomeChannelMessage);
					} else {
						console.error('NT_CHAT_CHANNEL_ID channel not found');
					}
				} else {
					console.error('NT_CHAT_CHANNEL_ID not set in environment variables');
				}
			} catch (channelError) {
				console.error('Could not send welcome message to NT chat channel:', channelError);
				// Don't fail the verification if channel message fails
			}
		}
		catch (error) {
			console.error('Error in /verifyuser command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while verifying the user. Please try again later.',
			});
		}
	},
};
