const { Events } = require('discord.js');
const sheetsManager = require('../utils/sheets');
const { startCalendarSync } = require('../utils/calendarSync');
const memberCache = require('../utils/memberCache');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		
		// Load persistent member cache from disk
		console.log('📂 Loading member cache from disk...');
		memberCache.load();
		
		// Track guild member counts to only log when changed
		const guildMemberCounts = new Map();
		
		// Fetch all guild members to populate cache (for nickname conflict detection and broadcasts)
		const fetchAllMembers = async () => {
			try {
				for (const guild of client.guilds.cache.values()) {
					const previousCount = guildMemberCounts.get(guild.id);
					
					// Only log "Fetching" on initial load
					if (memberCache.isInitialLoad) {
						console.log(`🔄 Fetching members for guild: ${guild.name}...`);
					}
					
					const members = await guild.members.fetch({ force: true });
					
					// Only log if count changed or it's the initial load
					if (memberCache.isInitialLoad || previousCount !== members.size) {
						console.log(`✅ Cached ${members.size} members from guild: ${guild.name}`);
						guildMemberCounts.set(guild.id, members.size);
					}
					
					// Update persistent cache
					memberCache.updateFromGuild(members);
				}
				
				// Mark initial load as complete after first run
				if (memberCache.isInitialLoad) {
					memberCache.isInitialLoad = false;
				}
			} catch (error) {
				console.error('⚠️ Failed to fetch guild members:', error.message);
			}
		};

		// Initial fetch (even if we loaded from disk, we want fresh data)
		await fetchAllMembers();

		// Refresh member cache every 15 minutes to keep it warm
		setInterval(async () => {
			console.log('🔄 Refreshing member cache...');
			await fetchAllMembers();
		}, 15 * 60 * 1000); // 15 minutes
		
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
				setInterval(checkLeftUsers, 2 * 60 * 60 * 1000);
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
