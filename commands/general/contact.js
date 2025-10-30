const { SlashCommandBuilder } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createContactsEmbed } = require('../../utils/helpers');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('contact')
		.setDescription('View contact information for leadership')
		.addStringOption(option =>
			option
				.setName('department')
				.setDescription('Department to get contacts for')
				.setRequired(true)
				.addChoices(
					{ name: 'Engineering', value: 'Engineering' },
					{ name: 'Mentoring', value: 'Mentoring' },
					{ name: 'Programming', value: 'Programming' },
					{ name: 'Physics/Math', value: 'Physics/Math' },
					{ name: 'Natural Sciences', value: 'Natural Sciences' },
					{ name: 'Marketing', value: 'Marketing' },
					{ name: 'Logistics', value: 'Logistics' },
					{ name: 'Policy/Intl', value: 'Policy/Intl'},
					{ name: 'EC (not sure?)', value: 'EC' },
				),
		),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			const department = interaction.options.getString('department');

			// Fetch contacts from Google Sheets
			const contacts = await sheetsManager.getContacts(department);

			if (!contacts || contacts.length === 0) {
				return interaction.editReply({
					content: '❌ No contacts found for this department.',
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
