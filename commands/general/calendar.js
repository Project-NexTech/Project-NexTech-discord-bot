const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	cooldown: 3,
	data: new SlashCommandBuilder()
		.setName('calendar')
		.setDescription('Get the link to the Project NexTech calendar'),
	async execute(interaction) {
		const calendarUrl = process.env.CALENDAR_URL || 'https://calendar.google.com/calendar/';

		const embed = new EmbedBuilder()
			.setColor(0x4285F4)
			.setTitle('📅 Project NexTech Calendar')
			.setDescription(`Access our calendar to stay updated on all upcoming events, meetings, and deadlines.`)
			.addFields(
				{ name: '🔗 Calendar Link', value: `[Click here to view calendar](${calendarUrl})` },
			)
			.setTimestamp()
			.setFooter({ text: 'Project NexTech' });

		await interaction.reply({ embeds: [embed] });
	},
};
