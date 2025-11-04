const { SlashCommandBuilder, MessageFlags } = require('discord.js');
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
				.setName('events')
				.setDescription('Number of recent events to display (default: 10)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(50),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			const targetUser = interaction.options.getUser('user') || interaction.user;
			const eventLimit = interaction.options.getInteger('events') || 10;

			// Fetch volunteer data from Google Sheets
			const volunteerData = await sheetsManager.getVolunteerHours(
				targetUser.id,
				eventLimit,
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
