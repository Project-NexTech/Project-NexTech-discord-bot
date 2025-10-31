const { Events } = require('discord.js');
const sheetsManager = require('../utils/sheets');
const { startCalendarSync } = require('../utils/calendarSync');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		
		// Initialize Google Sheets API
		try {
			await sheetsManager.initialize();
			console.log('✅ Google Sheets integration ready');
		}
		catch (error) {
			console.error('❌ Failed to initialize Google Sheets:', error.message);
		}

		// Start automatic calendar synchronization
		try {
			startCalendarSync(client, 5); // Check every 5 minutes
			console.log('✅ Calendar synchronization started');
		}
		catch (error) {
			console.error('❌ Failed to start calendar sync:', error.message);
		}

		// Start periodic check for users who left the server (if enabled)
		const checkLeftUsersEnabled = process.env.CHECK_LEFT_USERS_ENABLED === 'true';
		if (checkLeftUsersEnabled) {
			try {
				const checkLeftUsers = async () => {
					const guildId = process.env.GUILD_ID;
					const guild = await client.guilds.fetch(guildId);
					const result = await sheetsManager.checkLeftUsers(guild);
					console.log(`[LeftUsersCheck] Completed: ${result.checked} checked, ${result.marked} marked`);
				};

				// Run immediately on startup
				checkLeftUsers();

				// Then run every 6 hours (21600000 ms)
				setInterval(checkLeftUsers, 6 * 60 * 60 * 1000);
				console.log('✅ Left users checker started (runs every 6 hours)');
			}
			catch (error) {
				console.error('❌ Failed to start left users checker:', error.message);
			}
		} else {
			console.log('ℹ️ Left users checker is disabled (CHECK_LEFT_USERS_ENABLED=false)');
		}
	},
};
