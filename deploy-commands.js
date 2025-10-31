require('dotenv').config();
const https = require('https');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('dns');

// Force IPv4 to avoid potential network issues
dns.setDefaultResultOrder('ipv4first');

// Check for command-line arguments
const args = process.argv.slice(2);

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
	console.log('Usage: node deploy-commands.js [options]\n');
	console.log('Options:');
	console.log('  --global, -g    Deploy commands globally (all servers, takes up to 1 hour)');
	console.log('  --help, -h      Show this help message\n');
	console.log('Examples:');
	console.log('  node deploy-commands.js              # Deploy to guild (instant)');
	console.log('  node deploy-commands.js --global     # Deploy globally (slow)');
	process.exit(0);
}

const isGlobal = args.includes('--global') || args.includes('-g');

if (isGlobal) {
	console.log('Deploying as GLOBAL commands (will take up to 1 hour to propagate)\n');
}
else {
	console.log('Deploying as GUILD commands (instant updates)\n');
}

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

// Helper to normalize and compare commands
function normalizeCommand(cmd) {
	return {
		name: cmd.name,
		description: cmd.description,
		options: cmd.options || [],
		default_member_permissions: cmd.default_member_permissions || null,
		dm_permission: cmd.dm_permission,
		type: cmd.type || 1,
	};
}

// Helper to compare if two commands are different
function commandsAreDifferent(existing, local) {
	// Normalize both commands to ensure consistent comparison
	const existingNormalized = normalizeCommand(existing);
	const localNormalized = normalizeCommand(local);
	
	// Use sorted JSON to avoid false positives from key ordering
	const existingData = JSON.stringify(existingNormalized, Object.keys(existingNormalized).sort());
	const localData = JSON.stringify(localNormalized, Object.keys(localNormalized).sort());
	
	return existingData !== localData;
}

// Deploy commands intelligently
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.\n`);

		// Determine the command path based on deployment type
		const commandPath = isGlobal
			? `/applications/${clientId}/commands`
			: `/applications/${clientId}/guilds/${guildId}/commands`;
		
		// Step 1: Get existing commands from Discord
		console.log('Fetching existing commands from Discord...');
		const existingCommands = await makeDiscordRequest('GET', commandPath, null);
		console.log(`Found ${existingCommands.length} existing commands\n`);

		let created = 0;
		let updated = 0;
		let skipped = 0;
		const errors = [];

		// Step 2: Check for differences
		let hasChanges = false;
		
		// Check if any commands are new, modified, or deleted
		for (const localCommand of commands) {
			const existingCommand = existingCommands.find(cmd => cmd.name === localCommand.name);
			
			if (!existingCommand) {
				console.log(`New command detected: ${localCommand.name}`);
				created++;
				hasChanges = true;
			}
			else if (commandsAreDifferent(existingCommand, localCommand)) {
				console.log(`Modified command detected: ${localCommand.name}`);
				updated++;
				hasChanges = true;
			}
			else {
				console.log(`✓ Command unchanged: ${localCommand.name}`);
				skipped++;
			}
		}
		
		const localCommandNames = commands.map(cmd => cmd.name);
		const commandsToDelete = existingCommands.filter(cmd => !localCommandNames.includes(cmd.name));
		
		if (commandsToDelete.length > 0) {
			console.log(`\nCommands to be deleted: ${commandsToDelete.map(c => c.name).join(', ')}`);
			hasChanges = true;
		}

		// Step 3: If there are changes, use bulk overwrite (PUT) to update all commands at once
		// This is the recommended approach and prevents duplicates
		if (hasChanges) {
			console.log(`\n📝 Applying changes (bulk overwrite)...`);
			
			try {
				const result = await makeDiscordRequest('PUT', commandPath, commands);
				
				console.log(`✓ Successfully deployed ${result.length} commands`);
				
				// Reset counters since bulk overwrite was used
				created = commands.filter(cmd => !existingCommands.find(ex => ex.name === cmd.name)).length;
				updated = commands.filter(cmd => {
					const existing = existingCommands.find(ex => ex.name === cmd.name);
					return existing && commandsAreDifferent(existing, cmd);
				}).length;
			}
			catch (error) {
				// Handle rate limiting
				if (error.status === 429 && error.retry_after) {
					const waitTime = Math.ceil(error.retry_after) + 1;
					console.log(`⏱️  Rate limited. Waiting ${waitTime} seconds...`);
					await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
					
					// Retry
					try {
						console.log(`Retrying bulk deployment...`);
						const result = await makeDiscordRequest('PUT', commandPath, commands);
						console.log(`✓ Successfully deployed ${result.length} commands`);
					}
					catch (retryError) {
						errors.push({ command: 'bulk deployment', action: 'deploy', error: retryError.message });
						console.error(`✗ Failed to deploy commands after retry: ${retryError.message}`);
					}
				}
				else {
					errors.push({ command: 'bulk deployment', action: 'deploy', error: error.message });
					console.error(`✗ Failed to deploy commands: ${error.message}`);
				}
			}
		}
		else {
			console.log('\n✓ No changes detected. Skipping deployment.');
		}

		// Summary
		console.log('\n' + '='.repeat(50));
		console.log('✅ Deployment Complete!');
		console.log('='.repeat(50));
		console.log(`Scope: ${isGlobal ? 'GLOBAL (all servers)' : `GUILD (${guildId})`}`);
		console.log(`Created: ${created}`);
		console.log(`Updated: ${updated}`);
		console.log(`Unchanged: ${skipped}`);
		console.log(`Deleted: ${commandsToDelete.length}`);
		if (errors.length > 0) {
			console.log(`Errors: ${errors.length}`);
		}
		console.log('='.repeat(50));

		if (isGlobal && (created > 0 || updated > 0)) {
			console.log('\nGlobal commands can take up to 1 hour to appear in all servers.');
		}

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