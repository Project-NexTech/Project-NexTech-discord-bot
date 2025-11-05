const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
	name: Events.GuildMemberUpdate,
	async execute(oldMember, newMember) {
		try {
			// Get unverified role IDs from environment (same roles that can run /verify)
			const ntUnverifiedRoleId = process.env.NT_UNVERIFIED_ROLE_ID || '000000000000000000';
			const combinedUnverifiedRoleId = process.env.COMBINED_UNVERIFIED_ROLE_ID || '000000000000000000';
			const verifyPingChannelId = process.env.VERIFY_PING_CHANNEL_ID;

			// Check if user just received one of the unverified roles (from Discord onboarding)
			const receivedUnverifiedRole = (
				(!oldMember.roles.cache.has(ntUnverifiedRoleId) && newMember.roles.cache.has(ntUnverifiedRoleId)) ||
				(!oldMember.roles.cache.has(combinedUnverifiedRoleId) && newMember.roles.cache.has(combinedUnverifiedRoleId))
			);

			if (!receivedUnverifiedRole) {
				return; // User didn't just get an unverified role
			}

			// Don't send welcome if user already has NT Member role (they were verified via /verifyuser command)
			const ntMemberRole = newMember.guild.roles.cache.find(role =>
				role.name.toLowerCase().includes('nt member'),
			);
			if (ntMemberRole && newMember.roles.cache.has(ntMemberRole.id)) {
				return; // User already verified, don't send welcome
			}

			// Make sure we have a channel to ping in
			if (!verifyPingChannelId) {
				console.error('VERIFY_PING_CHANNEL_ID not set in environment variables');
				return;
			}

			const verifyPingChannel = await newMember.guild.channels.fetch(verifyPingChannelId);
			if (!verifyPingChannel) {
				console.error('Could not find verify ping channel');
				return;
			}

			// Create welcome embed
			const embed = new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle('👋 Welcome to Project NexTech!')
				.setDescription(`Hey ${newMember}, welcome to the server! To gain full access, please verify yourself.`)
				.addFields(
					{ 
						name: '✅ How to Verify', 
						value: 'Run the `/verify` command to fill out a quick verification form. Our team will review it and grant you access shortly!',
					},
					{ 
						name: '❓ Questions?', 
						value: 'Feel free to DM this bot with any questions you may have!',
					},
				)
				.setTimestamp()
				.setFooter({ text: 'Project NexTech' });

			await verifyPingChannel.send({ 
				content: `${newMember}`,
				embeds: [embed],
			});

		}
		catch (error) {
			console.error('Error in guildMemberUpdate event:', error);
		}
	},
};
