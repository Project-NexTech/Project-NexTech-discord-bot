const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('requesthours')
		.setDescription('Get the link to request volunteer hours'),
	async execute(interaction) {
		try {
			const hoursFormUrl = process.env.HOURS_FORM_URL || 'https://forms.google.com/';

			const embed = new EmbedBuilder()
				.setColor(0x00AE86)
				.setTitle('📝 Request Volunteer Hours')
				.setDescription('Click the button below to fill out the volunteer hours request form.')
				.addFields(
					{ name: 'What to Include', value: '• Event name and date\n• Number of hours worked\n• Brief description of your work' },
				)
				.setTimestamp()
				.setFooter({ text: 'Project NexTech Hours Tracker' });

			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setLabel('Open Hours Request Form')
						.setStyle(ButtonStyle.Link)
						.setURL(hoursFormUrl)
						.setEmoji('📋'),
				);

			await interaction.reply({ embeds: [embed], components: [row] });

		}
		catch (error) {
			console.error('Error in /requesthours command:', error);
			await interaction.reply({
				content: '❌ An error occurred while getting the hours request form.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
