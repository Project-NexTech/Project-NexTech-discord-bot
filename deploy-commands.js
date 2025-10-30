require('dotenv').config();
const https = require('https');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('dns');

// Force IPv4 to avoid potential network issues
dns.setDefaultResultOrder('ipv4first');

// Load from environment variables or config file
let clientId, token, guildId, roleIds;
if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN && process.env.GUILD_ID) {
	clientId = process.env.CLIENT_ID;
	token = process.env.DISCORD_TOKEN;
	guildId = process.env.GUILD_ID;
	// Role IDs from environment variables
	roleIds = {
		ntMember: process.env.NT_MEMBER_ROLE_ID,
		ntUnverified: process.env.NT_UNVERIFIED_ROLE_ID,
		combinedUnverified: process.env.COMBINED_UNVERIFIED_ROLE_ID,
		ecRole: process.env.EC_ROLE_ID,
	};
}
else {
	const config = require('./config.json');
	clientId = config.clientId;
	token = config.token;
	guildId = config.guildId;
	roleIds = config.roleIds;
}

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		try {
			console.log(`Loading command: ${file}`);
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				commands.push(command.data.toJSON());
				console.log(`✓ Loaded command: ${command.data.name}`);
			}
			else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
		catch (error) {
			console.log(`[ERROR] Failed to load command at ${filePath}:`, error.message);
		}
	}
}

// Make raw HTTPS request to Discord API (bypasses discord.js hanging issues)
function makeDiscordRequest(method, apiPath, body) {
	return new Promise((resolve, reject) => {
		const bodyString = body !== null ? JSON.stringify(body) : '';
		
		const headers = {
			'Authorization': `Bot ${token}`,
			'User-Agent': 'DiscordBot (Project-NexTech, 1.0.0)',
		};

		// Only set Content-Type and Content-Length if we have a body
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
			family: 4, // Force IPv4
			timeout: 15000,
		};

		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					// Silent success for individual operations (too verbose otherwise)
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

// Helper to compare if two commands are different
function commandsAreDifferent(existing, local) {
	// Compare relevant fields that would require an update
	const existingData = JSON.stringify({
		name: existing.name,
		description: existing.description,
		options: existing.options || [],
		default_member_permissions: existing.default_member_permissions,
	});
	const localData = JSON.stringify({
		name: local.name,
		description: local.description,
		options: local.options || [],
		default_member_permissions: local.default_member_permissions,
	});
	return existingData !== localData;
}

// Deploy commands intelligently
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.\n`);

		const commandPath = `/applications/${clientId}/guilds/${guildId}/commands`;
		
		// Step 1: Get existing commands from Discord
		console.log('Fetching existing commands from Discord...');
		const existingCommands = await makeDiscordRequest('GET', commandPath, null);
		console.log(`Found ${existingCommands.length} existing commands\n`);

		let created = 0;
		let updated = 0;
		let skipped = 0;
		const errors = [];

		// Step 2: Process each local command
		for (const localCommand of commands) {
			const existingCommand = existingCommands.find(cmd => cmd.name === localCommand.name);

			if (!existingCommand) {
				// Command doesn't exist - CREATE it
				try {
					console.log(`Creating new command: ${localCommand.name}`);
					await makeDiscordRequest('POST', commandPath, localCommand);
					created++;
				}
				catch (error) {
					errors.push({ command: localCommand.name, action: 'create', error: error.message });
					console.error(`✗ Failed to create ${localCommand.name}: ${error.message}`);
				}
			}
			else if (commandsAreDifferent(existingCommand, localCommand)) {
				// Command exists but is different - UPDATE it
				try {
					console.log(`Updating command: ${localCommand.name}`);
					await makeDiscordRequest('PATCH', `${commandPath}/${existingCommand.id}`, localCommand);
					updated++;
				}
				catch (error) {
					errors.push({ command: localCommand.name, action: 'update', error: error.message });
					console.error(`✗ Failed to update ${localCommand.name}: ${error.message}`);
				}
			}
			else {
				// Command exists and is identical - SKIP
				console.log(`✓ Command unchanged: ${localCommand.name}`);
				skipped++;
			}

			// Small delay to avoid overwhelming the API
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Step 3: Optionally delete commands that no longer exist locally
		const localCommandNames = commands.map(cmd => cmd.name);
		const commandsToDelete = existingCommands.filter(cmd => !localCommandNames.includes(cmd.name));
		
		if (commandsToDelete.length > 0) {
			console.log(`\nFound ${commandsToDelete.length} command(s) to delete:`);
			for (const cmd of commandsToDelete) {
				try {
					console.log(`Deleting removed command: ${cmd.name}`);
					await makeDiscordRequest('DELETE', `${commandPath}/${cmd.id}`, null);
				}
				catch (error) {
					errors.push({ command: cmd.name, action: 'delete', error: error.message });
					console.error(`✗ Failed to delete ${cmd.name}: ${error.message}`);
				}
			}
		}

		// Summary
		console.log('\n' + '='.repeat(50));
		console.log('✅ Deployment Complete!');
		console.log('='.repeat(50));
		console.log(`Created: ${created}`);
		console.log(`Updated: ${updated}`);
		console.log(`Unchanged: ${skipped}`);
		console.log(`Deleted: ${commandsToDelete.length}`);
		if (errors.length > 0) {
			console.log(`Errors: ${errors.length}`);
		}
		console.log('='.repeat(50));

		if (errors.length > 0) {
			console.log('\n⚠️  Some commands failed:');
			errors.forEach(err => {
				console.log(`  - ${err.command} (${err.action}): ${err.error}`);
			});
		}
	}
	catch (error) {
		console.error('\n❌ Error deploying commands:');
		
		// Handle rate limiting specifically
		if (error.status === 429) {
			const retryAfter = error.retry_after || 'unknown';
			console.error('\n🚫 RATE LIMITED!');
			console.error(`You've hit Discord's daily limit for command creates (200 per day).`);
			console.error(`Retry after: ${retryAfter} seconds (${Math.ceil(retryAfter / 60)} minutes)\n`);
			console.error('💡 Note: PATCH updates to existing commands do NOT count against this limit!');
			console.error('This script now only creates/deletes commands when necessary.');
		}
		else {
			console.error(`Message: ${error.message}`);
		}
		process.exit(1);
	}
})();