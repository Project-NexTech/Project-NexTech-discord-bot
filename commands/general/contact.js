const { SlashCommandBuilder } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createContactsEmbed, getUserDepartments } = require('../../utils/helpers');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('contact')
		.setDescription('View contact information for leadership')
		.addStringOption(option =>
			option
				.setName('department')
				.setDescription('Department to get contacts for')
				.setRequired(false)
				.addChoices(
					{ name: 'Education', value: 'Education' },
					{ name: 'Outreach', value: 'Outreach' },
					{ name: 'Marketing', value: 'Marketing' },
					{ name: 'Technology', value: 'Technology' },
					{ name: 'Finance', value: 'Finance' },
					{ name: 'All', value: 'all' },
				),
		)
		.addStringOption(option =>
			option
				.setName('event')
				.setDescription('Get contacts for a specific event')
				.setRequired(false),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			let department = interaction.options.getString('department');
			const eventName = interaction.options.getString('event');

			// If no department specified and no event, use user's departments
			if (!department && !eventName) {
				const member = interaction.member;
				const userDepts = getUserDepartments(member);
				
				if (userDepts.length === 1) {
					department = userDepts[0];
				}
			}

			if (department === 'all') {
				department = null;
			}

			// Fetch contacts from Google Sheets
			const result = await sheetsManager.getContacts(department, eventName);

			// Check if feature is not yet implemented
			if (result && result.notImplemented) {
				return interaction.editReply({
					content: '🚧 **Leadership Contact Feature Coming Soon!**\n\nThis feature is currently under development. Please check back later or contact a team member directly.',
					ephemeral: true,
				});
			}

			const contacts = result;

			if (!contacts || contacts.length === 0) {
				return interaction.editReply({
					content: '❌ No contacts found matching your criteria.',
					ephemeral: true,
				});
			}

			// Create and send embed
			const embed = createContactsEmbed(contacts, department);
			await interaction.editReply({ embeds: [embed] });

		}
		catch (error) {
			console.error('Error in /contact command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching contact information. Please try again later.',
				ephemeral: true,
			});
		}
	},
};
