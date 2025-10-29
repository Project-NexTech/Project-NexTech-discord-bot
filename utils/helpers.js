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
 * @returns {EmbedBuilder} Discord embed
 */
function createEventsEmbed(events, department = null) {
	const { EmbedBuilder } = require('discord.js');
	
	const title = department 
		? `📅 Upcoming Events for ${department}`
		: '📅 All Upcoming Events';

	const embed = new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(title)
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Events' });

	if (events.length === 0) {
		embed.setDescription('No upcoming events found.');
		return embed;
	}

	const eventsText = events
		.map((event, idx) => {
			let text = `${idx + 1}. **${event.department}** - ${event.dayOfWeek}\n`;
			text += `   📅 ${event.date}${event.time ? ` at ${event.time}` : ''}\n`;
			text += `   📍 ${event.location}\n`;
			text += `   🕒 ${event.hours} hours\n`;
			text += `   🌎 ${event.region}`;
			if (event.comment) {
				text += `\n   💬 ${event.comment}`;
			}
			if (event.additionalNote) {
				text += `\n   📝 ${event.additionalNote}`;
			}
			return text;
		})
		.join('\n\n');

	embed.setDescription(eventsText);

	return embed;
}

/**
 * Create an embed for contacts display
 * @param {Array} contacts - Array of contact objects
 * @param {string|null} department - Department filter
 * @returns {EmbedBuilder} Discord embed
 */
function createContactsEmbed(contacts, department = null) {
	const { EmbedBuilder } = require('discord.js');
	
	const title = department 
		? `📞 Contacts for ${department}`
		: '📞 Leadership Contacts';

	const embed = new EmbedBuilder()
		.setColor(0xFEE75C)
		.setTitle(title)
		.setTimestamp()
		.setFooter({ text: 'Project NexTech Leadership' });

	if (contacts.length === 0) {
		embed.setDescription('No contacts found.');
		return embed;
	}

	const contactsText = contacts
		.map(contact =>
			`**${contact.name}** - ${contact.role}\n` +
			`<@${contact.discordId}> • ${contact.email || 'No email listed'}`,
		)
		.join('\n\n');

	embed.setDescription(contactsText);

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
