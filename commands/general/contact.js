const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createContactsEmbed } = require('../../utils/helpers');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('contact')
		.setDescription('View contact information for all leadership'),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			// Fetch all contacts from the leadership sheet
			const contacts = await sheetsManager.getContacts();

			if (!contacts || contacts.length === 0) {
				return interaction.editReply({
					content: '❌ No leadership contacts found.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create and send embed(s) (chunked to respect Discord's 25-field limit)
			const embeds = createContactsEmbed(contacts);
			await interaction.editReply({ embeds });

		}
		catch (error) {
			console.error('Error in /contact command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching contact information. Please try again later.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
