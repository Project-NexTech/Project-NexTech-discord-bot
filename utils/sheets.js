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
	 * Sheet is organized by COLUMNS (each column = one event date)
	 * Department mapping: 1=Engineering, 2=Mentoring, 3=Programming, 4=Physics/Math, 5=Natural Sciences
	 * @param {string|null} department - Department filter ('all' for all departments)
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

			// Department mapping from course number prefix
			const deptMapping = {
				'1': 'Engineering',
				'2': 'Mentoring',
				'3': 'Programming',
				'4': 'Physics/Math',
				'5': 'Natural Sciences',
			};

			// Each column represents an event
			const events = [];
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

				// Extract course selection and determine department
				const courseSelection = safe(4);
				let eventDepartment = 'Other';
				let isUndecided = false;

				if (courseSelection) {
					if (courseSelection === 'Undecided') {
						eventDepartment = 'Undecided';
						isUndecided = true;
					}
					else if (courseSelection !== 'Other') {
						// Extract first character before the period (e.g., "[1.1]" -> "1")
						const match = courseSelection.match(/^\[?(\d)/);
						if (match && deptMapping[match[1]]) {
							eventDepartment = deptMapping[match[1]];
						}
					}
				}

				// Filter logic
				if (department && department !== 'all') {
					// If specific department selected, exclude Undecided and Other
					if (isUndecided || eventDepartment === 'Other') {
						continue;
					}
					if (eventDepartment !== department) {
						continue;
					}
				}

				const event = {
					date: dateCell,
					dayOfWeek: safe(1),
					comment: safe(2),
					status: safe(3),
					courseSelection: courseSelection,
					department: eventDepartment,
					isUndecided: isUndecided,
					region: safe(5),
					supervisor: safe(6),
					departTime: safe(7),
					credit: safe(8),
					location: safe(9),
					note: safe(10),
				};

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
	 * Get contact information for a department
	 * Sheet format: A=Name, B=Department, C=Email, D=Discord Username, E=Discord User ID, F=Role/Note
	 * @param {string} department - Department name to filter by
	 * @returns {Promise<Array>} List of contacts matching the department
	 */
	async getContacts(department) {
		try {
			const spreadsheetId = process.env.LEADERSHIP_SHEET_ID;

			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: 'Sheet1!A:F', // Adjust sheet name if needed
			});

			const rows = response.data.values || [];
			
			// Skip header row and map data
			const contacts = rows.slice(1)
				.filter(row => row[1] && row[1].trim() === department) // Filter by department (Column B)
				.map(row => ({
					name: row[0] || 'Unknown',
					department: row[1] || '',
					email: row[2] || 'No email listed',
					discordUsername: row[3] || 'Unknown',
					discordId: row[4] || '',
					role: row[5] || 'Member',
				}));

			return contacts;
		}
		catch (error) {
			console.error('Error fetching contacts:', error.message);
			throw error;
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
	 * Get verification data for a specific Discord user
	 * @param {string} discordUserId - Discord user ID
	 * @returns {Promise<Object|null>} User verification data or null if not found
	 */
	async getVerificationData(discordUserId) {
		try {
			const spreadsheetId = process.env.VERIFICATION_SHEET_ID;

			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: "'#nextech-verify'!A:J",
			});

			const rows = response.data.values;
			if (!rows || rows.length === 0) {
				return null;
			}

			// Find the user by Discord ID (Column A)
			// Skip header row (index 0)
			const userRow = rows.slice(1).find(row => row[0] === discordUserId);
			if (!userRow) {
				return null;
			}

			return {
				discordId: userRow[0],
				name: userRow[1] || '',
				grade: userRow[5] || 'N/A',
				school: userRow[6] || 'N/A',
				region: userRow[7] || 'N/A',
				roboticsTeam: userRow[8] || 'N/A',
				inviteSource: userRow[9] || 'N/A',
			};
		} catch (error) {
			console.error('Error in getVerificationData:', error);
			return null;
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

	/**
	 * Get membership status from Google Sheets
	 * Fetches data from "Membership Status" sheet (Column A=Name, B=Status)
	 * and matches with Discord IDs from "Limited Data" sheet (Column A=Name, E=Discord ID)
	 * @returns {Promise<Array>} Array of membership status objects
	 */
	async getMembershipStatus() {
		try {
			const eventsSheetId = process.env.EVENTS_SHEET_ID;
			const volunteersSheetId = process.env.VOLUNTEERS_SHEET_ID;

			// Fetch membership status (skip rows 1-9 which are headers)
			const membershipResponse = await this.sheets.spreadsheets.values.get({
				spreadsheetId: eventsSheetId,
				range: '\'Membership Status\'!A10:B',
			});

			const membershipRows = membershipResponse.data.values || [];

			// Fetch Discord IDs from volunteers sheet
			const volunteersResponse = await this.sheets.spreadsheets.values.get({
				spreadsheetId: volunteersSheetId,
				range: '\'Limited Data\'!A:E',
			});

			const volunteersRows = volunteersResponse.data.values || [];

			// Create a map of name -> Discord ID
			// Use normalized names (lowercase, trimmed) as keys for case-insensitive matching
			const nameToDiscordId = {};
			const normalizedToOriginal = {}; // Track original names for debugging
			
			volunteersRows.slice(1).forEach((row, index) => {
				const name = row[0];
				const discordId = row[4];
				
				if (name && discordId) {
					// Trim and normalize the name, also normalize apostrophes
					const trimmedName = name.trim();
					const normalizedName = trimmedName.toLowerCase();
					
					nameToDiscordId[normalizedName] = discordId.trim();
					normalizedToOriginal[normalizedName] = trimmedName;
					
					// Also store variants with different apostrophe types for better matching
					if (normalizedName.includes("'") || normalizedName.includes("'")) {
						const withRegularApostrophe = normalizedName.replace(/['']/g, "'");
						const withSmartApostrophe = normalizedName.replace(/'/g, "'");
						
						if (withRegularApostrophe !== normalizedName) {
							nameToDiscordId[withRegularApostrophe] = discordId.trim();
							normalizedToOriginal[withRegularApostrophe] = trimmedName;
						}
						if (withSmartApostrophe !== normalizedName) {
							nameToDiscordId[withSmartApostrophe] = discordId.trim();
							normalizedToOriginal[withSmartApostrophe] = trimmedName;
						}
					}
				}
			});

			// Helper function for fuzzy name matching
			const findBestMatch = (searchName) => {
				const normalized = searchName.toLowerCase().trim();
				
				// 1. Try exact match first
				if (nameToDiscordId[normalized]) {
					return nameToDiscordId[normalized];
				}
				
				// 2. Try matching with different apostrophe types
				const withRegularApostrophe = normalized.replace(/['']/g, "'");
				const withSmartApostrophe = normalized.replace(/'/g, "'");
				
				if (nameToDiscordId[withRegularApostrophe]) {
					return nameToDiscordId[withRegularApostrophe];
				}
				if (nameToDiscordId[withSmartApostrophe]) {
					return nameToDiscordId[withSmartApostrophe];
				}
				
				// 3. Try matching where volunteer name contains the membership name
				// (e.g., "Mark Blair" matches "Mark Nelson Blair")
				const containsMatch = Object.keys(nameToDiscordId).find(key => {
					const keyParts = key.split(' ').filter(p => p.length > 0);
					const searchParts = normalized.split(' ').filter(p => p.length > 0);
					
					// Check if all parts of search name appear in key (in order)
					let keyIndex = 0;
					for (const searchPart of searchParts) {
						let found = false;
						for (let i = keyIndex; i < keyParts.length; i++) {
							if (keyParts[i] === searchPart) {
								keyIndex = i + 1;
								found = true;
								break;
							}
						}
						if (!found) return false;
					}
					return true;
				});
				
				if (containsMatch) {
					return nameToDiscordId[containsMatch];
				}
				
				return null;
			};

			// Build membership data array
			const membershipData = membershipRows
				.filter(row => row[0]) // Filter out empty rows
				.map(row => {
					const name = row[0].trim();
					const status = row[1] ? row[1].trim() : null;
					const discordId = findBestMatch(name);

					return {
						name,
						status,
						discordId,
					};
				});

			return membershipData;
		}
		catch (error) {
			console.error('Error fetching membership status:', error);
			throw error;
		}
	}

	/**
	 * Check verification sheet for users who left the server and mark their rows
	 * @param {Guild} guild - Discord guild to check members against
	 * @returns {Promise<Object>} Result with counts of marked users
	 */
	async checkLeftUsers(guild) {
		try {
			const spreadsheetId = process.env.VERIFICATION_SHEET_ID;
			const sheetName = "'#nextech-verify'";
			const sheetId = await this.getSheetId(spreadsheetId, '#nextech-verify');
			
			// Fetch all data from the verification sheet (values only)
			const response = await this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: `${sheetName}!A:J`,
			});

			const rows = response.data.values;
			if (!rows || rows.length <= 1) {
				console.log('[CheckLeftUsers] No data to check');
				return { checked: 0, marked: 0 };
			}

			// Fetch cell formatting to check existing backgrounds
			const sheetData = await this.sheets.spreadsheets.get({
				spreadsheetId,
				ranges: [`${sheetName}!A:J`],
				includeGridData: true,
			});

			const gridData = sheetData.data.sheets[0].data[0].rowData;

			// Fetch all guild members
			await guild.members.fetch();
			
			const batchUpdates = [];
			let markedCount = 0;
			let skippedCount = 0;

			// Start from row 2 (index 1) to skip header
			for (let i = 1; i < rows.length; i++) {
				const row = rows[i];
				const discordId = row[0]; // Column A
				
				if (!discordId) continue;

				// Check if user is still in the server
				const member = guild.members.cache.get(discordId);
				
				if (!member) {
					// Check if row already has red background
					const rowData = gridData[i];
					if (rowData && rowData.values && rowData.values[0]) {
						const cellFormat = rowData.values[0].effectiveFormat;
						const bgColor = cellFormat?.backgroundColor;
						
						// Check if already marked red (allow small tolerance for floating point)
						if (bgColor && 
							Math.abs(bgColor.red - 0.956) < 0.01 && 
							Math.abs(bgColor.green - 0.8) < 0.01 && 
							Math.abs(bgColor.blue - 0.8) < 0.01) {
							skippedCount++;
							continue; // Skip this row, already marked
						}
					}

					// User left - mark the row with red background
					const rowNumber = i + 1; // Sheet rows are 1-indexed
					
					batchUpdates.push({
						repeatCell: {
							range: {
								sheetId: sheetId,
								startRowIndex: i,
								endRowIndex: i + 1,
								startColumnIndex: 0,
								endColumnIndex: 10, // Columns A-J
							},
							cell: {
								userEnteredFormat: {
									backgroundColor: {
										red: 0.956,
										green: 0.8,
										blue: 0.8,
									},
								},
							},
							fields: 'userEnteredFormat.backgroundColor',
						},
					});
					
					markedCount++;
					console.log(`[CheckLeftUsers] Marked row ${rowNumber} - User ${discordId} left the server`);
				}
			}

			// Apply all formatting updates in a single batch
			if (batchUpdates.length > 0) {
				await this.sheets.spreadsheets.batchUpdate({
					spreadsheetId,
					resource: {
						requests: batchUpdates,
					},
				});
			}

			console.log(`[CheckLeftUsers] Checked ${rows.length - 1} users, marked ${markedCount} as left, skipped ${skippedCount} already marked`);
			return { checked: rows.length - 1, marked: markedCount, skipped: skippedCount };
		}
		catch (error) {
			console.error('[CheckLeftUsers] Error:', error);
			throw error;
		}
	}

	/**
	 * Get the sheet ID (gid) for a specific sheet name within a spreadsheet
	 * @param {string} spreadsheetId - The spreadsheet ID
	 * @param {string} sheetName - The name of the sheet/tab
	 * @returns {Promise<number>} The sheet ID
	 */
	async getSheetId(spreadsheetId, sheetName) {
		try {
			const response = await this.sheets.spreadsheets.get({
				spreadsheetId,
			});

			const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
			if (!sheet) {
				throw new Error(`Sheet "${sheetName}" not found`);
			}

			return sheet.properties.sheetId;
		}
		catch (error) {
			console.error(`[GetSheetId] Error finding sheet "${sheetName}":`, error);
			throw error;
		}
	}
}

module.exports = new SheetsManager();
