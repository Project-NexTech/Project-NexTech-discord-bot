const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
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

		await interaction.deferReply();

		try {
			const targetUser = interaction.options.getUser('user');
			const targetMember = await interaction.guild.members.fetch(targetUser.id);
			
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

			// Check if user has unverified role
			const unverifiedRole = interaction.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('unverified') || role.name.toLowerCase().includes('pending'),
			);

			// Log verification to Google Sheets
			const sheetLogged = await sheetsManager.verifyUser(userData);
			if (!sheetLogged) {
				await interaction.editReply({
					content: '❌ Failed to log this verification to Google Sheets. Please try again later or contact an administrator.',
				});
				return;
			}

			// Assign roles and update nickname
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

			const hadNtUnverified = ntUnverifiedRole && targetMember.roles.cache.has(ntUnverifiedRole.id);
			const hadCombinedUnverified = combinedUnverifiedRole && targetMember.roles.cache.has(combinedUnverifiedRole.id);

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

			try {
				// Extract first name only (everything before the first space)
				const firstName = userData.name.split(' ')[0];
				await targetMember.setNickname(`[ɴᴛ] ${firstName}`);
			}
			catch (nicknameError) {
				console.error('Failed to update nickname:', nicknameError);
			}

			// Send welcome DM to the verified user first
			let dmSent = false;
			try {
				const welcomeMessage = `Welcome to **Project NexTech**, ${userData.name}! 🎉\n\n` +
					`**Getting Started:**\n` +
					`• Use \`/verify\` to gain access to the rest of the server. **You must to this first before doing anything else.**\n` +
					`• Get roles in <#1231777272906649670> \n` +
					`• Use \`/events\` to see upcoming events\n` +
					`• Use \`/hours\` to track your volunteer hours\n` +
					`• Use \`/contact\` to find department leadership\n\n` +
					`If you have any questions, feel free to reach out to the leadership team!`;

				await targetUser.send(welcomeMessage);
				dmSent = true;
			}
			catch (dmError) {
				console.error('Could not send DM to verified user:', dmError);
			}

			// Create success embed (always shown regardless of DM status)
			const embed = new EmbedBuilder()
				.setColor(0x57F287)
				.setTitle('✅ User Verified Successfully')
				.setDescription(`${targetUser} has been verified and logged in the system.${!dmSent ? '\n\n⚠️ **Could not send welcome DM** - User may have DMs disabled.' : ''}`)
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

			await interaction.editReply({ embeds: [embed] });

			// Send welcome message to NT chat channel
			try {
				const ntChatChannelId = process.env.NT_CHAT_CHANNEL_ID;
				if (ntChatChannelId) {
					const ntChatChannel = await interaction.client.channels.fetch(ntChatChannelId);
					if (ntChatChannel) {
						// TODO: Replace this placeholder message with the actual welcome message
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
