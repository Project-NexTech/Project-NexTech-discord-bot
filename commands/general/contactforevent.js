const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');
const sheetsManager = require('../../utils/sheets');
const { createContactsEmbed } = require('../../utils/helpers');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('contactforevent')
		.setDescription('Get contact information for an upcoming event'),
	async execute(interaction) {
		await interaction.deferReply();

		try {
			// Fetch upcoming events
			const events = await sheetsManager.getUpcomingEvents('all');

			// Filter out events without valid departments
			const validEvents = events.filter(e => !e.isUndecided && e.department !== 'Other');

			if (validEvents.length === 0) {
				return interaction.editReply({
					content: '❌ No upcoming events found with assignable contacts.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create select menu options (Discord limits to 25)
			const options = validEvents.slice(0, 25).map((event, idx) => ({
				label: `${event.date} - ${event.dayOfWeek}`,
				description: `${event.department} - ${event.location || 'TBD'}`,
				value: idx.toString(),
			}));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('event_select')
				.setPlaceholder('Select an event to view contacts')
				.addOptions(options);

			const row = new ActionRowBuilder().addComponents(selectMenu);

			const response = await interaction.editReply({
				content: '📅 **Select an event to view contact information:**',
				components: [row],
			});

			// Create collector for select menu interaction
			const collector = response.createMessageComponentCollector({
				componentType: ComponentType.StringSelect,
				time: 60_000, // 60 seconds
			});

			collector.on('collect', async (selectInteraction) => {
				if (selectInteraction.user.id !== interaction.user.id) {
					return selectInteraction.reply({
						content: '❌ This menu is not for you!',
						flags: MessageFlags.Ephemeral,
					});
				}

				const selectedIndex = parseInt(selectInteraction.values[0]);
				const event = validEvents[selectedIndex];

				// Fetch contacts for the event's department
				const contacts = await sheetsManager.getContacts(event.department);

				if (!contacts || contacts.length === 0) {
					return selectInteraction.update({
						content: `❌ No contacts found for ${event.department} department.`,
						components: [],
						flags: MessageFlags.Ephemeral,
					});
				}

				// Create and send embed with event context
				const embed = createContactsEmbed(contacts, event.department);
				embed.setDescription(
					`**Event:** ${event.date} - ${event.dayOfWeek}\n` +
					`**Course:** ${event.courseSelection || 'N/A'}\n` +
					`**Location:** ${event.location || 'N/A'}\n\n` +
					`**Contacts for ${event.department}:**`,
				);

				await selectInteraction.update({
					content: '',
					embeds: [embed],
					components: [],
				});
			});

			collector.on('end', (collected) => {
				if (collected.size === 0) {
					interaction.editReply({
						content: '⏱️ Event selection timed out.',
						components: [],
					});
				}
			});

		}
		catch (error) {
			console.error('Error in /contactforevent command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching contact information. Please try again later.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
