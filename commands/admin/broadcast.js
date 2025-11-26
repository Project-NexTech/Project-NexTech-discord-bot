const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasRequiredRole } = require('../../utils/helpers');
const sheetsManager = require('../../utils/sheets');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('broadcast')
		.setDescription('Send a DM to all NT Members')
		.addStringOption(option =>
			option.setName('message')
				.setDescription('The message to broadcast')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('recipients')
				.setDescription('Who to send the message to')
				.setRequired(true)
				.addChoices(
					{ name: 'All NT Members', value: 'all' },
					{ name: 'Enrolled Only', value: 'enrolled' },
					{ name: 'Unenrolled Only', value: 'unenrolled' },
					{ name: 'Unverified Only', value: 'unverified' },
					{ name: 'Paused Only', value: 'paused' },
					{ name: 'Custom List (CSV)', value: 'csv' }
				))
		.addStringOption(option =>
			option.setName('csv_url')
				.setDescription('URL to CSV file (only for Custom List option)')
				.setRequired(false)),
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
			
			const recipientType = interaction.options.getString('recipients');
			
			// Defer reply early to prevent timeout
			await interaction.deferReply();
			console.log('[Broadcast] Reply deferred');
			
			const message = interaction.options.getString('message');

			// Determine which role(s) to filter by based on recipient type
			let targetMembers;
			let recipientDescription;
			
			// Get the NT Member role
			const ntMemberRoleId = process.env.NT_MEMBER_ROLE_ID;
			console.log('[Broadcast] NT Member Role ID:', ntMemberRoleId);

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
			
			if (recipientType === 'all') {
				// All NT Members (current behavior)
				const ntMemberRole = interaction.guild.roles.cache.get(ntMemberRoleId);
				if (!ntMemberRole) {
					console.log('[Broadcast] NT Member role not found');
					return interaction.editReply({
						content: `❌ Could not find NT Member role with ID: ${ntMemberRoleId}`,
					});
				}
				
				targetMembers = interaction.guild.members.cache.filter(m => 
					m.roles.cache.has(ntMemberRoleId) && !m.user.bot
				);
				recipientDescription = 'All NT Members';
				
			} else if (recipientType === 'enrolled') {
				// NT Enrolled only
				const ntEnrolledRole = interaction.guild.roles.cache.find(role =>
					role.name.toLowerCase().includes('nt enrolled')
				);
				
				if (!ntEnrolledRole) {
					return interaction.editReply({
						content: '❌ Could not find NT Enrolled role. Please check role names.',
					});
				}
				
				targetMembers = interaction.guild.members.cache.filter(m => 
					m.roles.cache.has(ntEnrolledRole.id) && !m.user.bot
				);
				recipientDescription = 'NT Enrolled Members';
				
			} else if (recipientType === 'unenrolled') {
				// NT Unenrolled only
				const ntUnenrolledRole = interaction.guild.roles.cache.find(role =>
					role.name.toLowerCase().includes('nt unenrolled')
				);
				
				if (!ntUnenrolledRole) {
					return interaction.editReply({
						content: '❌ Could not find NT Unenrolled role. Please check role names.',
					});
				}
				
				targetMembers = interaction.guild.members.cache.filter(m => 
					m.roles.cache.has(ntUnenrolledRole.id) && !m.user.bot
				);
				recipientDescription = 'NT Unenrolled Members';
				
			} else if (recipientType === 'unverified') {
				// Unverified only (both NexTech Unverified and Combined Unverified)
				const ntUnverifiedRoleId = process.env.NT_UNVERIFIED_ROLE_ID;
				const combinedUnverifiedRoleId = process.env.COMBINED_UNVERIFIED_ROLE_ID;
				
				if (!ntUnverifiedRoleId || !combinedUnverifiedRoleId) {
					return interaction.editReply({
						content: '❌ Unverified role IDs not configured in environment variables.',
					});
				}
				
				targetMembers = interaction.guild.members.cache.filter(m => {
					if (m.user.bot) return false;
					return m.roles.cache.has(ntUnverifiedRoleId) || m.roles.cache.has(combinedUnverifiedRoleId);
				});
				recipientDescription = 'Unverified Members';
				
			} else if (recipientType === 'paused') {
				// Paused or Not a Member - fetch from Google Sheets
				console.log('[Broadcast] Fetching membership status from Google Sheets...');
				const membershipData = await sheetsManager.getMembershipStatus();
				
				if (!membershipData || membershipData.length === 0) {
					return interaction.editReply({
						content: '❌ Could not fetch membership data from Google Sheets.',
					});
				}
				
				// Filter for Paused or Not a Member status
				const pausedMembers = membershipData.filter(data => 
					data.status === 'Paused' || data.status === 'Not a Member'
				);
				
				console.log(`[Broadcast] Found ${pausedMembers.length} paused/not a member entries in sheets`);
				
				if (pausedMembers.length === 0) {
					return interaction.editReply({
						content: '❌ No Paused or Not a Member users found in the membership sheet.',
					});
				}
				
				// Get Discord members for these users
				const discordIds = pausedMembers.map(m => m.discordId).filter(Boolean);
				const guildMembers = new Map();
				
				for (const discordId of discordIds) {
					try {
						let guildMember = interaction.guild.members.cache.get(discordId);
						if (!guildMember) {
							guildMember = await interaction.guild.members.fetch(discordId);
						}
						if (guildMember && !guildMember.user.bot) {
							guildMembers.set(discordId, guildMember);
						}
					} catch (error) {
						console.log(`[Broadcast] Could not fetch member ${discordId}: ${error.message}`);
					}
				}
				
				targetMembers = guildMembers;
				recipientDescription = 'Paused/Not a Member Users';
				
			} else if (recipientType === 'csv') {
				// Custom list from CSV
				const csvUrl = interaction.options.getString('csv_url');
				const defaultCsvPath = path.join(__dirname, '..', '..', 'data', 'broadcast-list.csv');
				
				let csvContent;
				
				if (csvUrl) {
					// Download CSV from URL
					console.log(`[Broadcast] Downloading CSV from URL: ${csvUrl}`);
					try {
						csvContent = await downloadFile(csvUrl);
					} catch (error) {
						return interaction.editReply({
							content: `❌ Failed to download CSV from URL: ${error.message}`,
						});
					}
				} else if (fs.existsSync(defaultCsvPath)) {
					// Read from default file path
					console.log(`[Broadcast] Reading CSV from file: ${defaultCsvPath}`);
					try {
						csvContent = fs.readFileSync(defaultCsvPath, 'utf8');
					} catch (error) {
						return interaction.editReply({
							content: `❌ Failed to read CSV file: ${error.message}`,
						});
					}
				} else {
					return interaction.editReply({
						content: '❌ No CSV source provided. Either provide a CSV URL or upload a CSV file using `/broadcastupload` first.',
					});
				}
				
				// Parse CSV and extract names from column B (skip first 6 rows)
				const names = parseCSVNames(csvContent);
				
				if (names.length === 0) {
					return interaction.editReply({
						content: '❌ No names found in the CSV file (column B, skipping first 6 rows).',
					});
				}
				
				console.log(`[Broadcast] Found ${names.length} names in CSV`);
				
				// Fetch volunteer data to match names to Discord IDs
				const volunteersSheetId = process.env.VOLUNTEERS_SHEET_ID;
				const volunteersResponse = await sheetsManager.safeApiCall(
					() => sheetsManager.sheets.spreadsheets.values.get({
						spreadsheetId: volunteersSheetId,
						range: '\'Limited Data\'!A:E',
					}),
					'broadcast CSV (fetch volunteer IDs)'
				);
				
				if (!volunteersResponse || !volunteersResponse.data) {
					return interaction.editReply({
						content: '❌ Failed to fetch volunteer data from Google Sheets.',
					});
				}
				
				const volunteersRows = volunteersResponse.data.values || [];
				
				// Create name to Discord ID mapping
				const nameToDiscordId = {};
				volunteersRows.slice(1).forEach(row => {
					const name = row[0];
					const discordId = row[4];
					if (name && discordId) {
						const normalized = name.trim().toLowerCase();
						nameToDiscordId[normalized] = discordId.trim();
					}
				});
				
				// Match names to Discord IDs
				const discordIds = [];
				const unmatchedNames = [];
				
				for (const name of names) {
					const normalized = name.trim().toLowerCase();
					const discordId = nameToDiscordId[normalized];
					
					if (discordId) {
						discordIds.push(discordId);
					} else {
						unmatchedNames.push(name);
					}
				}
				
				console.log(`[Broadcast] Matched ${discordIds.length}/${names.length} names to Discord IDs`);
				if (unmatchedNames.length > 0) {
					console.log(`[Broadcast] Unmatched names: ${unmatchedNames.join(', ')}`);
				}
				
				// Fetch Discord members
				const guildMembers = new Map();
				for (const discordId of discordIds) {
					try {
						let guildMember = interaction.guild.members.cache.get(discordId);
						if (!guildMember) {
							guildMember = await interaction.guild.members.fetch(discordId);
						}
						if (guildMember && !guildMember.user.bot) {
							guildMembers.set(discordId, guildMember);
						}
					} catch (error) {
						console.log(`[Broadcast] Could not fetch member ${discordId}: ${error.message}`);
					}
				}
				
				targetMembers = guildMembers;
				recipientDescription = `Custom List (${names.length} names, ${guildMembers.size} matched)`;
			}

			console.log(`[Broadcast] Found ${targetMembers.size} members for recipient type: ${recipientType}`);

			if (targetMembers.size === 0) {
				return interaction.editReply({
					content: `❌ No ${recipientDescription} found to broadcast to.`,
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
				.setDescription(`You are about to send the following message to **${targetMembers.size} ${recipientDescription}**:`)
				.addFields(
					{ name: '📝 Message Preview', value: message },
					{ name: '👥 Recipients', value: `${targetMembers.size} ${recipientDescription}` }
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
						content: `📤 Broadcasting message to ${targetMembers.size} ${recipientDescription}...\n\n**Message:**\n${message}`,
						embeds: [],
						components: [],
					});

					// Send DMs to all NT Members
					let successCount = 0;
					let failCount = 0;
					const failedMembers = [];
					let messagesSentInCurrentMinute = 0;
					let currentMinuteStart = Date.now();

					for (const [memberId, member] of targetMembers) {
						try {
							// Check if we've hit the rate limit (5 DMs per second, ~300 per minute to be safe)
							// Discord's actual limit is higher but we stay conservative
							const now = Date.now();
							const timeSinceMinuteStart = now - currentMinuteStart;
							
							// Reset counter every minute
							if (timeSinceMinuteStart >= 60000) {
								messagesSentInCurrentMinute = 0;
								currentMinuteStart = now;
								console.log('[Broadcast] Rate limit window reset');
							}
							
							// If we've sent 250 messages in this minute, wait for the next minute
							if (messagesSentInCurrentMinute >= 250) {
								const waitTime = 60000 - timeSinceMinuteStart;
								console.log(`[Broadcast] Rate limit approaching, waiting ${waitTime}ms before continuing...`);
								await new Promise(resolve => setTimeout(resolve, waitTime));
								messagesSentInCurrentMinute = 0;
								currentMinuteStart = Date.now();
							}
							
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
							messagesSentInCurrentMinute++;
						} catch (error) {
							// Check if it's a rate limit error
							if (error.code === 50007) {
								// Cannot send messages to this user
								failCount++;
								failedMembers.push(`${member.user.tag} (${member.user.id}) - DMs disabled`);
								console.error(`[Broadcast] Cannot send DM to ${member.user.tag}: DMs disabled`);
							} else if (error.code === 429 || error.httpStatus === 429) {
								// Rate limited - wait and retry
								const retryAfter = error.retry_after ? error.retry_after * 1000 : 5000;
								console.log(`[Broadcast] Rate limited! Waiting ${retryAfter}ms before retrying...`);
								await new Promise(resolve => setTimeout(resolve, retryAfter));
								
								// Retry sending to this member
								try {
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
									messagesSentInCurrentMinute++;
									// Reset the rate limit window after being rate limited
									currentMinuteStart = Date.now();
								} catch (retryError) {
									failCount++;
									failedMembers.push(`${member.user.tag} (${member.user.id}) - ${retryError.message}`);
									console.error(`[Broadcast] Retry failed for ${member.user.tag}:`, retryError.message);
								}
							} else {
								failCount++;
								failedMembers.push(`${member.user.tag} (${member.user.id}) - ${error.message}`);
								console.error(`[Broadcast] Failed to send DM to ${member.user.tag}:`, error.message);
							}
						}

						// Add a small delay between messages (200ms = 5 messages per second max)
						await new Promise(resolve => setTimeout(resolve, 200));
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

					await interaction.followUp({ embeds: [reportEmbed]});
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

/**
 * Downloads a file from a URL
 * @param {string} url - The URL to download from
 * @returns {Promise<string>} The file content
 */
function downloadFile(url) {
	return new Promise((resolve, reject) => {
		const protocol = url.startsWith('https') ? https : http;
		
		protocol.get(url, (response) => {
			if (response.statusCode !== 200) {
				reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
				return;
			}
			
			let data = '';
			response.on('data', (chunk) => {
				data += chunk;
			});
			
			response.on('end', () => {
				resolve(data);
			});
		}).on('error', (error) => {
			reject(error);
		});
	});
}

/**
 * Parses CSV content and extracts names from column B (skipping first 6 rows)
 * @param {string} csvContent - The CSV file content
 * @returns {Array<string>} Array of names
 */
function parseCSVNames(csvContent) {
	const lines = csvContent.split('\n');
	const names = [];
	
	// Skip first 6 rows, then process remaining rows
	for (let i = 6; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		
		// Simple CSV parsing (handles basic cases)
		// Column B is the second column (index 1)
		const columns = parseCSVLine(line);
		
		if (columns.length >= 2 && columns[1].trim()) {
			names.push(columns[1].trim());
		}
	}
	
	return names;
}

/**
 * Parses a single CSV line, handling quoted values
 * @param {string} line - A single line from CSV
 * @returns {Array<string>} Array of column values
 */
function parseCSVLine(line) {
	const columns = [];
	let currentColumn = '';
	let inQuotes = false;
	
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				currentColumn += '"';
				i++; // Skip next quote
			} else {
				// Toggle quote state
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			// End of column
			columns.push(currentColumn);
			currentColumn = '';
		} else {
			currentColumn += char;
		}
	}
	
	// Add last column
	columns.push(currentColumn);
	
	return columns;
}
