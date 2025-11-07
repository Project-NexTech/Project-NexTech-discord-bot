const path = require('node:path');
// Load .env from the script's directory, not the current working directory
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits, Partials, ActivityType } = require('discord.js');

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

client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
client.cooldowns = new Collection();

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

client.login(token);

// Windows-specific workaround for SIGINT (Ctrl+C) handling
if (process.platform === "win32") {
	const rl = require("readline").createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	rl.on("SIGINT", function () {
		process.emit("SIGINT");
	});
}

// Graceful shutdown handler
process.on("SIGINT", async function () {
	console.log("\nGracefully shutting down...");
	try {
		// Set bot status to invisible before destroying
		await client.user?.setStatus('invisible');
		console.log("Bot status set to invisible");
		
		// Wait a moment for the status update to propagate
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Destroy the client connection
		client.destroy();
		console.log("Client destroyed successfully");
	} catch (error) {
		console.error("Error during shutdown:", error);
		process.exit(1);
	}
	process.exit(0);
});
