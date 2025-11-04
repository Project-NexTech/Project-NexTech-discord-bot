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
		const commandPath = `/applications/${clientId}/guilds/${guildId}/commands`;
		const commands = await makeDiscordRequest('GET', commandPath, null);
		
		const broadcast = commands.find(cmd => cmd.name === 'broadcast');
		
		if (broadcast) {
			console.log('Current broadcast command from Discord:');
			console.log(JSON.stringify(broadcast, null, 2));
		}
		else {
			console.log('No broadcast command found');
		}
	}
	catch (error) {
		console.error('Error:', error.message);
	}
})();
