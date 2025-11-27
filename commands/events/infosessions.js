const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('infosessions')
		.setDescription('View upcoming Project NexTech Info Sessions'),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			const guildId = process.env.GUILD_ID;
			const guild = await interaction.client.guilds.fetch(guildId);

			// Fetch all scheduled events
			const scheduledEvents = await guild.scheduledEvents.fetch();

			// Filter for Project NexTech Info Session events that haven't started yet
			const infoSessions = scheduledEvents.filter(event => 
				event.name === 'Project NexTech Info Session' &&
				event.scheduledStartAt > new Date()
			);

			if (infoSessions.size === 0) {
				return interaction.editReply({
					content: '📅 There are no upcoming Project NexTech Info Sessions scheduled at this time.',
				});
			}

			// Sort by start time (earliest first)
			const sortedSessions = Array.from(infoSessions.values()).sort((a, b) => 
				a.scheduledStartAt - b.scheduledStartAt
			);

			// Create embed
			const embed = new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle('📅 Upcoming Project NexTech Info Sessions')
				.setDescription('Join us to learn more about Project NexTech!')
				.setTimestamp();

			// Add each info session as a field
			for (let i = 0; i < sortedSessions.length; i++) {
				const session = sortedSessions[i];
				const startTime = session.scheduledStartAt;
				const discordTimestamp = `<t:${Math.floor(startTime.getTime() / 1000)}:F>`;
				const relativeTime = `<t:${Math.floor(startTime.getTime() / 1000)}:R>`;
				const eventUrl = `https://discord.com/events/${guild.id}/${session.id}`;
				
				const presentationLink = 'https://docs.google.com/presentation/d/e/2PACX-1vTNAnLNnWuJEpG7wYFiesXMxCOJVwZif0NisDPDbbVt-F-d1K_M0h-pbH86B9Alf7JSZNKnlJjgwgML/pub?start=false&loop=false&delayms=5000';

				let fieldValue = 
					`📆 **When:** ${discordTimestamp}\n\n` +
					`⏰ **Starts:** ${relativeTime}\n\n` +
					`🔗 **Event:** [View in Discord](${eventUrl}) (Hit interested if you plan on going!)\n\n` +
					`📊 **Slides:** [Presentation Link](${presentationLink})`;

				// Add separator to the end of field value if this isn't the last session
				if (i < sortedSessions.length - 1) {
					fieldValue += '\n─────────────────────────────────────';
				}

				embed.addFields({
					name: `Info Session #${i + 1}`,
					value: fieldValue,
					inline: false
				});
			}

			embed.setFooter({ 
				text: `${sortedSessions.length} upcoming session${sortedSessions.length !== 1 ? 's' : ''} found` 
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[InfoSessions] Error:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching info sessions.',
			});
		}
	},
};
