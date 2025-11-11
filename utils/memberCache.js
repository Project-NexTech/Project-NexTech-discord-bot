const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'member-cache.json');

class MemberCache {
	constructor() {
		this.cache = new Map();
		this.lastUpdate = null;
	}

	/**
	 * Load cache from disk
	 */
	load() {
		try {
			if (fs.existsSync(CACHE_FILE)) {
				const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
				this.cache = new Map(Object.entries(data.members || {}));
				this.lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;
				console.log(`📂 Loaded ${this.cache.size} members from cache (last update: ${this.lastUpdate?.toLocaleString() || 'unknown'})`);
				return true;
			}
		} catch (error) {
			console.error('⚠️ Failed to load member cache:', error.message);
		}
		return false;
	}

	/**
	 * Save cache to disk
	 */
	save() {
		try {
			const dir = path.dirname(CACHE_FILE);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const data = {
				members: Object.fromEntries(this.cache),
				lastUpdate: this.lastUpdate?.toISOString() || new Date().toISOString(),
			};

			fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
			console.log(`💾 Saved ${this.cache.size} members to cache`);
			return true;
		} catch (error) {
			console.error('⚠️ Failed to save member cache:', error.message);
			return false;
		}
	}

	/**
	 * Update cache from guild members
	 * @param {Collection} members - Discord.js Collection of GuildMembers
	 */
	updateFromGuild(members) {
		this.cache.clear();
		
		for (const [id, member] of members) {
			// Skip bots - we don't need to interact with them
			if (member.user.bot) {
				continue;
			}

			// Store minimal data needed
			this.cache.set(id, {
				id: member.id,
				username: member.user.username,
				displayName: member.displayName,
				roles: Array.from(member.roles.cache.keys()),
				joinedAt: member.joinedAt?.toISOString(),
			});
		}

		this.lastUpdate = new Date();
		this.save();
	}

	/**
	 * Get member data from cache
	 * @param {string} memberId - Discord user ID
	 * @returns {Object|null} Cached member data or null
	 */
	getMember(memberId) {
		return this.cache.get(memberId) || null;
	}

	/**
	 * Check if member has a specific role
	 * @param {string} memberId - Discord user ID
	 * @param {string} roleId - Discord role ID
	 * @returns {boolean}
	 */
	memberHasRole(memberId, roleId) {
		const member = this.getMember(memberId);
		return member ? member.roles.includes(roleId) : false;
	}

	/**
	 * Get all members with a specific role
	 * @param {string} roleId - Discord role ID
	 * @returns {Array} Array of member data
	 */
	getMembersWithRole(roleId) {
		const result = [];
		for (const [id, member] of this.cache) {
			if (member.roles.includes(roleId)) {
				result.push(member);
			}
		}
		return result;
	}

	/**
	 * Get cache size
	 * @returns {number}
	 */
	size() {
		return this.cache.size;
	}

	/**
	 * Get last update time
	 * @returns {Date|null}
	 */
	getLastUpdate() {
		return this.lastUpdate;
	}

	/**
	 * Check if cache is stale (older than specified minutes)
	 * @param {number} minutes - Age threshold in minutes
	 * @returns {boolean}
	 */
	isStale(minutes = 30) {
		if (!this.lastUpdate) return true;
		const ageMs = Date.now() - this.lastUpdate.getTime();
		return ageMs > (minutes * 60 * 1000);
	}
}

// Export singleton instance
module.exports = new MemberCache();
