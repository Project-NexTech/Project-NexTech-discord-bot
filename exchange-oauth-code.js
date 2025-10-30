require('dotenv').config();
const fetch = require('node-fetch');

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;

// Get the authorization code from command line
const code = process.argv[2];

if (!code) {
	console.error('❌ Error: No authorization code provided');
	console.log('\nUsage: node exchange-oauth-code.js YOUR_CODE_HERE');
	console.log('\nThe code is the value after "?code=" in the redirect URL');
	process.exit(1);
}

if (!clientSecret) {
	console.error('\n❌ Error: CLIENT_SECRET not found in .env file');
	console.log('\n📝 Please add your client secret to .env:');
	console.log('   1. Go to https://discord.com/developers/applications');
	console.log(`   2. Select your application (ID: ${clientId})`);
	console.log('   3. Go to OAuth2 > General');
	console.log('   4. Copy your Client Secret');
	console.log('   5. Add to .env: CLIENT_SECRET=your_secret_here\n');
	process.exit(1);
}

(async () => {
	try {
		// Exchange the code for an access token
		const params = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'authorization_code',
			code: code,
		});

		const response = await fetch('https://discord.com/api/v10/oauth2/token', {
			method: 'POST',
			body: params,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});

		const data = await response.json();

		if (data.error) {
			console.error('\n❌ Error from Discord API:', data.error);
			console.error('Description:', data.error_description || 'No description provided');
			console.log('\n💡 Common issues:');
			console.log('   - The authorization code may have expired (they only last 10 minutes)');
			console.log('   - The code may have already been used');
			console.log('   - The CLIENT_SECRET might be incorrect');
			console.log('   - Make sure you copied the entire code (no spaces/line breaks)');
			console.log('\nTry running: node generate-oauth-url.js (and get a new code)\n');
			process.exit(1);
		}

		if (!data.access_token) {
			console.error('\n❌ No access token in response');
			console.error('Full response:', JSON.stringify(data, null, 2));
			process.exit(1);
		}

		console.log('\n✅ Successfully obtained OAuth2 token!\n');
		console.log('=================================================');
		console.log('📋 ADD THIS TO YOUR .env FILE:');
		console.log('=================================================\n');
		console.log(`OAUTH2_TOKEN=${data.access_token}\n`);
		console.log('=================================================\n');
		console.log('Token details:');
		console.log(`  Type: ${data.token_type}`);
		console.log(`  Expires in: ${data.expires_in} seconds (${Math.round(data.expires_in / 3600)} hours)`);
		console.log(`  Scope: ${data.scope}`);

		if (data.refresh_token) {
			console.log('\n💡 Refresh token also provided:');
			console.log(`OAUTH2_REFRESH_TOKEN=${data.refresh_token}`);
			console.log('\n(Save this too - you can use it to get a new token when this one expires)');
		}

		console.log('\n✅ Now you can run: node deploy-commands.js\n');
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		console.error('Stack:', error.stack);
	}
})();
