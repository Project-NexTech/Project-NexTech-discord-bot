const { Collection, Events, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		// Handle cancel verification button
		if (interaction.isButton() && interaction.customId.startsWith('cancel_verification_')) {
			const userId = interaction.customId.replace('cancel_verification_', '');
			
			// Check if we have pending verification data
			if (!interaction.client.verificationPending || !interaction.client.verificationPending.has(userId)) {
				return interaction.reply({
					content: '❌ Verification session already expired or completed.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const pendingData = interaction.client.verificationPending.get(userId);
			const { timeoutId, targetMember } = pendingData;

			// Clear the timeout
			if (timeoutId) {
				clearTimeout(timeoutId);
			}

			// Remove pending verification data
			interaction.client.verificationPending.delete(userId);

			// Update the original message to show cancellation
			await interaction.update({
				content: `❌ **Verification Cancelled**\n\nThe verification for ${targetMember.user} has been cancelled. No changes were made.`,
				components: [], // Remove buttons
			});

			return;
		}

		// Handle button interactions for nickname conflict resolution
		if (interaction.isButton() && interaction.customId.startsWith('resolve_nickname_conflict_')) {
			const userId = interaction.customId.replace('resolve_nickname_conflict_', '');
			
			// Check if we have pending verification data
			if (!interaction.client.verificationPending || !interaction.client.verificationPending.has(userId)) {
				return interaction.reply({
					content: '❌ Verification session expired. Please run the /verifyuser command again.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const pendingData = interaction.client.verificationPending.get(userId);
		const { targetMember, conflictingMember, userData, newUserLastName } = pendingData;

		// Parse the user's name to get suggested nickname
		const nameParts = userData.name.trim().split(/\s+/);
		const firstName = nameParts[0];
		// Use the stored newUserLastName from pending data (already extracted during conflict detection)
		const lastName = newUserLastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');
		const lastInitial = lastName ? lastName.charAt(0).toUpperCase() : '';

		// Create a modal for nickname resolution
		const modal = new ModalBuilder()
			.setCustomId(`nickname_conflict_${userId}_${conflictingMember.id}`)
			.setTitle('Nickname Conflict Resolution');

		const newUserNicknameInput = new TextInputBuilder()
			.setCustomId('new_user_nickname')
			.setLabel(`New member: ${targetMember.user.username}`)
			.setStyle(TextInputStyle.Short)
			.setPlaceholder(`e.g., ${firstName} ${lastInitial}. (no [ɴᴛ] prefix)`)
			.setValue(lastName ? `${firstName} ${lastInitial}.` : `${firstName}`)
			.setRequired(true)
			.setMaxLength(32);

		const existingUserNicknameInput = new TextInputBuilder()
			.setCustomId('existing_user_nickname')
			.setLabel(`Existing member: ${conflictingMember.user.username}`)
			.setStyle(TextInputStyle.Short)
			.setPlaceholder(`e.g., ${firstName} X. (no [ɴᴛ] prefix)`)
				.setMaxLength(32);

			const row1 = new ActionRowBuilder().addComponents(newUserNicknameInput);
			const row2 = new ActionRowBuilder().addComponents(existingUserNicknameInput);

			modal.addComponents(row1, row2);

			await interaction.showModal(modal);
			
			// Remove the buttons from the original message after modal is shown
			// The message is from the original /verifyuser command (stored in pendingData)
			try {
				const originalInteraction = pendingData.interaction;
				await originalInteraction.editReply({
					content: interaction.message.content, // Keep the same content
					components: [], // Remove buttons
				});
			} catch (editError) {
				console.error('Failed to remove buttons from message:', editError);
			}
			
			return;
		}

		// Handle autocomplete interactions
		if (interaction.isAutocomplete()) {
			const command = interaction.client.commands.get(interaction.commandName);
			
			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				if (command.autocomplete) {
					await command.autocomplete(interaction);
				}
			}
			catch (error) {
				console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
			}
			return;
		}

		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}
		const { cooldowns } = interaction.client;

		if (!cooldowns.has(command.data.name)) {
			cooldowns.set(command.data.name, new Collection());
		}

		const now = Date.now();
		const timestamps = cooldowns.get(command.data.name);
		const defaultCooldownDuration = 3;
		const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1_000;

		if (timestamps.has(interaction.user.id)) {
			const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

			if (now < expirationTime) {
				const expiredTimestamp = Math.round(expirationTime / 1_000);
				return interaction.reply({
					content: `Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		timestamps.set(interaction.user.id, now);
		setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

		try {
			console.log(`Executing command ${interaction.commandName}`);
			await command.execute(interaction);
		}
		catch (error) {
			console.error(error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({
					content: 'There was an error while executing this command!',
					flags: MessageFlags.Ephemeral,
				});
			} 
			else {
				await interaction.reply({
					content: 'There was an error while executing this command!',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};