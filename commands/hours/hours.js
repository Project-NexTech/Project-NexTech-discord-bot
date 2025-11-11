const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createHoursEmbed } = require('../../utils/helpers');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('hours')
		.setDescription('View volunteer hours for yourself or another member')
		.addUserOption(option =>
			option
				.setName('user')
				.setDescription('The user to check hours for (defaults to you)')
				.setRequired(false),
		)
		.addIntegerOption(option =>
			option
				.setName('requests')
				.setDescription('Number of recent requests to display (1-10) (default: show total hours)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(10),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			const targetUser = interaction.options.getUser('user') || interaction.user;
			const requestsLimit = interaction.options.getInteger('requests');

			// If requests limit is specified, show recent verification requests
			if (requestsLimit) {
				const verificationData = await sheetsManager.getHourVerificationRequests(
					targetUser.id,
					requestsLimit,
				);

				if (!verificationData) {
					return interaction.editReply({
						content: `❌ No volunteer data found for ${targetUser.username}. They may not be registered in the system yet.`,
						flags: MessageFlags.Ephemeral,
					});
				}

				// Create embed for recent requests
				const embed = new EmbedBuilder()
					.setColor(0x5865F2)
					.setTitle(`📋 Recent Hour Requests for ${verificationData.name}`)
					.setDescription(`Showing the last ${requestsLimit} hour verification request(s)`)
					.setTimestamp()
					.setFooter({ text: 'Project NexTech Hours System' });

				// Add fields for each request and track total hours
				const requests = verificationData.requests;
				let totalHoursShown = 0;
				
				for (let i = 0; i < requestsLimit; i++) {
					if (i < requests.length) {
						const req = requests[i];
						
						// Calculate the request number for this member (most recent = #1)
						const requestNumber = i + 1;
						
						// Skip denied requests
						if (req.verdict && req.verdict.toLowerCase() === 'denied') {
							embed.addFields({
								name: `${requestNumber}. Request #${requestNumber} ❌`,
								value: `**Status:** ${req.verdict}\n*This request was denied and hours were not given.*`,
								inline: false,
							});
						} else {
							// Format the request details
							const hoursValue = req.hours !== 'N/A' ? `**${req.hours} hours**` : 'Not specified';
							const statusEmoji = req.verdict.toLowerCase() === 'approved' ? '✅' : 
							                    req.verdict.toLowerCase() === 'unverified' ? '⏳' : '❓';
							
							// Add to total if hours is a valid number
							if (req.hours !== 'N/A') {
								const hoursNum = parseFloat(req.hours);
								if (!isNaN(hoursNum)) {
									totalHoursShown += hoursNum;
								}
							}
							
							embed.addFields({
								name: `${requestNumber}. Request #${requestNumber} ${statusEmoji}`,
								value: 
									`**Hours:** ${hoursValue}\n` +
									`**Status:** ${req.verdict}\n` +
									`**Department:** ${req.department}\n` +
									`**Date:** ${req.date}\n` +
									`**Type:** ${req.type}\n` +
									`**Description:** ${req.description || 'No description provided'}`,
								inline: false,
							});
						}
					} else {
						// No request available for this position
						embed.addFields({
							name: `${i + 1}. No request`,
							value: `*No request to show for this position*`,
							inline: false,
						});
					}
				}

				// Add total count if user has more requests than shown
				if (requests.length > requestsLimit) {
					embed.setDescription(
						`Showing the ${requestsLimit} most recent request(s) out of ${requests.length} total`
					);
				}

				// Add total hours field at the bottom
				embed.addFields({
					name: '📊 Total Hours (Shown Requests)',
					value: `**${totalHoursShown.toFixed(2)} hours**\n*Sum of all approved/pending hours shown above (excluding denied requests)*`,
					inline: false,
				});

				return interaction.editReply({ embeds: [embed] });
			}

			// Otherwise, show total hours (original behavior)
			// Fetch volunteer data from Google Sheets
			const volunteerData = await sheetsManager.getVolunteerHours(
				targetUser.id,
			);

			if (!volunteerData) {
				return interaction.editReply({
					content: `❌ No volunteer data found for ${targetUser.username}. They may not be registered in the system yet.`,
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create and send embed
			const embed = createHoursEmbed(volunteerData, targetUser);
			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('Error in /hours command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching hours data. Please try again later.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
