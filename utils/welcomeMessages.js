const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'welcome-messages.json');

/**
 * Tracks the welcome/verification-ping message sent to the verification channel
 * for each unverified member, keyed by user ID, so it can be deleted once they
 * run /verify. Persisted to disk (write-through) so a bot restart between the
 * ping being sent and the member verifying doesn't orphan the mapping.
 */
class WelcomeMessages {
	constructor() {
		this.entries = new Map();
	}

	load() {
		try {
			if (fs.existsSync(STORE_FILE)) {
				const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
				this.entries = new Map(Object.entries(data.entries || {}));
				console.log(`📂 Loaded ${this.entries.size} pending welcome message(s) from disk`);
				return true;
			}
		}
		catch (error) {
			console.error('⚠️ Failed to load welcome messages store:', error.message);
		}
		return false;
	}

	save() {
		try {
			const dir = path.dirname(STORE_FILE);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const data = { entries: Object.fromEntries(this.entries) };
			fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
			return true;
		}
		catch (error) {
			console.error('⚠️ Failed to save welcome messages store:', error.message);
			return false;
		}
	}

	/**
	 * Record a sent welcome ping message so it can be cleaned up later.
	 * @param {string} userId - Discord user ID the ping was sent for
	 * @param {string} channelId - Channel the message was sent in
	 * @param {string} messageId - The sent message's ID
	 */
	set(userId, channelId, messageId) {
		this.entries.set(userId, { channelId, messageId });
		this.save();
	}

	/**
	 * @param {string} userId
	 * @returns {{channelId: string, messageId: string}|null}
	 */
	get(userId) {
		return this.entries.get(userId) || null;
	}

	delete(userId) {
		if (this.entries.delete(userId)) {
			this.save();
		}
	}
}

// Export singleton instance
module.exports = new WelcomeMessages();
