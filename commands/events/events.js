const { SlashCommandBuilder } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createEventsEmbed, getUserDepartments } = require('../../utils/helpers');

module.exports = {
	cooldown: 1,
	data: new SlashCommandBuilder()
		.setName('events')
		.setDescription('View upcoming events')
		.addStringOption(option =>
			option
				.setName('department')
				.setDescription('Filter by department (defaults to your departments)')
				.setRequired(true)
				.addChoices(
					{ name: 'Engineering', value: 'Engineering' },
					{ name: 'Mentoring', value: 'Mentoring' },
					{ name: 'Programming', value: 'Programming' },
					{ name: 'Physics/Math', value: 'Physics/Math' },
					{ name: 'Natural Sciences', value: 'Natural Sciences' },
					{ name: 'All', value: 'all' },
				),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			let department = interaction.options.getString('department');

			// If no department specified, use user's departments
			if (!department) {
				const member = interaction.member;
				const userDepts = getUserDepartments(member);
				
				if (userDepts.length === 0) {
					department = 'all';
				}
				else if (userDepts.length === 1) {
					department = userDepts[0];
				}
				else {
					// Show all if user has multiple departments
					department = null;
				}
			}

			if (department === 'all') {
				department = null;
			}

			// Fetch events from Google Sheets
			const events = await sheetsManager.getUpcomingEvents(department);

			if (!events || events.length === 0) {
				const deptText = department ? ` for ${department}` : '';
				return interaction.editReply({
					content: `📅 No upcoming events found${deptText}.`,
					ephemeral: false,
				});
			}

			// Create and send embed
			const embed = createEventsEmbed(events, department);
			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('Error in /events command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching events. Please try again later.',
				ephemeral: true,
			});
		}
	},
};
