const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { hasRequiredRole } = require('../../utils/helpers');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('createregion')
		.setDescription('Create a region role with proper formatting and ordering')
		.addStringOption(option =>
			option.setName('region_name')
				.setDescription('The name of the region (e.g., "Ontario")')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('country_code')
				.setDescription('Two letter country code (e.g., "CA" for Canada)')
				.setRequired(true)
				.setMinLength(2)
				.setMaxLength(2))
		.addStringOption(option =>
			option.setName('country_name')
				.setDescription('Full country name (e.g., "Canada")')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('members')
				.setDescription('Member IDs to add (comma-separated, optional)')
				.setRequired(false)),
	async execute(interaction) {
		try {
			console.log('[CreateRegion] Command started');
			
			// Check if user has required role
			const allowedRoleIds = [
				process.env.VERIFICATION_TEAM_ROLE_ID,
				process.env.EC_ROLE_ID,
			].filter(Boolean); // Filter out undefined values
			const member = interaction.member;

			if (!hasRequiredRole(member, allowedRoleIds)) {
				console.log('[CreateRegion] User does not have required role');
				return interaction.reply({
					content: '❌ You do not have permission to use this command. Only EC and Administrators can create region roles.',
					flags: MessageFlags.Ephemeral,
				});
			}

			console.log('[CreateRegion] Permission check passed');
			
			await interaction.deferReply();

			const regionName = interaction.options.getString('region_name');
			const countryCode = interaction.options.getString('country_code').toUpperCase();
			const countryName = interaction.options.getString('country_name');
			const membersInput = interaction.options.getString('members');

			// Validate country code is exactly 2 letters
			if (!/^[A-Z]{2}$/.test(countryCode)) {
				return interaction.editReply({
					content: '❌ Country code must be exactly 2 letters (e.g., "CA", "US", "UK").',
				});
			}

			// Parse member IDs if provided
			let memberIds = [];
			if (membersInput) {
				memberIds = membersInput.split(',').map(id => id.trim()).filter(id => id.length > 0);
			}

			// Validate member IDs if provided
			if (memberIds.length > 0) {
				console.log('[CreateRegion] Validating member IDs...');
				for (const memberId of memberIds) {
					const memberExists = interaction.guild.members.cache.get(memberId);
					if (!memberExists) {
						try {
							await interaction.guild.members.fetch(memberId);
						} catch (error) {
							return interaction.editReply({
								content: `❌ Could not find member with ID: ${memberId}`,
							});
						}
					}
				}
			}

			// Find existing country and region roles
			const allRoles = interaction.guild.roles.cache;
			
			// Find all country roles (format: "CountryName (XX)")
			const countryRolePattern = /^(.+) \(([A-Z]{2})\)$/;
			const countryRoles = allRoles.filter(role => {
				const match = role.name.match(countryRolePattern);
				// Exclude roles that have numbers (which would be region roles)
				return match && !/\(\w{2} \d+\)$/.test(role.name);
			});

			// Find all region roles (format: "RegionName (XX N)")
			const regionRolePattern = /^(.+) \(([A-Z]{2}) (\d+)\)$/;
			const regionRoles = allRoles.filter(role => {
				return regionRolePattern.test(role.name);
			});

			// Check if country role exists
			const countryRoleName = `${countryName} (${countryCode})`;
			let countryRole = allRoles.find(role => role.name === countryRoleName);

			// Find existing regions for this country
			const existingRegionsForCountry = regionRoles.filter(role => {
				const match = role.name.match(regionRolePattern);
				return match && match[2] === countryCode;
			});

			// Determine the next region number
			let nextRegionNumber = 1;
			if (existingRegionsForCountry.size > 0) {
				const regionNumbers = Array.from(existingRegionsForCountry.values()).map(role => {
					const match = role.name.match(regionRolePattern);
					return match ? parseInt(match[3]) : 0;
				});
				nextRegionNumber = Math.max(...regionNumbers) + 1;
			}

			const regionRoleName = `${regionName} (${countryCode} ${nextRegionNumber})`;

			// Check if region role already exists
			if (allRoles.find(role => role.name === regionRoleName)) {
				return interaction.editReply({
					content: `❌ Region role "${regionRoleName}" already exists.`,
				});
			}

			// Build confirmation embed
			const confirmEmbed = new EmbedBuilder()
				.setColor(0xF24C02)
				.setTitle('🌍 Create Region Role')
				.setDescription('Please confirm the role creation details:')
				.addFields(
					{ name: '📍 Region Role', value: `\`${regionRoleName}\``, inline: false },
					{ name: '🌐 Country Role', value: countryRole ? `\`${countryRoleName}\` (exists)` : `\`${countryRoleName}\` (will be created)`, inline: false },
					{ name: '👥 Members to Add', value: memberIds.length > 0 ? `${memberIds.length} member(s)` : 'None', inline: true }
				);

			if (!countryRole) {
				confirmEmbed.addFields({
					name: '⚠️ Note',
					value: `The country role "${countryRoleName}" will be created first.`
				});
			}

			// Create confirmation buttons
			const confirmButton = new ButtonBuilder()
				.setCustomId(`createregion_confirm_${interaction.id}`)
				.setLabel('✅ Create Roles')
				.setStyle(ButtonStyle.Success);

			const cancelButton = new ButtonBuilder()
				.setCustomId(`createregion_cancel_${interaction.id}`)
				.setLabel('❌ Cancel')
				.setStyle(ButtonStyle.Danger);

			const row = new ActionRowBuilder()
				.addComponents(confirmButton, cancelButton);

			await interaction.editReply({
				embeds: [confirmEmbed],
				components: [row],
			});

			console.log('[CreateRegion] Confirmation message sent');

			// Create collector for button interactions
			const collectorFilter = i => {
				return i.user.id === interaction.user.id && 
				       (i.customId === `createregion_confirm_${interaction.id}` || 
				        i.customId === `createregion_cancel_${interaction.id}`);
			};

			const response = await interaction.fetchReply();
			const collector = response.createMessageComponentCollector({ 
				filter: collectorFilter, 
				time: 60_000 
			});

			collector.on('collect', async (buttonInteraction) => {
				try {
					if (buttonInteraction.customId === `createregion_cancel_${interaction.id}`) {
						await buttonInteraction.update({
							content: '❌ Role creation cancelled.',
							embeds: [],
							components: [],
						});
						collector.stop();
						return;
					}

					// User confirmed, proceed with role creation
					await buttonInteraction.update({
						content: '⏳ Creating roles...',
						embeds: [],
						components: [],
					});

					const roleColor = 0xF24C02;
					const rolePermissions = [];

					// Step 1: Create country role if it doesn't exist
					if (!countryRole) {
						console.log(`[CreateRegion] Creating country role: ${countryRoleName}`);
						countryRole = await interaction.guild.roles.create({
							name: countryRoleName,
							color: roleColor,
							permissions: rolePermissions,
							reason: `Created by ${interaction.user.tag} via /createregion`,
						});
						console.log(`[CreateRegion] Country role created: ${countryRole.id}`);
					}

					// Step 2: Create region role
					console.log(`[CreateRegion] Creating region role: ${regionRoleName}`);
					const regionRole = await interaction.guild.roles.create({
						name: regionRoleName,
						color: roleColor,
						permissions: rolePermissions,
						reason: `Created by ${interaction.user.tag} via /createregion`,
					});
					console.log(`[CreateRegion] Region role created: ${regionRole.id}`);

					// Step 3: Position the roles correctly
					console.log('[CreateRegion] Positioning roles...');
					await positionRoles(interaction.guild, countryRole, regionRole);

					// Step 4: Add members to roles if specified
					let addedCount = 0;
					const failedMembers = [];

					if (memberIds.length > 0) {
						console.log(`[CreateRegion] Adding ${memberIds.length} members to roles...`);
						
						for (const memberId of memberIds) {
							try {
								let guildMember = interaction.guild.members.cache.get(memberId);
								if (!guildMember) {
									guildMember = await interaction.guild.members.fetch(memberId);
								}

								// Add both country and region roles
								await guildMember.roles.add([countryRole.id, regionRole.id]);
								addedCount++;
								console.log(`[CreateRegion] Added roles to ${guildMember.user.tag}`);
							} catch (error) {
								console.error(`[CreateRegion] Failed to add roles to ${memberId}:`, error.message);
								failedMembers.push(memberId);
							}
						}
					}

					// Build success message
					const successEmbed = new EmbedBuilder()
						.setColor(0x00FF00)
						.setTitle('✅ Roles Created Successfully')
						.addFields(
							{ name: '🌐 Country Role', value: `<@&${countryRole.id}>`, inline: true },
							{ name: '📍 Region Role', value: `<@&${regionRole.id}>`, inline: true }
						);

					if (memberIds.length > 0) {
						successEmbed.addFields({
							name: '👥 Members Added',
							value: `${addedCount}/${memberIds.length} member(s)`,
							inline: false
						});

						if (failedMembers.length > 0) {
							successEmbed.addFields({
								name: '⚠️ Failed to Add',
								value: failedMembers.join(', '),
								inline: false
							});
						}
					}

					await interaction.editReply({
						content: null,
						embeds: [successEmbed],
					});

					collector.stop();

				} catch (error) {
					console.error('[CreateRegion] Error in button handler:', error);
					await buttonInteraction.update({
						content: `❌ An error occurred while creating roles: ${error.message}`,
						embeds: [],
						components: [],
					});
					collector.stop();
				}
			});

			collector.on('end', async (collected, reason) => {
				if (reason === 'time') {
					try {
						await interaction.editReply({
							content: '❌ Role creation confirmation timed out after 60 seconds. Please try again.',
							embeds: [],
							components: [],
						});
					} catch (error) {
						console.error('[CreateRegion] Error updating timeout message:', error);
					}
				}
			});

		} catch (error) {
			console.error('[CreateRegion] Error:', error);
			const errorMessage = `❌ An error occurred: ${error.message}`;
			
			if (interaction.deferred) {
				await interaction.editReply({ content: errorMessage, embeds: [], components: [] });
			} else {
				await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
			}
		}
	},
};

/**
 * Position roles in the correct order
 * Order (bottom to top):
 * - @everyone
 * - 3 unrelated roles
 * - Region roles (in order of creation)
 * - Country roles (in order of creation)
 * 
 * @param {Guild} guild - Discord guild
 * @param {Role} countryRole - Country role to position
 * @param {Role} regionRole - Region role to position
 */
async function positionRoles(guild, countryRole, regionRole) {
	try {
		// Get all roles
		const allRoles = Array.from(guild.roles.cache.values());
		
		// Sort roles by position (lowest to highest)
		allRoles.sort((a, b) => a.position - b.position);

		// Patterns for country and region roles
		const countryRolePattern = /^(.+) \(([A-Z]{2})\)$/;
		const regionRolePattern = /^(.+) \(([A-Z]{2}) (\d+)\)$/;

		// Find @everyone role
		const everyoneRole = allRoles.find(role => role.id === guild.id);
		
		// Find the 3 unrelated roles above @everyone (skip @everyone itself)
		const basePosition = everyoneRole ? everyoneRole.position : 0;
		const unrelatedRoles = allRoles
			.filter(role => {
				const isCountry = countryRolePattern.test(role.name) && !/\(\w{2} \d+\)$/.test(role.name);
				const isRegion = regionRolePattern.test(role.name);
				const isEveryone = role.id === guild.id;
				return !isCountry && !isRegion && !isEveryone;
			})
			.slice(0, 3);

		// Calculate the base position for region roles (above the 3 unrelated roles)
		const regionBasePosition = basePosition + unrelatedRoles.length + 1;

		// Get all existing country roles (excluding the one we just created)
		const existingCountryRoles = allRoles.filter(role => {
			const match = role.name.match(countryRolePattern);
			// Exclude roles that have numbers (which would be region roles)
			return match && !/\(\w{2} \d+\)$/.test(role.name) && role.id !== countryRole.id;
		});

		// Get all existing region roles (excluding the one we just created)
		const existingRegionRoles = allRoles.filter(role => {
			return regionRolePattern.test(role.name) && role.id !== regionRole.id;
		});

		// Build the position array
		const rolePositions = [];

		// Position region roles
		let currentPosition = regionBasePosition;
		
		// First, position the new region role (at the bottom of region roles)
		rolePositions.push({
			role: regionRole.id,
			position: currentPosition++
		});

		// Then position existing region roles (older ones higher up)
		for (const role of existingRegionRoles) {
			rolePositions.push({
				role: role.id,
				position: currentPosition++
			});
		}

		// Position country roles (above region roles)
		// First, position the country role if it was just created (at the bottom of country roles)
		if (!existingCountryRoles.find(r => r.id === countryRole.id)) {
			rolePositions.push({
				role: countryRole.id,
				position: currentPosition++
			});
		}

		// Then position existing country roles (older ones higher up)
		for (const role of existingCountryRoles) {
			rolePositions.push({
				role: role.id,
				position: currentPosition++
			});
		}

		// Apply the positions
		if (rolePositions.length > 0) {
			console.log('[CreateRegion] Applying role positions:', rolePositions);
			await guild.roles.setPositions(rolePositions);
			console.log('[CreateRegion] Roles positioned successfully');
		}

	} catch (error) {
		console.error('[CreateRegion] Error positioning roles:', error);
		// Don't throw - role creation was successful, positioning is best-effort
	}
}
