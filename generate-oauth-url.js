require('dotenv').config();

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Required scopes for managing command permissions
const scopes = [
	'applications.commands.permissions.update'
];

const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&scope=${scopes.join('%20')}&response_type=code`;

console.log('\n=================================================');
console.log('📋 OAUTH2 SETUP INSTRUCTIONS');
console.log('=================================================\n');
console.log('IMPORTANT: Make sure you have added CLIENT_SECRET to your .env file first!\n');
console.log('1. Copy this URL and open it in your browser:\n');
console.log(authUrl);
console.log('\n2. Click "Authorize" (select your server if prompted)');
console.log('\n3. After authorizing, you will be redirected to a URL containing:');
console.log('   ...?code=XXXXXXXXXXXXX');
console.log('\n4. Copy ONLY the code part (everything after "code=" and before any "&")');
console.log('   - The code is usually very long (50+ characters)');
console.log('   - Do NOT include "code=" itself');
console.log('   - Make sure there are no spaces or line breaks');
console.log('\n5. Run: node exchange-oauth-code.js YOUR_CODE_HERE');
console.log('\n   Example:');
console.log('   node exchange-oauth-code.js AbCdEf1234567890XyZ...');
console.log('\n=================================================\n');
