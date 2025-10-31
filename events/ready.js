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
	},
};
