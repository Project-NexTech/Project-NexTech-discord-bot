require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// Load config
let token, guildId;
if (process.env.DISCORD_TOKEN && process.env.GUILD_ID) {
	token = process.env.DISCORD_TOKEN;
	guildId = process.env.GUILD_ID;
}
else {
	const config = require('./config.json');
	token = config.token;
	guildId = config.guildId;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
	console.log('Bot is ready! Fetching roles...\n');
	
	const guild = await client.guilds.fetch(guildId);
	await guild.roles.fetch();
	
	// Find the specific roles we need
	const roles = {
		'NT Member': guild.roles.cache.find(r => r.name === 'NT Member'),
		'NexTech Unverified': guild.roles.cache.find(r => r.name.includes('NexTech Unverified')),
		'Combined Unverified': guild.roles.cache.find(r => r.name.includes('Combined Unverified')),
		'NT Executive Committee': guild.roles.cache.find(r => r.name.includes('NT Executive Committee')),
	};
	
	console.log('=== ROLE IDs FOR CONFIG.JSON ===\n');
	console.log('"roleIds": {');
	console.log(`  "ntMember": "${roles['NT Member']?.id || 'NOT_FOUND'}",`);
	console.log(`  "ntUnverified": "${roles['NexTech Unverified']?.id || 'NOT_FOUND'}",`);
	console.log(`  "combinedUnverified": "${roles['Combined Unverified']?.id || 'NOT_FOUND'}",`);
	console.log(`  "ecRole": "${roles['NT Executive Committee']?.id || 'NOT_FOUND'}"`);
	console.log('}\n');
	
	console.log('Copy the above JSON and paste it into your config.json file.\n');
	
	client.destroy();
});

client.login(token);
