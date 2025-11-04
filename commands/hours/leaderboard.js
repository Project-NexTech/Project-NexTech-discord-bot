const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createLeaderboardEmbed } = require('../../utils/helpers');

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('View the hours leaderboard')
		.addIntegerOption(option =>
			option
				.setName('limit')
				.setDescription('Number of top volunteers to display (default: 10)')
				.setRequired(false)
				.setMinValue(5)
				.setMaxValue(25),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			const limit = interaction.options.getInteger('limit') || 10;

			// Fetch leaderboard from Google Sheets
			const leaderboard = await sheetsManager.getHoursLeaderboard(limit);

			if (!leaderboard || leaderboard.length === 0) {
				return interaction.editReply({
					content: '❌ No leaderboard data available.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create and send embed
			const embed = createLeaderboardEmbed(leaderboard);
			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('Error in /leaderboard command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching leaderboard data. Please try again later.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
