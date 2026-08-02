const { Events } = require('discord.js');
const welcomeMessages = require('../utils/welcomeMessages');

module.exports = {
	name: Events.GuildMemberRemove,
	async execute(member) {
		try {
			// If the member left before verifying, clean up their welcome-ping message
			const pendingPing = welcomeMessages.get(member.id);
			if (!pendingPing) {
				return;
			}

			try {
				const pingChannel = await member.client.channels.fetch(pendingPing.channelId);
				const pingMessage = await pingChannel?.messages.fetch(pendingPing.messageId);
				await pingMessage?.delete();
			}
			catch (error) {
				console.error('Could not delete welcome ping message for leaving member:', error.message);
			}
			finally {
				welcomeMessages.delete(member.id);
			}
		}
		catch (error) {
			console.error('Error in guildMemberRemove event:', error);
		}
	},
};
