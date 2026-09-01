const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

/**
 * Convert a display name into a valid Discord channel name.
 * Canonical copy — commands/admin/createprojectgroup.js imports this;
 * create-all-project-groups.js keeps its own standalone copy on purpose.
 * @param {string} name - Original display name
 * @returns {string} Slugified channel name
 */
function slugify(name) {
	return name
		.toLowerCase()
		.replace(/\s+/g, '-') // whitespace runs -> single dash
		.replace(/[^a-z0-9-]/g, '') // strip invalid characters
		.replace(/-+/g, '-') // collapse consecutive dashes
		.replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

/**
 * The category IDs project group channels live under, in priority order.
 * The second category is optional — an empty/missing env var is filtered out.
 * @returns {string[]} Category IDs
 */
function getProjectGroupCategoryIds() {
	return [
		process.env.PROJECT_GROUPS_CATEGORY_ID,
		process.env.PROJECT_GROUPS_CATEGORY_2_ID,
	].filter(Boolean);
}

/**
 * Find a text channel with the given slug name under the project group categories.
 * Deterministic on duplicate names: categories in env order, then position, then ID.
 * @param {import('discord.js').Guild} guild - The guild to search
 * @param {string} slug - Slugified channel name to look for
 * @param {string[]} categoryIds - Category IDs in priority order
 * @returns {import('discord.js').TextChannel|null} The matching channel, if any
 */
function findChannelBySlug(guild, slug, categoryIds) {
	if (!slug) return null;

	for (const categoryId of categoryIds) {
		const matches = guild.channels.cache
			.filter(ch => ch.type === ChannelType.GuildText && ch.parentId === categoryId && ch.name === slug)
			.sort((a, b) => (a.rawPosition - b.rawPosition) || a.id.localeCompare(b.id));
		const first = matches.first();
		if (first) return first;
	}

	return null;
}

/**
 * Resolve a project group input to its Discord channel by matching
 * slugify(input) directly against channel names in the project group categories.
 * @param {import('discord.js').Guild} guild - The guild to search
 * @param {string} input - Project group channel name
 * @returns {Promise<Object>} { channel, slug, categoryIds }
 */
async function resolveProjectGroupChannel(guild, input) {
	const categoryIds = getProjectGroupCategoryIds();
	const slug = slugify(input);
	const channel = findChannelBySlug(guild, slug, categoryIds);
	return { channel, slug, categoryIds };
}

/**
 * Grant a member access to a project group channel (ViewChannel + SendMessages,
 * the same overwrite applied at channel creation).
 * @param {import('discord.js').TextChannel} channel - The project group channel
 * @param {string} userId - Discord user ID to grant access to
 * @returns {Promise<Object>} { status: 'added' | 'already' | 'failed', error? }
 */
async function addMemberToProjectGroup(channel, userId) {
	const existing = channel.permissionOverwrites.cache.get(userId);
	if (existing && existing.allow.has(PermissionFlagsBits.ViewChannel)) {
		return { status: 'already' };
	}

	try {
		await channel.permissionOverwrites.create(userId, {
			ViewChannel: true,
			SendMessages: true,
		});
		return { status: 'added' };
	}
	catch (error) {
		console.error(`[ProjectGroups] Failed to add ${userId} to #${channel.name}:`, error.message);
		return { status: 'failed', error: error.message };
	}
}

/**
 * Record a successful project group addition in the log channel.
 * Never throws — logging failures only hit the console.
 * @param {import('discord.js').Client} client - The bot client
 * @param {Object} details - { userId, channel, executorId, source }
 *   where source is 'command' | 'verification'
 */
async function logProjectGroupAddition(client, { userId, channel, executorId, source }) {
	try {
		const logChannelId = process.env.LOG_CHANNEL_ID;
		if (!logChannelId) {
			console.error('[ProjectGroups] LOG_CHANNEL_ID not set — skipping log message');
			return;
		}

		const logChannel = client.channels.cache.get(logChannelId)
			|| await client.channels.fetch(logChannelId).catch(() => null);
		if (!logChannel) {
			console.error('[ProjectGroups] Log channel not found — skipping log message');
			return;
		}

		const embed = new EmbedBuilder()
			.setColor(0x57F287)
			.setTitle('Project Group Member Added')
			.addFields(
				{ name: 'Member', value: `<@${userId}>`, inline: true },
				{ name: 'Channel', value: `<#${channel.id}>`, inline: true },
				{ name: 'Added By', value: `<@${executorId}>`, inline: true },
				{ name: 'Source', value: source === 'verification' ? '/verifyuser (post-verification)' : '/addtoprojectgroup', inline: false },
			)
			.setTimestamp();

		await logChannel.send({ embeds: [embed] });
	}
	catch (error) {
		console.error('[ProjectGroups] Could not send log message:', error);
	}
}

/**
 * Build autocomplete choices for a project group option from channel names
 * under the project group categories.
 * @param {import('discord.js').Guild} guild - The guild whose channels to list
 * @param {string} query - The focused option's current value
 * @returns {Promise<Array<{name: string, value: string}>>} Up to 25 choices
 */
async function getProjectGroupAutocompleteChoices(guild, query) {
	const categoryIds = getProjectGroupCategoryIds();

	const channelNames = guild.channels.cache
		.filter(ch => ch.type === ChannelType.GuildText && categoryIds.includes(ch.parentId))
		.map(ch => ch.name);

	const lowerQuery = (query || '').toLowerCase();
	const choices = channelNames
		.filter(name => !lowerQuery || name.toLowerCase().includes(lowerQuery))
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 25)
		.map(name => ({ name, value: name }));

	// Same empty-state sentinel convention as the region autocomplete in /verifyuser
	return choices.length > 0 ? choices : [{ name: 'No matching project groups found', value: 'none' }];
}

/**
 * Post-verification project group add used by all three /verifyuser terminal
 * paths (direct, continueVerification, nickname-conflict modal). NEVER throws —
 * verification must succeed even when the group add fails.
 * @param {import('discord.js').Client} client - The bot client
 * @param {import('discord.js').Guild} guild - The guild to search
 * @param {string} groupInput - Project group channel name
 * @param {string} userId - The verified member's Discord ID
 * @param {string} executorId - The verifier's Discord ID
 * @returns {Promise<Object>} { status: 'added'|'already'|'not-found'|'failed',
 *   channel, summary } — summary is ready for embeds/replies
 */
async function addVerifiedUserToProjectGroup(client, guild, groupInput, userId, executorId) {
	try {
		const resolution = await resolveProjectGroupChannel(guild, groupInput);

		if (!resolution.channel) {
			return {
				status: 'not-found',
				channel: null,
				summary: `⚠️ No matching channel found for \`${groupInput}\``,
			};
		}

		const addResult = await addMemberToProjectGroup(resolution.channel, userId);

		if (addResult.status === 'already') {
			return {
				status: 'already',
				channel: resolution.channel,
				summary: `ℹ️ Already had access to <#${resolution.channel.id}>`,
			};
		}

		if (addResult.status === 'failed') {
			return {
				status: 'failed',
				channel: resolution.channel,
				summary: `⚠️ Failed to add to <#${resolution.channel.id}>: ${addResult.error}`,
			};
		}

		await logProjectGroupAddition(client, {
			userId,
			channel: resolution.channel,
			executorId,
			source: 'verification',
		});

		return {
			status: 'added',
			channel: resolution.channel,
			summary: `✅ Added to <#${resolution.channel.id}>`,
		};
	}
	catch (error) {
		console.error('[ProjectGroups] Unexpected error adding verified user to project group:', error);
		return {
			status: 'failed',
			channel: null,
			summary: '⚠️ Project group add errored — see bot logs',
		};
	}
}

module.exports = {
	slugify,
	getProjectGroupCategoryIds,
	resolveProjectGroupChannel,
	addMemberToProjectGroup,
	logProjectGroupAddition,
	getProjectGroupAutocompleteChoices,
	addVerifiedUserToProjectGroup,
};
