const { google } = require('googleapis');
const path = require('path');

class SheetsManager {
	constructor() {
		this.auth = null;
		this.sheets = null;
	}

	async initialize() {
		try {
			// Load credentials from service account key file
			const auth = new google.auth.GoogleAuth({
				keyFile: path.join(__dirname, '../credentials.json'),
				scopes: ['https://www.googleapis.com/auth/spreadsheets'],
			});

			this.auth = await auth.getClient();
			this.sheets = google.sheets({ version: 'v4', auth: this.auth });
			console.log('✅ Google Sheets API initialized');
		}
		catch (error) {
			console.error('❌ Failed to initialize Google Sheets API:', error.message);
			throw error;
		}
	}

	/**
	 * Get volunteer hours data for a specific Discord user
	 * @param {string} discordUserId - Discord user ID
	 * @returns {Promise<Object>} Volunteer data with hours and events
	 */
	async getVolunteerHours(discordUserId) {
		try {
			// Fetch private volunteer data from VOLUNTEERS_SHEET_ID (private sheet)
			// "Limited Data" tab - Columns: A (Name), B (Email 1), C (Email 2), E (Discord User ID)
			const privateSheetId = process.env.VOLUNTEERS_SHEET_ID;
			const privateResponse = await this.sheets.spreadsheets.values.get({
				spreadsheetId: privateSheetId,
				range: '\'Limited Data\'!A:E',
			});

			const privateRows = privateResponse.data.values;
			if (!privateRows || privateRows.length === 0) {
				return null;
			}

			// Find the volunteer by Discord ID (Column E)
			const volunteerRow = privateRows.slice(1).find(row => row[4] === discordUserId);
			if (!volunteerRow) {
				return null;
			}

			const name = volunteerRow[0];

			// Combine emails from columns B and C, filter out empty values
			const emails = [volunteerRow[1], volunteerRow[2]]
				.filter(email => email && email.trim())
				.join(', ');

			// Fetch public hours data from EVENTS_SHEET_ID (public sheet)
			// "Member Hours Tracker" tab - Columns: A (Name), K (Total Hours)
			const publicSheetId = process.env.EVENTS_SHEET_ID;
			const hoursResponse = await this.sheets.spreadsheets.values.get({
				spreadsheetId: publicSheetId,
				range: '\'Member Hours Tracker\'!A:K',
			});

			const hoursRows = hoursResponse.data.values || [];
			const hoursRow = hoursRows.slice(1).find(row => row[0] === name);
			const totalHours = hoursRow ? parseFloat(hoursRow[10]) || 0 : 0; // Column K = index 10

			// Parse volunteer data
			const volunteer = {
				name: name,
				email: emails,
				discordId: discordUserId,
				totalHours: totalHours,
				events: [],
			};

			// Note: Events sheet doesn't track individual volunteer participation
			// This would need to be tracked separately if needed
			volunteer.events = [];

			return volunteer;
		}
		catch (error) {
			console.error('Error fetching volunteer hours:', error);
			throw error;
		}
	}

	/**
	 * Get upcoming events, optionally filtered by department
	 * Note: Can also be retrieved from Google Calendar
	 * Sheet is organized by COLUMNS (each column = one event date)
	 * @param {string|null} department - Department filter
	 * @returns {Promise<Array>} List of upcoming events
	 */
	async getUpcomingEvents(department = null) {
		try {
			const spreadsheetId = process.env.EVENTS_SHEET_ID;

			// Fetch data from "San Diego Signups" tab
			// Data is organized by columns, not rows
			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: '\'San Diego Signups\'!A1:ZZ11',
			});

			const rows = response.data.values || [];
			if (rows.length < 11) {
				return [];
			}

			const now = new Date();
			now.setHours(0, 0, 0, 0); // Set to start of day for comparison

			// Each column represents an event
			const events = [];
			// Determine the maximum number of columns present within the first 11 rows
			const maxCols = Math.max(
				...rows.slice(0, 11).map(r => Array.isArray(r) ? r.length : 0),
			);

			for (let col = 0; col < maxCols; col++) {
				const dateCell = rows[0] && rows[0][col] ? String(rows[0][col]) : '';
				if (!dateCell.trim()) continue;

				// Validate and parse the date value
				const parsed = Date.parse(dateCell);
				if (Number.isNaN(parsed)) continue; // Skip cells that aren't valid dates
				const eventDate = new Date(parsed);
				if (eventDate < now) continue; // Skip past events

				const safe = (rowIndex) => (rows[rowIndex] && rows[rowIndex][col]) ? String(rows[rowIndex][col]) : '';

				const event = {
					date: dateCell,
					dayOfWeek: safe(1),
					comment: safe(2),
					numSignups: safe(3),
					department: safe(4),
					region: safe(5),
					time: safe(7), // Row 8: Time (row index 7)
					hours: safe(8), // Row 9: Hours (row index 8)
					location: safe(9), // Row 10: Location (row index 9)
					additionalNote: safe(10), // Row 11: Additional note (row index 10)
				};

				if (department && event.department.toLowerCase() !== department.toLowerCase()) {
					continue;
				}

				events.push(event);
			}

			return events;
		}
		catch (error) {
			console.error('Error fetching events:', error);
			throw error;
		}
	}

	/**
	 * Get contact information for a department or event
	 * @param {string|null} department - Department name
	 * @param {string|null} eventName - Event name
	 * @returns {Promise<Array>} List of contacts
	 */
	async getContacts(department = null, eventName = null) {
		try {
			const spreadsheetId = process.env.LEADERSHIP_SHEET_ID;

			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: 'Leadership!A:E',
			});

			const rows = response.data.values || [];
			let contacts = rows.slice(1).map(row => ({
				name: row[0],
				role: row[1],
				department: row[2],
				discordId: row[3],
				email: row[4],
			}));

			if (department) {
				contacts = contacts.filter(contact =>
					contact.department.toLowerCase() === department.toLowerCase(),
				);
			}

			if (eventName) {
				// For event-specific contacts, you might have a separate mapping
				// This is a placeholder - adjust based on your data structure
				const eventContactsResponse = await this.sheets.spreadsheets.values.get({
					spreadsheetId: process.env.EVENTS_SHEET_ID,
					range: 'EventContacts!A:D',
				});

				const eventRows = eventContactsResponse.data.values || [];
				// Discord IDs
				const eventContactIds = eventRows
					.filter(row => row[0].toLowerCase() === eventName.toLowerCase())
					.map(row => row[3]);

				contacts = contacts.filter(contact =>
					eventContactIds.includes(contact.discordId),
				);
			}

			return contacts;
		}
		catch (error) {
			console.error('Error fetching contacts - Leadership feature not yet implemented:', error.message);
			// Return empty array with special flag to indicate feature is not ready
			return { notImplemented: true, contacts: [] };
		}
	}

	/**
	 * Log hours request to Google Sheets
	 * @param {string} discordUserId - User's Discord ID
	 * @param {string} username - User's Discord username
	 * @param {string} details - Request details
	 * @returns {Promise<boolean>} Success status
	 */
	async logHoursRequest(discordUserId, username, details) {
		try {
			const spreadsheetId = process.env.REQUESTS_SHEET_ID;
			const timestamp = new Date().toISOString();

			await this.sheets.spreadsheets.values.append({
				spreadsheetId,
				range: 'HoursRequests!A:D',
				valueInputOption: 'USER_ENTERED',
				resource: {
					values: [[timestamp, discordUserId, username, details]],
				},
			});

			return true;
		}
		catch (error) {
			console.error('Error logging hours request:', error);
			throw error;
		}
	}

	/**
	 * Verify and log a new user
	 * @param {Object} userData - User verification data
	 * @returns {Promise<boolean>} Success status
	 */
	async verifyUser(userData) {
		try {
			const spreadsheetId = process.env.VERIFICATION_SHEET_ID;

			// Map the data to match your sheet's structure
			const values = [[
				userData.discordId, // Column A: Discord ID
				userData.name, // Column B: Name
				'', // Column C: (Empty)
				'', // Column D: (Empty)
				'', // Column E: (Empty)
				userData.grade || 'N/A', // Column F: Grade
				userData.school || 'N/A', // Column G: School
				userData.region || 'N/A', // Column H: Region
				userData.roboticsTeam || 'N/A', // Column I: Robotics Team
				userData.inviteSource || 'N/A', // Column J: Invite Source
			]];

			const response = await this.sheets.spreadsheets.values.append({
				spreadsheetId,
				range: "'#nextech-verify'!A:J", // Sheet tab name with special character
				valueInputOption: 'USER_ENTERED',
				insertDataOption: 'INSERT_ROWS', // Explicitly insert new rows
				resource: { values },
			});

			if (response?.data?.updates?.updatedRange) {
				console.log(`✅ Logged verification to range: ${response.data.updates.updatedRange}`);
			}
			else {
				console.warn('⚠️ Verification append succeeded without updatedRange info.');
			}

			return true;
		} 
		catch (error) {
			console.error('Error in verifyUser:', error);
			if (error.response) {
				console.error('Error details:', error.response.data);
			}
			return false;
		}
	}

	/**
	 * Get hours leaderboard
	 * @param {number} limit - Maximum number of entries to return
	 * @returns {Promise<Array>} Leaderboard data
	 */
	async getHoursLeaderboard(limit = 10) {
		try {
			// Fetch from EVENTS_SHEET_ID (public sheet)
			// "Member Hours Tracker" tab - Columns: A (Name), K (Total Hours)
			const publicSheetId = process.env.EVENTS_SHEET_ID;

			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId: publicSheetId,
				range: '\'Member Hours Tracker\'!A:K',
			});

			const rows = response.data.values || [];
			// Skip header
			const leaderboard = rows
				.slice(1)
				.map(row => ({
					name: row[0],
					totalHours: parseFloat(row[10]) || 0, // Column K = index 10
				}))
				.filter(entry => entry.totalHours > 0) // Only include people with hours
				.sort((a, b) => b.totalHours - a.totalHours)
				.slice(0, limit);

			return leaderboard;
		}
		catch (error) {
			console.error('Error fetching leaderboard:', error);
			throw error;
		}
	}
}

module.exports = new SheetsManager();
