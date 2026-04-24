/**
 * HTTP endpoint for the member onboarding Apps Script.
 *
 * Add this to your existing discord.js bot. Call setupMemberEndpoint(client)
 * after your bot is logged in.
 *
 * Environment variables required:
 *   ONBOARD_PORT          - port to listen on (e.g. 25599 for PebbleHost)
 *   ONBOARD_SECRET        - shared secret; must match DISCORD_BOT_SECRET in Apps Script
 *
 * Request format:
 *   POST /members/add
 *   Headers: Authorization: Bearer <ONBOARD_SECRET>
 *   Body:    (Ignored, but payload size is limited to avoid abuse)
 *
 * Response (success): 200 { ok: true, detail: "..." }
 * Response (failure): 4xx/5xx { ok: false, error: "..." }
 */

const http = require('http');

function setupMemberEndpoint(client) {
	const port = parseInt(process.env.ONBOARD_PORT, 10);
	const secret = process.env.ONBOARD_SECRET;

	if (!port || !secret) {
		console.error('[onboard] ONBOARD_PORT and ONBOARD_SECRET must be set; endpoint disabled.');
		return;
	}

	const server = http.createServer((req, res) => {
	// Only accept POST /members/add
		if (req.method !== 'POST' || req.url !== '/members/add') {
	  return sendJson(res, 404, { ok: false, error: 'Not found' });
		}

		// Auth check (constant-time comparison to avoid timing attacks)
		const authHeader = req.headers['authorization'] || '';
		const expected = 'Bearer ' + secret;
		if (!safeEqual(authHeader, expected)) {
	  return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
		}

		// Read body (cap at 8 KB to avoid abuse)
		let body = '';
		let tooLarge = false;
		req.on('data', chunk => {
	  body += chunk;
	  if (body.length > 8192) {
				tooLarge = true;
				req.destroy();
	  }
		});
		req.on('end', async () => {
	  if (tooLarge) {
				return sendJson(res, 413, { ok: false, error: 'Payload too large' });
	  }

	  try {
				const detail = await handleAddMember(client);
				sendJson(res, 200, { ok: true, detail: detail });
	  }
			catch (e) {
				console.error('[onboard] handleAddMember failed:', e);
				sendJson(res, 500, { ok: false, error: String(e.message || e) });
	  }
		});
		req.on('error', err => {
	  console.error('[onboard] request error:', err);
		});
	});

	server.listen(port, () => {
		console.log('[onboard] listening on port ' + port);
	});

	server.on('error', err => {
		console.error('[onboard] server error:', err);
	});
}

const { performRoleSync } = require('../commands/admin/syncroles');

/**
 * Calls the existing syncroles logic to update member roles
 */
async function handleAddMember(client) {
	// Call the syncroles method
	const guild = client.guilds.cache.first();
	if (!guild) {
		return 'No guilds found; skipping sync.';
	}

	try {
		const result = await performRoleSync(guild);

		if (result.success && result.embed) {
			const staffChatChannelId = process.env.STAFF_CHAT_CHANNEL_ID;
			if (staffChatChannelId) {
				const staffChatChannel = guild.channels.cache.get(staffChatChannelId) || await guild.channels.fetch(staffChatChannelId).catch(() => null);
				if (staffChatChannel) {
					await staffChatChannel.send({
						content: `🔄 Automatic role sync triggered by member onboarding:`,
						embeds: [result.embed],
					});
				}
			}
			return 'Synced roles successfully';
		}
		else {
			return `Sync failed: ${result.message || 'Unknown error'}`;
		}
	}
	catch (e) {
		console.error('[onboard] Error during automatic role sync:', e);
		return `Sync failed: ${e.message}`;
	}
}

// ---------- helpers ----------

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(body),
	});
	res.end(body);
}

function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

module.exports = { setupMemberEndpoint };