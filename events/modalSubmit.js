const { Events, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isModalSubmit()) return;

		if (interaction.customId === 'verificationModal') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			try {
				const fullName = interaction.fields.getTextInputValue('fullName');
				const grade = interaction.fields.getTextInputValue('grade');
				const school = interaction.fields.getTextInputValue('school');
				const region = interaction.fields.getTextInputValue('region');
				const roboticsAndReferral = interaction.fields.getTextInputValue('roboticsAndReferral');
				
				// Parse the combined field (Line 1: How found us, Line 2: Robotics team)
				const lines = roboticsAndReferral.split('\n');
				const referralSource = lines[0]?.trim() || 'Not specified';
				const roboticsTeam = lines.slice(1).join('\n').trim() || 'N/A';

				// Get staff chat channel for verification review
				const verificationChannelId = process.env.STAFF_CHAT_CHANNEL_ID;
				if (!verificationChannelId) {
					console.error('STAFF_CHAT_CHANNEL_ID not set in environment variables');
					return interaction.editReply({
						content: '❌ Verification system is not properly configured. Please contact an administrator.',
						flags: MessageFlags.Ephemeral,
					});
				}

				const verificationChannel = await interaction.client.channels.fetch(verificationChannelId);
				if (!verificationChannel) {
					console.error('Could not find staff chat channel');
					return interaction.editReply({
						content: '❌ Could not access verification channel. Please contact an administrator.',
						flags: MessageFlags.Ephemeral,
					});
				}

				// Create verification submission embed
				const embed = new EmbedBuilder()
					.setColor(0x5865F2)
					.setTitle('🆕 New Verification Submission')
					.setDescription(`${interaction.user} has submitted a verification request.`)
					.setThumbnail(interaction.user.displayAvatarURL())
					.addFields(
						{ name: '👤 Discord User', value: `<@${interaction.user.id}>\n${interaction.user.tag}`, inline: false },
						{ name: '📝 Full Name', value: fullName, inline: true },
						{ name: '🎓 Grade', value: grade, inline: true },
						{ name: '🏫 School', value: school, inline: true },
						{ name: '📍 Region', value: region, inline: true },
						{ name: '🤖 Robotics Team', value: roboticsTeam, inline: true },
						{ name: '💡 How They Found Us', value: referralSource, inline: false },
					)
					.setTimestamp()
					.setFooter({ text: `User ID: ${interaction.user.id}` });

				await verificationChannel.send({ 
					content: `<@&${process.env.VERIFICATION_TEAM_ROLE_ID || '000000000000000000'}> New verification pending!`,
					embeds: [embed],
				});

				// Send confirmation to user
				const confirmationEmbed = new EmbedBuilder()
					.setColor(0x57F287)
					.setTitle('✅ Verification Submitted')
					.setDescription('Thank you for submitting your verification! Our team will review your information shortly.')
					.addFields(
						{ name: '⏱️ What\'s Next?', value: 'A member of the verification team will review your submission and grant you access to the server. This usually takes a few hours.' },
					)
					.setTimestamp()
					.setFooter({ text: 'Project NexTech' });

				await interaction.editReply({ embeds: [confirmationEmbed] });

			}
			catch (error) {
				console.error('Error processing verification submission:', error);
				await interaction.editReply({
					content: '❌ An error occurred while submitting your verification. Please try again later or contact an administrator.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};
