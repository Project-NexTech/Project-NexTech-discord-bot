const { PermissionFlagsBits } = require('discord.js');

/**
 * Check if user has required role or permissions
 * @param {GuildMember} member - Discord guild member
 * @param {string[]} roleNames - Array of allowed role names
 * @returns {boolean} Whether user has permission
 */
function hasRequiredRole(member, roleNames) {
	// Check if user is administrator
	if (member.permissions.has(PermissionFlagsBits.Administrator)) {
		return true;
	}

	// Check if user has any of the required roles
	return member.roles.cache.some(role => roleNames.includes(role.name));
}

/**
 * Get user's departments from their roles
 * @param {GuildMember} member - Discord guild member
 * @returns {string[]} Array of department names
 */
function getUserDepartments(member) {
	const departmentRoles = ['Education', 'Outreach', 'Marketing', 'Technology', 'Finance'];
	return member.roles.cache
		.filter(role => departmentRoles.includes(role.name))
		.map(role => role.name);
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDate(date) {
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/**
 * Format time for display
 * @param {string} time - Time string
 * @returns {string} Formatted time
 */
function formatTime(time) {
	// Assumes time is in format like "14:00" or "2:00 PM"
	return time;
}

/**
 * Create an embed for hours display
 * @param {Object} volunteerData - Volunteer hours data
 * @param {User} user - Discord user object
 * @returns {EmbedBuilder} Discord embed
 */
function createHoursEmbed(volunteerData, user) {
	const { EmbedBuilder } = require('discord.js');
	
	const embed = new EmbedBuilder()
		.setColor(0x00AE86)
		.setTitle(`📊 Hours Summary for ${volunteerData.name}`)
		.setThumbnail(user.displayAvatarURL())
		.addFields(
			{ name: '⏱️ Total Hours', value: `${volunteerData.totalHours} hours`, inline: true },
		)
		.setDescription('Keep up the great work! 🎉')
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Hours Tracker' });

	return embed;
}

/**
 * Create an embed for events display
 * @param {Array} events - Array of event objects
 * @param {string|null} department - Department filter
 * @param {number} currentPage - Current page number (1-indexed)
 * @param {number} totalPages - Total number of pages
 * @returns {EmbedBuilder} Discord embed
 */
function createEventsEmbed(events, department = null, currentPage = 1, totalPages = 1) {
	const { EmbedBuilder } = require('discord.js');
	
	let title = department && department !== 'all'
		? `Upcoming Events for ${department}`
		: 'All Upcoming Events';
	
	// Add page info to title if there are multiple pages
	if (totalPages > 1) {
		title += ` (Page ${currentPage}/${totalPages})`;
	}

	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(title)
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Events' });

	if (events.length === 0) {
		embed.setDescription('No upcoming events found.');
		return embed;
	}

	// Discord has a limit of 25 fields per embed
	// Each event takes 1 field, separators take 1 field each
	// So we can show max 13 events (13 events + 12 separators = 25 fields)
	// Note: The events array is already sliced to the correct page size by the caller

	// Create fields for each event (following the sheet's row order)
	events.forEach((event, idx) => {
		// Title: Date and Day of Week (with Undecided highlight)
		// Use separator and bold for emphasis
		let eventTitle = `📅 **${event.date}** - ${event.dayOfWeek}`;
		if (event.isUndecided) {
			eventTitle = `⚠️ **${event.date}** - ${event.dayOfWeek} **(UNDECIDED)**`;
		}

		// Build field value in the same order as the sheet
		let fieldValue = '';
		
		// Comment
		if (event.comment) {
			fieldValue += `💬 **Comment:** ${event.comment}\n`;
		}
		
		// Status
		if (event.status) {
			// Highlight "NO SIGNUPS" status with bold and warning emoji
			if (event.status === 'NO SIGNUPS') {
				fieldValue += `📊 **Status: ⚠️ NO SIGNUPS ⚠️**\n`;
			} else {
				fieldValue += `📊 **Status:** ${event.status}\n`;
			}
		}
		
		// Course Selection
		if (event.courseSelection) {
			fieldValue += `📚 **Course:** ${event.courseSelection}\n`;
		}
		
		// Region
		if (event.region) {
			fieldValue += `🌎 **Region:** ${event.region}\n`;
		}
		
		// Depart Time
		if (event.departTime) {
			fieldValue += `🕐 **Time:** ${event.departTime}\n`;
		}
		
		// Credit (hours)
		if (event.credit) {
			fieldValue += `⏱️ **Hours:** ${event.credit}\n`;
		}
		
		// Location
		if (event.location) {
			fieldValue += `📍 **Location:** ${event.location}\n`;
		}
		
		// Note
		if (event.note) {
			fieldValue += `📝 **Note:** ${event.note}\n`;
		}

		// Remove trailing newlines
		fieldValue = fieldValue.trim();

		if (!fieldValue) {
			fieldValue = 'No additional details available.';
		}

		// Add separator to the end of field value if this isn't the last event
		if (idx < events.length - 1) {
			fieldValue += '\n─────────────────────────────────';
		}

		embed.addFields({
			name: eventTitle,
			value: fieldValue,
			inline: false,
		});
	});

	return embed;
}

/**
 * Create an embed for contacts display
 * @param {Array} contacts - Array of contact objects
 * @param {string} department - Department name
 * @returns {EmbedBuilder} Discord embed
 */
function createContactsEmbed(contacts, department) {
	const { EmbedBuilder } = require('discord.js');

	const embed = new EmbedBuilder()
		.setColor(0xFEE75C)
		.setTitle(`${department} Leadership Contacts`)
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Leadership' });

	if (contacts.length === 0) {
		embed.setDescription('No contacts found for this department.');
		return embed;
	}

	// Create fields for each contact
	contacts.forEach(contact => {
		const fieldValue = 
			`**Role:** ${contact.role}\n` +
			`**Discord:** <@${contact.discordId}> (${contact.discordUsername})\n` +
			`**Email:** ${contact.email}`;
		
		embed.addFields({
			name: `👤 ${contact.name}`,
			value: fieldValue,
			inline: false,
		});
	});

	return embed;
}

/**
 * Create an embed for leaderboard display
 * @param {Array} leaderboard - Array of leaderboard entries
 * @returns {EmbedBuilder} Discord embed
 */
function createLeaderboardEmbed(leaderboard) {
	const { EmbedBuilder } = require('discord.js');
	
	const medals = ['🥇', '🥈', '🥉'];
	
	const embed = new EmbedBuilder()
		.setColor(0xFFD700)
		.setTitle('🏆 Hours Leaderboard')
		.setDescription('Top volunteers by total hours')
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Hours Tracker' });

	const leaderboardText = leaderboard
		.map((entry, idx) => {
			const medal = idx < 3 ? medals[idx] : `${idx + 1}.`;
			return `${medal} **${entry.name}** - ${entry.totalHours} hours`;
		})
		.join('\n');

	embed.addFields({ name: 'Rankings', value: leaderboardText });

	return embed;
}

module.exports = {
	hasRequiredRole,
	getUserDepartments,
	formatDate,
	formatTime,
	createHoursEmbed,
	createEventsEmbed,
	createContactsEmbed,
	createLeaderboardEmbed,
};
