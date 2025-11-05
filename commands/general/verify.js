const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');

module.exports = {
	cooldown: 10,
	data: new SlashCommandBuilder()
		.setName('verify')
		.setDescription('Verify yourself to gain access to the server'),
	async execute(interaction) {
		try {
			// Check if user has NT Unverified or Combined Unverified role
			const ntUnverifiedRoleId = process.env.NT_UNVERIFIED_ROLE_ID || '000000000000000000';
			const combinedUnverifiedRoleId = process.env.COMBINED_UNVERIFIED_ROLE_ID || '000000000000000000';
			const member = interaction.member;

			const hasUnverifiedRole = member.roles.cache.has(ntUnverifiedRoleId) || 
			                          member.roles.cache.has(combinedUnverifiedRoleId);

			if (!hasUnverifiedRole) {
				return interaction.reply({
					content: '❌ You do not have permission to use this command. This command is only for members with the NT Unverified or Combined Unverified role.',
					flags: MessageFlags.Ephemeral,
				});
			}

			// Create verification modal
			const modal = new ModalBuilder()
				.setCustomId('verificationModal')
				.setTitle('Member Verification');

			const nameInput = new TextInputBuilder()
				.setCustomId('fullName')
				.setLabel('Full Name')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('Enter your full name')
				.setRequired(true);

			const gradeInput = new TextInputBuilder()
				.setCustomId('grade')
				.setLabel('Grade Level')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('e.g., 9, 10, 11, 12')
				.setRequired(true);

			const schoolInput = new TextInputBuilder()
				.setCustomId('school')
				.setLabel('School Name')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('Enter your school name')
				.setRequired(true);

			const regionInput = new TextInputBuilder()
				.setCustomId('region')
				.setLabel('Region/Location')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('e.g., Bay Area, Southern California')
				.setRequired(true);

			const roboticsAndReferralInput = new TextInputBuilder()
				.setCustomId('roboticsAndReferral')
				.setLabel('How You Found Us & Robotics Team')
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder('Line 1: How you found Project NexTech\nLine 2: Your robotics team (or N/A)')
				.setRequired(true);

			const firstRow = new ActionRowBuilder().addComponents(nameInput);
			const secondRow = new ActionRowBuilder().addComponents(gradeInput);
			const thirdRow = new ActionRowBuilder().addComponents(schoolInput);
			const fourthRow = new ActionRowBuilder().addComponents(regionInput);
			const fifthRow = new ActionRowBuilder().addComponents(roboticsAndReferralInput);

			modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);

			await interaction.showModal(modal);

		}
		catch (error) {
			console.error('Error in /verify command:', error);
			await interaction.reply({
				content: '❌ An error occurred while opening the verification form.',
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
