#!/usr/bin/env node

/**
 * One-time utility: create a Discord channel for every project group in the
 * Project Group Tracker sheet, using the same logic as /createprojectgroup.
 *
 * Does not require the bot to be running. Uses utils/sheets.js for all sheet
 * reads and discord.js REST/Routes for Discord API calls.
 *
 * Usage:
 *   node create-all-project-groups.js            # live run against .env
 *   node create-all-project-groups.js --dry-run  # preview only, no Discord changes
 *   node create-all-project-groups.js --prod     # live run against prod.env
 *   node create-all-project-groups.js --prod --dry-run
 */

const path = require('node:path');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log('Usage: node create-all-project-groups.js [options]\n');
	console.log('Options:');
	console.log('  --dry-run    Preview only — no Discord or channel changes');
	console.log('  --prod       Load prod.env instead of .env');
	console.log('  --help, -h   Show this help message');
	process.exit(0);
}

const isProd = args.includes('--prod');
const isDryRun = args.includes('--dry-run');

// Load env the same way other utility scripts do (dotenv from __dirname)
require('dotenv').config({ path: path.join(__dirname, isProd ? 'prod.env' : '.env') });

const { REST, Routes, EmbedBuilder } = require('discord.js');
const sheetsManager = require('./utils/sheets');

// ── Exclusion lists ──────────────────────────────────────────────────────────
// Structural / non-group tabs, matched on title (case-insensitive exact match)
const TITLE_EXCLUSIONS = ['directory', 'template', 'form responses'];
// Groups that already have channels, matched on code (case-insensitive exact match)
const CODE_EXCLUSIONS = ['599', 'dnhs'];
// Raw B2 values containing any of these substrings are skipped (case-insensitive)
const NAME_EXCLUSION_SUBSTRINGS = ['milwaukee', 'francis parker', 'university of california'];

const INTER_GROUP_DELAY_MS = 1500;
const DRY_PREFIX = isDryRun ? '[DRY RUN] ' : '';

/**
 * Convert a display name into a valid Discord channel name (same rules as /createprojectgroup).
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
 * Split comma-separated cell values into a deduplicated, trimmed list of names.
 * @param {...string} cells - Raw cell strings
 * @returns {string[]} Deduplicated names
 */
function extractNames(...cells) {
	const out = [];
	const seen = new Set();
	for (const cell of cells) {
		for (const segment of String(cell).split(',')) {
			const name = segment.trim();
			if (name && !seen.has(name.toLowerCase())) {
				seen.add(name.toLowerCase());
				out.push(name);
			}
		}
	}
	return out;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
	const token = process.env.DISCORD_TOKEN;
	const guildId = process.env.GUILD_ID;
	const spreadsheetId = process.env.PROJECT_GROUP_TRACKER_SHEET_ID;
	const categoryId = process.env.PROJECT_GROUPS_CATEGORY_ID;
	const staffChatChannelId = process.env.STAFF_CHAT_CHANNEL_ID;

	// Validate required env
	const missing = [];
	if (!token) missing.push('DISCORD_TOKEN');
	if (!guildId) missing.push('GUILD_ID');
	if (!spreadsheetId) missing.push('PROJECT_GROUP_TRACKER_SHEET_ID');
	if (!isDryRun && !categoryId) missing.push('PROJECT_GROUPS_CATEGORY_ID');
	if (!isDryRun && !staffChatChannelId) missing.push('STAFF_CHAT_CHANNEL_ID');

	if (missing.length > 0) {
		console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
		process.exit(1);
	}

	console.log(`${DRY_PREFIX}Starting bulk project group channel creation (env: ${isProd ? 'prod.env' : '.env'})\n`);

	// Initialize Google Sheets
	try {
		await sheetsManager.initialize();
	}
	catch (error) {
		console.error(`❌ Failed to initialize Google Sheets: ${error.message}`);
		process.exit(1);
	}

	// ── Tab discovery ────────────────────────────────────────────────────────
	const meta = await sheetsManager.safeApiCall(
		() => sheetsManager.sheets.spreadsheets.get({
			spreadsheetId,
			fields: 'sheets.properties.title',
		}),
		'fetch tracker tab titles',
	);

	if (!meta || !meta.data || !meta.data.sheets) {
		console.error('❌ Failed to read tab titles from the Project Group Tracker. Check bot logs.');
		process.exit(1);
	}

	const allTitles = meta.data.sheets.map(s => s.properties.title);

	// Apply title + code exclusions
	const groupTitles = [];
	for (const title of allTitles) {
		const lower = title.toLowerCase();
		if (TITLE_EXCLUSIONS.includes(lower)) {
			continue; // structural tab, silently filtered
		}
		if (CODE_EXCLUSIONS.includes(lower)) {
			console.log(`⏭️  SKIPPED (already has channel): ${title}`);
			continue;
		}
		groupTitles.push(title);
	}

	// ── Discord REST + existing channel list ─────────────────────────────────
	const rest = new REST({ version: '10' }).setToken(token);

	let existingNames = new Set();
	try {
		const existingChannels = await rest.get(Routes.guildChannels(guildId));
		existingNames = new Set(existingChannels.map(c => String(c.name).toLowerCase()));
	}
	catch (error) {
		console.error(`❌ Failed to fetch existing guild channels: ${error.message}`);
		process.exit(1);
	}

	// ── Bulk sheet reads (minimise Google API calls) ──────────────────────────
	// Read B2/F3/E4 for EVERY group tab in a single batchGet instead of one call
	// per tab. valueRanges come back in the requested order (3 ranges per tab).
	const cellRanges = [];
	for (const title of groupTitles) {
		const escapedTitle = title.replace(/'/g, "''");
		cellRanges.push(`'${escapedTitle}'!B2`, `'${escapedTitle}'!F3`, `'${escapedTitle}'!E4`);
	}

	let trackerValueRanges = [];
	if (cellRanges.length > 0) {
		const trackerBatch = await sheetsManager.safeApiCall(
			() => sheetsManager.sheets.spreadsheets.values.batchGet({
				spreadsheetId,
				ranges: cellRanges,
			}),
			'batchGet all project group cells',
		);

		if (!trackerBatch || !trackerBatch.data) {
			console.error('❌ Failed to read project group cells from the tracker. Check bot logs.');
			process.exit(1);
		}
		trackerValueRanges = trackerBatch.data.valueRanges || [];
	}

	// Read the verification sheet ONCE and reuse the index for every group
	// (instead of re-reading both verification tabs for each group).
	const nameIndex = await sheetsManager.buildVerificationNameIndex();
	if (!nameIndex) {
		console.warn('⚠️  Could not read the verification sheet — all members will be reported as "not found".\n');
	}

	// ── Counters ─────────────────────────────────────────────────────────────
	let createdCount = 0;
	let alreadyExistedCount = 0;
	let skippedExcludedCount = 0;
	let failedCount = 0;
	let totalMembersAdded = 0;
	let totalNamesNotFound = 0;
	let totalOverwriteFailures = 0;
	const failedTabs = [];

	console.log(`\nProcessing ${groupTitles.length} project group tab(s)...\n`);

	// ── Per-group processing ─────────────────────────────────────────────────
	for (let g = 0; g < groupTitles.length; g++) {
		const title = groupTitles[g];
		const code = title;

		// Pull this group's B2/F3/E4 from the single batched read (3 ranges per tab)
		const base = g * 3;
		const cell = (offset) => {
			const vr = trackerValueRanges[base + offset];
			return (vr?.values?.[0]?.[0]) ? String(vr.values[0][0]) : '';
		};
		const rawB2 = cell(0);
		const f3 = cell(1);
		const e4 = cell(2);

		// 1. Name-based exclusion (checked against the raw B2 value)
		const lowerB2 = rawB2.toLowerCase();
		if (NAME_EXCLUSION_SUBSTRINGS.some(sub => lowerB2.includes(sub))) {
			console.log(`⏭️  ${DRY_PREFIX}SKIPPED (excluded name):  ${title} — "${rawB2}"`);
			skippedExcludedCount++;
			continue;
		}

		// 2. Comma truncation, then 3. slugification
		const truncated = rawB2.split(',')[0];
		const slugifiedName = slugify(truncated);

		if (!slugifiedName) {
			console.log(`❌  FAILED:  ${title} — "Empty or invalid channel name in B2 (\\"${rawB2}\\")"`);
			failedCount++;
			failedTabs.push(title);
			continue;
		}

		// Member extraction + resolution (in-memory, against the pre-built index)
		const rawNames = extractNames(f3, e4);
		const resolution = nameIndex ? sheetsManager.resolveNamesWithIndex(rawNames, nameIndex) : null;

		const allMatched = resolution ? resolution.matched : [];
		const unmatched = resolution ? resolution.unmatched : rawNames.slice();
		// Members whose verification row is red have left the server — skip overwrites for them
		const addable = allMatched.filter(m => !m.left);
		const leftMembers = allMatched.filter(m => m.left);

		// 5. Duplicate channel check
		if (existingNames.has(slugifiedName)) {
			console.log(`⚠️  ${DRY_PREFIX}SKIPPED (channel exists): #${slugifiedName}  (Code: ${code})`);
			alreadyExistedCount++;
			continue;
		}

		// 6. Channel creation + overwrites
		if (isDryRun) {
			printGroupResult({
				verb: 'WOULD CREATE',
				slugifiedName,
				code,
				added: addable,
				notFound: unmatched,
				leftMembers,
				overwriteFailures: [],
			});
			totalMembersAdded += addable.length;
			totalNamesNotFound += unmatched.length;
			createdCount++;
			// Reserve the name so duplicate detection works within this dry run too
			existingNames.add(slugifiedName);
			continue;
		}

		let channelId;
		try {
			const channel = await rest.post(Routes.guildChannels(guildId), {
				body: {
					name: slugifiedName,
					type: 0, // GUILD_TEXT
					parent_id: categoryId,
					// Discord copies the category's overwrites at creation time.
					// Do NOT sync permissions — they diverge once member overwrites are added.
				},
			});
			channelId = channel.id;
		}
		catch (error) {
			console.log(`❌  FAILED:  ${title} — "${error.message}"`);
			failedCount++;
			failedTabs.push(title);
			continue;
		}

		existingNames.add(slugifiedName);

		// Add per-user overwrites sequentially
		const addedMembers = [];
		const overwriteFailures = [];
		for (const member of addable) {
			try {
				await rest.put(Routes.channelPermission(channelId, member.discordId), {
					body: { allow: '3072', deny: '0', type: 1 }, // 3072 = ViewChannel + SendMessages, type 1 = member
				});
				addedMembers.push(member);
			}
			catch (error) {
				console.error(`   ↳ overwrite failed for ${member.name} (${member.discordId}): ${error.message}`);
				overwriteFailures.push(member.name);
			}
		}

		printGroupResult({
			verb: 'CREATED',
			slugifiedName,
			code,
			added: addedMembers,
			notFound: unmatched,
			leftMembers,
			overwriteFailures,
		});

		createdCount++;
		totalMembersAdded += addedMembers.length;
		totalNamesNotFound += unmatched.length;
		totalOverwriteFailures += overwriteFailures.length;

		// Inter-group delay to stay well within global rate limits
		await sleep(INTER_GROUP_DELAY_MS);
	}

	// ── Final summary ─────────────────────────────────────────────────────────
	const totalProcessed = groupTitles.length;
	console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log(`SUMMARY (dry run: ${isDryRun})`);
	console.log(`Total tabs processed: ${totalProcessed}`);
	console.log(`  ✅ Created:              ${createdCount}`);
	console.log(`  ⚠️  Already existed:      ${alreadyExistedCount}`);
	console.log(`  ⏭️  Skipped (excluded):   ${skippedExcludedCount}`);
	console.log(`  ❌ Failed:               ${failedCount}`);
	console.log('');
	console.log(`Members added (total):   ${totalMembersAdded}`);
	console.log(`Names not found (total): ${totalNamesNotFound}`);
	console.log(`Overwrite failures:      ${totalOverwriteFailures}`);
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

	// ── Staff chat notification (live mode only) ──────────────────────────────
	if (!isDryRun) {
		try {
			const embed = new EmbedBuilder()
				.setColor(failedCount > 0 ? 0xFEE75C : 0x57F287)
				.setTitle('Bulk Project Group Channel Creation')
				.addFields(
					{ name: 'Channels Created', value: String(createdCount), inline: true },
					{ name: 'Channels Already Existed', value: String(alreadyExistedCount), inline: true },
					{ name: 'Skipped (Excluded Names)', value: String(skippedExcludedCount), inline: true },
					{
						name: 'Failed',
						value: failedCount > 0 ? `${failedCount}\n${failedTabs.join(', ')}` : '0',
						inline: true,
					},
					{ name: 'Total Members Added', value: String(totalMembersAdded), inline: true },
					{ name: 'Names Not Found', value: String(totalNamesNotFound), inline: true },
					{ name: 'Run by', value: 'Manual script run (`create-all-project-groups.js`) — no bot command executor', inline: false },
				)
				.setTimestamp();

			await rest.post(Routes.channelMessages(staffChatChannelId), {
				body: { embeds: [embed.toJSON()] },
			});
			console.log('\n📨 Summary embed sent to staff chat.');
		}
		catch (error) {
			console.error(`\n⚠️  Could not send summary embed to staff chat: ${error.message}`);
		}
	}

	process.exit(0);
})().catch((error) => {
	console.error('\n❌ Unexpected error:', error);
	process.exit(1);
});

/**
 * Print the per-group result block.
 * @param {Object} info - Result info
 */
function printGroupResult(info) {
	const { verb, slugifiedName, code, added, notFound, leftMembers, overwriteFailures } = info;

	const addedStr = added.length > 0 ? added.map(m => `@${m.name}`).join(', ') : '(none)';
	const notFoundStr = notFound.length > 0 ? notFound.join(', ') : '(none)';
	const overwriteStr = overwriteFailures.length > 0 ? overwriteFailures.join(', ') : '(none)';

	console.log(`✅ ${DRY_PREFIX}${verb}:  #${slugifiedName}  (Code: ${code})`);
	console.log(`             Added: ${addedStr}`);
	console.log(`             Not found: ${notFoundStr}`);
	if (leftMembers && leftMembers.length > 0) {
		console.log(`             Left server (skipped): ${leftMembers.map(m => m.name).join(', ')}`);
	}
	console.log(`             Overwrite failures: ${overwriteStr}`);
}
