require('dotenv').config();
const https = require('https');
const dns = require('dns');

// Force IPv4 to avoid potential network issues
dns.setDefaultResultOrder('ipv4first');

// Check for command-line arguments
const args = process.argv.slice(2);
const isGlobal = args.includes('--global') || args.includes('-g');
const commandName = args.find(arg => !arg.startsWith('-'));

if (!commandName || args.includes('--help') || args.includes('-h')) {
	console.log('Usage: node delete-command.js <command-name> [options]\n');
	console.log('Arguments:');
	console.log('  <command-name>  The name of the command to delete\n');
	console.log('Options:');
	console.log('  --global, -g    Delete from global commands (default: guild commands)');
	console.log('  --help, -h      Show this help message\n');
	console.log('Examples:');
	console.log('  node delete-command.js broadcast              # Delete "broadcast" from guild');
	console.log('  node delete-command.js verify --global        # Delete "verify" globally');
	process.exit(commandName ? 0 : 1);
}

// Load from environment variables
require('dotenv').config();
const clientId = process.env.CLIENT_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

// Make raw HTTPS request to Discord API
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
					let errorData;
					try {
						errorData = JSON.parse(data);
					}
					catch {
						errorData = { message: data };
					}
					const error = new Error(errorData.message || `HTTP ${res.statusCode}`);
					error.status = res.statusCode;
					error.retry_after = errorData.retry_after;
					reject(error);
				}
			});
		});

		req.on('error', (error) => reject(error));
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timed out after 15s'));
		});

		if (bodyString) {
			req.write(bodyString);
		}
		req.end();
	});
}

// Delete specific command
(async () => {
	try {
		const scope = isGlobal ? 'GLOBAL' : `GUILD (${guildId})`;
		console.log(`🗑️  Deleting command: "${commandName}" from ${scope}\n`);

		const commandPath = isGlobal
			? `/applications/${clientId}/commands`
			: `/applications/${clientId}/guilds/${guildId}/commands`;
		
		// Get all commands
		console.log('Fetching commands...');
		const commands = await makeDiscordRequest('GET', commandPath, null);
		
		// Find all commands with the specified name
		const matchingCommands = commands.filter(cmd => cmd.name === commandName);
		
		if (matchingCommands.length === 0) {
			console.log(`\n❌ Command "${commandName}" not found in ${scope}.`);
			console.log('\nAvailable commands:');
			commands.forEach(cmd => console.log(`  - ${cmd.name}`));
			process.exit(1);
		}

		console.log(`\nFound ${matchingCommands.length} command(s) with name "${commandName}":`);
		matchingCommands.forEach((cmd, index) => {
			console.log(`  ${index + 1}. ${cmd.name} (ID: ${cmd.id}) - ${cmd.description}`);
		});

		// Delete each matching command
		console.log(`\nDeleting ${matchingCommands.length} command(s)...`);
		let deleted = 0;
		
		for (const cmd of matchingCommands) {
			try {
				await makeDiscordRequest('DELETE', `${commandPath}/${cmd.id}`, null);
				deleted++;
				console.log(`✓ Deleted: ${cmd.name} (ID: ${cmd.id})`);
				
				// Small delay between deletions
				if (matchingCommands.length > 1) {
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
			catch (error) {
				console.error(`✗ Failed to delete ${cmd.name} (ID: ${cmd.id}): ${error.message}`);
			}
		}

		console.log('\n' + '='.repeat(50));
		console.log(`✅ Deleted ${deleted}/${matchingCommands.length} command(s)`);
		console.log('='.repeat(50));

		if (deleted > 1) {
			console.log('\n💡 Multiple commands with the same name were deleted (duplicates).');
		}
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		if (error.status === 429) {
			const retryAfter = error.retry_after || 'unknown';
			console.error(`Rate limited. Retry after: ${retryAfter} seconds`);
		}
		process.exit(1);
	}
})();
