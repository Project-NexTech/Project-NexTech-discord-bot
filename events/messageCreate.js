const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		console.log(`[MessageCreate] Received message from ${message.author.tag} in ${message.guild ? 'guild' : 'DM'}`);
		
		// Ignore messages from bots
		if (message.author.bot) {
			console.log('[MessageCreate] Ignoring bot message');
			return;
		}

		// Check if the message is a DM (not in a guild)
		if (!message.guild) {
			console.log('[MessageCreate] Processing DM...');
			try {
				const verificationChannelId = process.env.VERIFICATION_CHANNEL_ID;
				const verificationTeamRoleId = process.env.VERIFICATION_TEAM_ROLE_ID;
				console.log(`[MessageCreate] Verification channel ID: ${verificationChannelId}`);
				
				if (!verificationChannelId) {
					console.error('VERIFICATION_CHANNEL_ID not found in environment variables');
					return;
				}

				// Get the verification channel
				const verificationChannel = await message.client.channels.fetch(verificationChannelId);
				
				if (!verificationChannel) {
					console.error('Could not find verification channel');
					return;
				}

				// Create an embed to forward the message
				const embed = new EmbedBuilder()
					.setColor(0x0099FF)
					.setAuthor({
						name: `${message.author.tag} (${message.author.id})`,
						iconURL: message.author.displayAvatarURL({ dynamic: true })
					})
					.setDescription(message.content || '*No text content*')
					.setTimestamp(message.createdAt)
					.setFooter({ text: 'Direct Message Received' });

				// Add attachments if any
				if (message.attachments.size > 0) {
					const attachmentList = message.attachments.map(att => `[${att.name}](${att.url})`).join('\n');
					embed.addFields({ name: 'Attachments', value: attachmentList });
				}

				// Add embeds if any
				if (message.embeds.length > 0) {
					embed.addFields({ name: 'Embeds', value: `${message.embeds.length} embed(s) in original message` });
				}

				// Add stickers if any
				if (message.stickers.size > 0) {
					const stickerList = message.stickers.map(sticker => sticker.name).join(', ');
					embed.addFields({ name: 'Stickers', value: stickerList });
				}

				// Forward to verification channel with role ping
				const rolePing = verificationTeamRoleId ? `<@&${verificationTeamRoleId}>` : '';
				await verificationChannel.send({ 
					content: rolePing,
					embeds: [embed] 
				});

				// Forward any attachments
				if (message.attachments.size > 0) {
					const attachmentUrls = message.attachments.map(att => att.url).join('\n');
					await verificationChannel.send(`**Attachments:**\n${attachmentUrls}`);
				}

				console.log(`Forwarded DM from ${message.author.tag} to verification channel`);
			} catch (error) {
				console.error('Error forwarding DM:', error);
			}
		}
	},
};
