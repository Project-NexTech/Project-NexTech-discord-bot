const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

			// Pagination setup
			const eventsPerPage = 13;
			const totalPages = Math.ceil(events.length / eventsPerPage);
			let currentPage = 0;

			const getPageEvents = (page) => {
				const start = page * eventsPerPage;
				const end = start + eventsPerPage;
				return events.slice(start, end);
			};

			const createButtons = (page) => {
				const row = new ActionRowBuilder();
				
				const prevButton = new ButtonBuilder()
					.setCustomId(`events_prev_${interaction.id}`)
					.setLabel('Previous')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === 0);

				const pageButton = new ButtonBuilder()
					.setCustomId(`events_page_${interaction.id}`)
					.setLabel(`Page ${page + 1}/${totalPages}`)
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true);

				const nextButton = new ButtonBuilder()
					.setCustomId(`events_next_${interaction.id}`)
					.setLabel('Next')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === totalPages - 1);

				row.addComponents(prevButton, pageButton, nextButton);
				return row;
			};

			// Send initial page
			const embed = createEventsEmbed(getPageEvents(currentPage), department, currentPage + 1, totalPages);
			const components = totalPages > 1 ? [createButtons(currentPage)] : [];
			
			const message = await interaction.editReply({ 
				embeds: [embed],
				components: components
			});

			// If only one page, we're done
			if (totalPages <= 1) {
				return;
			}

			// Create collector for button interactions
			const collector = message.createMessageComponentCollector({ 
				filter: i => i.user.id === interaction.user.id && i.customId.startsWith('events_'),
				time: 300_000 // 5 minutes
			});

			collector.on('collect', async (buttonInteraction) => {
				try {
					if (buttonInteraction.customId === `events_prev_${interaction.id}`) {
						currentPage = Math.max(0, currentPage - 1);
					} else if (buttonInteraction.customId === `events_next_${interaction.id}`) {
						currentPage = Math.min(totalPages - 1, currentPage + 1);
					}

					const newEmbed = createEventsEmbed(getPageEvents(currentPage), department, currentPage + 1, totalPages);
					const newButtons = createButtons(currentPage);

					await buttonInteraction.update({
						embeds: [newEmbed],
						components: [newButtons]
					});
				} catch (error) {
					console.error('Error handling pagination button:', error);
				}
			});

			collector.on('end', async () => {
				try {
					// Disable buttons when collector expires
					const disabledRow = new ActionRowBuilder();
					const buttons = createButtons(currentPage).components;
					buttons.forEach(button => button.setDisabled(true));
					disabledRow.addComponents(buttons);

					await interaction.editReply({
						components: [disabledRow]
					});
				} catch (error) {
					// Interaction might be deleted, ignore
				}
			});

		}
		catch (error) {
			console.error('Error in /events command:', error);
			await interaction.editReply({
				content: '❌ An error occurred while fetching events. Please try again later.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
