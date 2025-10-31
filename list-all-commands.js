require('dotenv').config();
const https = require('https');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

const clientId = process.env.CLIENT_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

function makeDiscordRequest(method, apiPath, body) {
	return new Promise((resolve, reject) => {
		const bodyString = body !== null ? JSON.stringify(body) : '';
		const headers = {
			'Authorization': `Bot ${token}`,
			'User-Agent': 'DiscordBot (Project-NexTech, 1.0.0)',
		};
		if (body !== null) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = Buffer.byteLength(bodyString);
		}
		const options = {
			hostname: 'discord.com',
			port: 443,
			path: `/api/v10${apiPath}`,
			method: method,
			headers: headers,
			family: 4,
			timeout: 15000,
		};
		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					try {
						resolve(data ? JSON.parse(data) : {});
					}
					catch {
						resolve(data || {});
					}
				}
				else {
					reject(new Error(`HTTP ${res.statusCode}`));
				}
			});
		});
		req.on('error', (error) => reject(error));
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timed out'));
		});
		if (bodyString) {
			req.write(bodyString);
		}
		req.end();
	});
}

(async () => {
	try {
		console.log('Fetching guild commands...');
		const guildPath = `/applications/${clientId}/guilds/${guildId}/commands`;
		const guildCommands = await makeDiscordRequest('GET', guildPath, null);
		
		console.log(`\nGuild commands (${guildCommands.length}):`);
		guildCommands.forEach(cmd => {
			console.log(`  - ${cmd.name} (ID: ${cmd.id})`);
		});

		console.log('\n\nFetching global commands...');
		const globalPath = `/applications/${clientId}/commands`;
		const globalCommands = await makeDiscordRequest('GET', globalPath, null);
		
		console.log(`\nGlobal commands (${globalCommands.length}):`);
		globalCommands.forEach(cmd => {
			console.log(`  - ${cmd.name} (ID: ${cmd.id})`);
		});

		// Check for broadcast specifically
		const guildBroadcast = guildCommands.filter(cmd => cmd.name === 'broadcast');
		const globalBroadcast = globalCommands.filter(cmd => cmd.name === 'broadcast');

		console.log('\n' + '='.repeat(50));
		console.log(`Broadcast in guild: ${guildBroadcast.length}`);
		console.log(`Broadcast in global: ${globalBroadcast.length}`);
		console.log('='.repeat(50));
	}
	catch (error) {
		console.error('Error:', error.message);
	}
})();
