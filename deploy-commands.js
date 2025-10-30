require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

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
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// // Delete all existing global commands to prevent duplicates
		// console.log('Deleting old global commands...');
		// await rest.put(Routes.applicationCommands(clientId), { body: [] });

		// // Delete all existing guild commands to prevent duplicates
		// console.log('Deleting old guild commands...');
		// await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });

		// Deploy new commands to the guild
		console.log('Deploying new commands to guild...');
		const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);

		// Set up command permissions using role IDs
		console.log('Setting up command permissions...');
		
		// Check if role IDs are configured
		if (!roleIds || !roleIds.ntMember) {
			console.warn('⚠️ Role IDs not configured in config.json. Skipping permission setup.');
			console.log('To enable automatic permissions, add role IDs to your config.json');
			return;
		}
		
		console.log('Using role IDs from config:');
		console.log(`  NT Member: ${roleIds.ntMember}`);
		console.log(`  NT Unverified: ${roleIds.ntUnverified || 'Not configured'}`);
		console.log(`  Combined Unverified: ${roleIds.combinedUnverified || 'Not configured'}`);
		console.log(`  EC: ${roleIds.ecRole || 'Not configured'}`);
		
		// Get deployed commands using REST API (no bot login required)
		const deployedCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
		
		for (const command of deployedCommands) {
			const permissions = [];
			
			// Default: Disable for @everyone, enable for NT Member
			permissions.push({
				id: guildId, // @everyone
				type: 1, // Role
				permission: false,
			});
			
			if (roleIds.ntMember) {
				permissions.push({
					id: roleIds.ntMember,
					type: 1,
					permission: true,
				});
			}
			
			// Override for /verify command
			if (command.name === 'verify') {
				// Only allow unverified roles
				if (roleIds.ntUnverified) {
					permissions.push({
						id: roleIds.ntUnverified,
						type: 1,
						permission: true,
					});
				}
				if (roleIds.combinedUnverified) {
					permissions.push({
						id: roleIds.combinedUnverified,
						type: 1,
						permission: true,
					});
				}
				// Disable NT Member for verify command
				if (roleIds.ntMember) {
					permissions.push({
						id: roleIds.ntMember,
						type: 1,
						permission: false,
					});
				}
			}
			
			// Override for admin commands (commands in /commands/admin/)
			const adminCommands = ['verifyuser', 'syncroles'];
			if (adminCommands.includes(command.name)) {
				// Only allow EC role and Administrators
				if (roleIds.ecRole) {
					permissions.push({
						id: roleIds.ecRole,
						type: 1,
						permission: true,
					});
				}
				// Disable NT Member for admin commands
				if (roleIds.ntMember) {
					permissions.push({
						id: roleIds.ntMember,
						type: 1,
						permission: false,
					});
				}
			}
			
			try {
				await rest.put(
					Routes.applicationCommandPermissions(clientId, guildId, command.id),
					{ permissions }
				);
				console.log(`✅ Set permissions for /${command.name}`);
			}
			catch (error) {
				console.error(`❌ Failed to set permissions for /${command.name}:`, error.message);
			}
		}
		
		console.log('✅ Command permissions setup complete!');
	}
	catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();