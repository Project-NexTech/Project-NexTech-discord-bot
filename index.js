const path = require('node:path');
// Load .env from the script's directory, not the current working directory
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('node:fs');
const https = require('https');
const { Client, Collection, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const memberCache = require('./utils/memberCache');

// Load token from environment variable
const token = process.env.DISCORD_TOKEN;

const client = new Client({ 
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
	partials: [Partials.Channel], // Required for DMs
	presence: {
		activities: [{ name: 'STEM Education', type: ActivityType.Watching }],
		status: 'online',
	},
});

async function gracefulExit(fromStopCommand = false) {
	try {
		console.log('[Shutdown] Cleaning up…');
		
		// Save member cache before shutdown
		console.log('💾 Saving member cache...');
		memberCache.save();
		
		// Set bot status to invisible before destroying
		if (client?.user) {
			await client.user.setStatus('invisible');
			console.log('Bot status set to invisible');
		}
		
		// Wait a moment for the status update to propagate
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Destroy the client connection
		await client?.destroy?.();
		console.log('Client destroyed successfully');

		if (!fromStopCommand) {
			process.exit(0);
		}
		else {
			console.log('[Shutdown] Graceful shutdown complete. It is safe to stop the server now.');
		}
	}
	catch (error) {
		console.error('[Shutdown] Error during graceful shutdown:', error);
		process.exit(1);
	}
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

// Listen for "stop" command in stdin
const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
});

rl.on('line', (input) => {
	const command = input.trim().toLowerCase();
	if (command === 'stop') {
		console.log('Received "stop" command');
		gracefulExit(true);
	}
	else if (command) {
		console.log('Invalid command');
	}
});

client.commands = new Collection();
client.hourApprovalPending = new Map();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
client.cooldowns = new Collection();
client.projectGroupPending = new Map();

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	}
	else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

// Global error handlers to prevent crashes
process.on('unhandledRejection', (error) => {
	console.error('❌ Unhandled Promise Rejection:', error);
	console.error('Stack trace:', error.stack);
	// Don't exit - keep the bot running
});

process.on('uncaughtException', (error) => {
	console.error('❌ Uncaught Exception:', error);
	console.error('Stack trace:', error.stack);
	// Save member cache before exiting
	try {
		console.log('💾 Saving member cache before exit...');
		memberCache.save();
	}
	catch (saveError) {
		console.error('Failed to save cache:', saveError.message);
	}
	// For uncaught exceptions, we should exit gracefully
	// but give time to log the error and save data
	setTimeout(() => {
		console.error('Exiting due to uncaught exception...');
		process.exit(1);
	}, 1000);
});

// Discord.js specific error handlers
client.on('error', (error) => {
	console.error('❌ Discord Client Error:', error);
});

client.on('warn', (warning) => {
	console.warn('⚠️ Discord Client Warning:', warning);
});

client.login(token);

// Health check ping every 2 minutes
const HEALTH_CHECK_URL = 'https://hc-ping.com/98830f7e-ec5e-434b-85e3-160450ef27b1';
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS, 10) || 0; // milliseconds, 0 or unset disables pings

function sendHealthCheckPing() {
	https.get(HEALTH_CHECK_URL, (res) => {
		res.resume(); // Consume response data to free up memory
		if (res.statusCode === 200) {
			console.log('✅ Health check ping sent successfully');
		}
		else {
			console.log(`⚠️ Health check ping responded with status: ${res.statusCode}`);
		}
	}).on('error', (error) => {
		console.error('❌ Health check ping failed:', error.message);
	});
}

// Send initial ping after bot is ready
client.once('clientReady', () => {
	if (HEALTH_CHECK_INTERVAL > 0) {
		sendHealthCheckPing();
		// Set up interval for subsequent pings
		setInterval(sendHealthCheckPing, HEALTH_CHECK_INTERVAL);
	}
	else {
		console.log('⏸️ Health check pings are currently paused.');
	}
});

const { setupMemberEndpoint } = require('./utils/memberEndpoint');
client.once('clientReady', () => {
	setupMemberEndpoint(client);
});

// Windows-specific workaround for SIGINT (Ctrl+C) handling
if (process.platform === "win32") {
	const rlWin = require("readline").createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	rlWin.on("SIGINT", function() {
		process.emit("SIGINT");
	});
}
