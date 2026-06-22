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
	 * Wrapper for Google Sheets API calls with error handling
	 * Catches and logs API errors without crashing the bot
	 * @param {Function} apiCall - The API call function to execute
	 * @param {string} operationName - Name of the operation for logging
	 * @returns {Promise<any>} API response or null on error
	 */
	async safeApiCall(apiCall, operationName = 'API call') {
		try {
			return await apiCall();
		}
		catch (error) {
			console.error(`❌ Google Sheets API Error during ${operationName}:`);
			
			// Log error details
			if (error.code) {
				console.error(`Error Code: ${error.code}`);
			}
			if (error.message) {
				console.error(`Error Message: ${error.message}`);
			}
			
			// Log specific error types
			if (error.response) {
				console.error(`Response Status: ${error.response.status}`);
				if (error.response.data?.error) {
					console.error(`API Error Details:`, JSON.stringify(error.response.data.error, null, 2));
				}
			}
			
			// Log stack trace for debugging
			if (error.stack) {
				console.error(`Stack Trace:`, error.stack);
			}
			
			// Return null instead of throwing to prevent bot crashes
			return null;
		}
	}

	/**
	 * Get volunteer hours data for a specific Discord user
	 * @param {string} discordUserId - Discord user ID
	 * @returns {Promise<Object>} Volunteer data with hours and events
	 */
	async getVolunteerHours(discordUserId) {
		// Fetch private volunteer data from VOLUNTEERS_SHEET_ID (private sheet)
		// "Limited Data" tab - Columns: A (Name), B (Email 1), C (Email 2), E (Discord User ID)
		const privateSheetId = process.env.VOLUNTEERS_SHEET_ID;
		const privateResponse = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: privateSheetId,
				range: '\'Limited Data\'!A:E',
			}),
			'getVolunteerHours (fetch private data)',
		);

		if (!privateResponse || !privateResponse.data || !privateResponse.data.values) {
			console.error('❌ Failed to get private volunteer data from Google Sheets');
			return null;
		}

		const privateRows = privateResponse.data.values;
		if (privateRows.length === 0) {
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
		// "Tracker" tab - Columns: A (Name), K (Total Hours)
		const publicSheetId = process.env.EVENTS_SHEET_ID;
		const hoursResponse = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: publicSheetId,
				range: '\'Tracker\'!A:K',
			}),
			'getVolunteerHours (fetch hours data)',
		);

		if (!hoursResponse || !hoursResponse.data) {
			console.error('❌ Failed to get hours data from Google Sheets');
			// Return partial data without hours
			return {
				name: name,
				email: emails,
				discordId: discordUserId,
				totalHours: 0,
				events: [],
			};
		}

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

	/**
	 * Get recent hour verification requests for a user
	 * @param {string} discordUserId - Discord user ID
	 * @param {number} limit - Number of recent requests to return
	 * @returns {Promise<Object>} Object with name and array of recent requests
	 */
	async getHourVerificationRequests(discordUserId, limit = 10) {
		// First, get the user's full name from the volunteers sheet
		const privateSheetId = process.env.VOLUNTEERS_SHEET_ID;
		const privateResponse = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: privateSheetId,
				range: '\'Limited Data\'!A:E',
			}),
			'getHourVerificationRequests (fetch user name)',
		);

		if (!privateResponse || !privateResponse.data || !privateResponse.data.values) {
			console.error('❌ Failed to get volunteer data from Google Sheets');
			return null;
		}

		const privateRows = privateResponse.data.values;
		const volunteerRow = privateRows.slice(1).find(row => row[4] === discordUserId);
		if (!volunteerRow) {
			return null;
		}

		const userName = volunteerRow[0];

		// Fetch from "Hour Verification" sheet
		// Columns: A=Name, B=Hours, C=Verdict, D=Department, E=Date, H=Type, I=Description
		const eventsSheetId = process.env.EVENTS_SHEET_ID;
		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: eventsSheetId,
				range: '\'Hour Verification\'!A:I',
			}),
			'getHourVerificationRequests (fetch verification data)',
		);

		if (!response || !response.data || !response.data.values) {
			console.error('❌ Failed to get hour verification data from Google Sheets');
			return { name: userName, requests: [] };
		}

		const rows = response.data.values;
		// Skip rows 1 and 2 (header rows)
		if (rows.length <= 2) {
			return { name: userName, requests: [] };
		}

		// Find all requests for this user (case-insensitive name matching)
		const userRequests = [];
		for (let i = 2; i < rows.length; i++) {
			const row = rows[i];
			const rowName = row[0] ? row[0].trim() : '';
			
			if (rowName.toLowerCase() === userName.toLowerCase()) {
				userRequests.push({
					rowNumber: i + 1, // Store for sorting (1-indexed)
					hours: row[1] || 'N/A',
					verdict: row[2] || 'Pending',
					department: row[3] || 'N/A',
					date: row[4] || 'N/A',
					type: row[7] || 'N/A', // Column H = index 7
					description: row[8] || 'N/A', // Column I = index 8
				});
			}
		}

		// Sort by row number descending (most recent first)
		userRequests.sort((a, b) => b.rowNumber - a.rowNumber);

		// Return the most recent requests up to the limit
		return {
			name: userName,
			requests: userRequests.slice(0, limit),
		};
	}

	/**
	 * Normalize a confirmer/header name for column lookup
	 * @param {string} name
	 * @returns {string}
	 */
	normalizeConfirmerName(name) {
		return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
	}

	/**
	 * 0-based column index to A1 column letters (0 -> A)
	 * @param {number} columnIndex
	 * @returns {string}
	 */
	columnIndexToLetter(columnIndex) {
		let index = columnIndex + 1;
		let letters = '';

		while (index > 0) {
			const remainder = (index - 1) % 26;
			letters = String.fromCharCode(65 + remainder) + letters;
			index = Math.floor((index - 1) / 26);
		}

		return letters;
	}

	/**
	 * Read Hour Verification tab including confirmer header columns
	 * @returns {Promise<Object|null>}
	 */
	async fetchHourVerificationGrid() {
		const eventsSheetId = process.env.EVENTS_SHEET_ID;
		const sheetRange = process.env.HOUR_VERIFICATION_SHEET_RANGE || 'A1:ZZ';
		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: eventsSheetId,
				range: `'Hour Verification'!${sheetRange}`,
			}),
			'fetchHourVerificationGrid',
		);

		if (!response || !response.data) {
			return null;
		}

		const rows = response.data.values || [];
		const headerRowCount = this.getHourVerificationHeaderRowCount(rows);

		return {
			rows,
			headerRowCount,
			dateColumnIndex: this.resolveDateColumnIndex(rows, headerRowCount),
			confirmerColumnMap: this.buildConfirmerColumnMap(rows, headerRowCount),
		};
	}

	/**
	 * @param {Array<Array<string>>} rows
	 * @returns {number}
	 */
	getHourVerificationHeaderRowCount(rows) {
		const fromEnv = parseInt(process.env.HOUR_VERIFICATION_HEADER_ROWS, 10);
		if (!Number.isNaN(fromEnv) && fromEnv > 0) {
			return fromEnv;
		}
		return 2;
	}

	/**
	 * Normalize lookback days from env or caller
	 * @param {number|string} lookbackDays
	 * @returns {number}
	 */
	normalizeLookbackDays(lookbackDays) {
		const parsed = typeof lookbackDays === 'number'
			? lookbackDays
			: parseInt(lookbackDays, 10);

		if (!Number.isFinite(parsed) || parsed <= 0) {
			return 30;
		}

		return Math.floor(parsed);
	}

	/**
	 * Start of local calendar day for date comparisons
	 * @param {Date} date
	 * @returns {Date}
	 */
	toStartOfDay(date) {
		const day = new Date(date.getTime());
		day.setHours(0, 0, 0, 0);
		return day;
	}

	/**
	 * Whether a request date falls within the lookback window (inclusive)
	 * @param {Date} requestDate
	 * @param {number} lookbackDays
	 * @returns {boolean}
	 */
	isDateWithinLookback(requestDate, lookbackDays) {
		const effectiveLookback = this.normalizeLookbackDays(lookbackDays);
		const cutoff = this.toStartOfDay(new Date());
		cutoff.setDate(cutoff.getDate() - effectiveLookback);

		const requestDay = this.toStartOfDay(requestDate);
		return requestDay >= cutoff;
	}

	/**
	 * Find the column that holds each row's event/request date
	 * @param {Array<Array<string>>} rows
	 * @param {number} headerRowCount
	 * @returns {number} 0-based column index
	 */
	resolveDateColumnIndex(rows, headerRowCount) {
		const fromEnv = parseInt(process.env.HOUR_VERIFICATION_DATE_COLUMN, 10);
		if (!Number.isNaN(fromEnv) && fromEnv >= 0) {
			return fromEnv;
		}

		const headerRows = rows.slice(0, headerRowCount);
		const maxColumns = headerRows.reduce((max, row) => Math.max(max, row.length), 0);

		for (let col = 0; col < maxColumns; col++) {
			let label = '';
			for (const headerRow of headerRows) {
				const cell = headerRow[col] ? String(headerRow[col]).trim() : '';
				if (cell) {
					label = cell;
				}
			}

			const key = this.normalizeConfirmerName(label);
			if (key === 'date' || key === 'event date' || key === 'submission date') {
				return col;
			}
		}

		return 4; // Default column E
	}

	/**
	 * Map confirmer names (from header rows) to 0-based column indices
	 * @param {Array<Array<string>>} rows
	 * @param {number} headerRowCount
	 * @returns {Map<string, number>}
	 */
	buildConfirmerColumnMap(rows, headerRowCount) {
		const map = new Map();
		const headerRows = rows.slice(0, headerRowCount);
		if (headerRows.length === 0) {
			return map;
		}

		const maxColumns = headerRows.reduce((max, row) => Math.max(max, row.length), 0);

		for (let col = 0; col < maxColumns; col++) {
			let label = '';
			for (const headerRow of headerRows) {
				const cell = headerRow[col] ? String(headerRow[col]).trim() : '';
				if (cell) {
					label = cell;
				}
			}

			if (!label) {
				continue;
			}

			const key = this.normalizeConfirmerName(label);
			if (!key || map.has(key) || this.isReservedHourVerificationHeader(key)) {
				continue;
			}

			map.set(key, col);
		}

		return map;
	}

	/**
	 * Header labels that are not confirmer verdict columns
	 * @param {string} normalizedHeader
	 * @returns {boolean}
	 */
	isReservedHourVerificationHeader(normalizedHeader) {
		const reserved = new Set([
			'date',
			'event date',
			'submission date',
			'name',
			'hours',
			'hour',
			'department',
			'dept',
			'type',
			'description',
			'desc',
			'confirmer',
			'verdict',
			'status',
			'notes',
			'note',
		]);

		return reserved.has(normalizedHeader);
	}

	/**
	 * Alternate header keys for group-style confirmer assignments
	 * @param {string} normalizedConfirmer
	 * @returns {string[]}
	 */
	getConfirmerColumnSearchKeys(normalizedConfirmer) {
		const keys = [normalizedConfirmer];

		if (normalizedConfirmer.includes('ec/bd') || normalizedConfirmer.includes('ec / bd')) {
			keys.push(
				'anyone on the ec/bd',
				'anyone on ec/bd',
				'anyone on the ec / bd',
				'ec/bd',
				'ec / bd',
			);
		}
		else if (normalizedConfirmer.includes('anyone') && normalizedConfirmer.includes('ec')) {
			keys.push(
				'anyone on the ec',
				'anyone on ec',
				'ec',
			);
		}

		return [...new Set(keys)];
	}

	/**
	 * Fuzzy match group confirmer labels to sheet header columns
	 * @param {string} normalizedConfirmer
	 * @param {Map<string, number>} confirmerColumnMap
	 * @returns {number|null}
	 */
	findConfirmerColumnByFuzzyHeader(normalizedConfirmer, confirmerColumnMap) {
		if (normalizedConfirmer.includes('ec/bd') || normalizedConfirmer.includes('ec / bd')) {
			for (const [headerName, columnIndex] of confirmerColumnMap.entries()) {
				if (headerName.includes('ec') && headerName.includes('bd')) {
					return columnIndex;
				}
			}
		}

		if (normalizedConfirmer.includes('anyone') && normalizedConfirmer.includes('ec')) {
			for (const [headerName, columnIndex] of confirmerColumnMap.entries()) {
				if (headerName.includes('bd')) {
					continue;
				}
				if (headerName.includes('anyone') && headerName.includes('ec')) {
					return columnIndex;
				}
				if (headerName === 'ec' || headerName === 'anyone on the ec' || headerName === 'anyone on ec') {
					return columnIndex;
				}
			}
		}

		return null;
	}

	/**
	 * Find the sheet column for a confirmer's Approved/Changed/Denied cell
	 * @param {string} confirmerName
	 * @param {Map<string, number>} confirmerColumnMap
	 * @returns {number|null} 0-based column index
	 */
	resolveConfirmerColumnIndex(confirmerName, confirmerColumnMap) {
		const normalized = this.normalizeConfirmerName(confirmerName);
		if (!normalized) {
			return null;
		}

		for (const key of this.getConfirmerColumnSearchKeys(normalized)) {
			if (confirmerColumnMap.has(key)) {
				return confirmerColumnMap.get(key);
			}
		}
		const fuzzyMatch = this.findConfirmerColumnByFuzzyHeader(normalized, confirmerColumnMap);
		if (fuzzyMatch !== null) {
			return fuzzyMatch;
		}
		for (const [headerName, columnIndex] of confirmerColumnMap.entries()) {
			if (normalized.includes(headerName) || headerName.includes(normalized)) {
				return columnIndex;
			}
		}

		// return this.findConfirmerColumnByFuzzyHeader(normalized, confirmerColumnMap);
		return null;
	}

	/**
	 * Column index (0-based) where each row stores the assigned confirmer name
	 * @returns {number}
	 */
	getHourVerificationConfirmerFieldColumn() {
		const fromEnv = parseInt(process.env.HOUR_VERIFICATION_CONFIRMER_FIELD_COLUMN, 10);
		if (!Number.isNaN(fromEnv) && fromEnv >= 0) {
			return fromEnv;
		}
		return 5; // Column F
	}

	/**
	 * Get hour verification requests that are still awaiting approval
	 * @param {number} lookbackDays - Only include requests with a date within this many days (default 30)
	 * @returns {Promise<Object|null>} Object with array of pending requests, or null on sheet error
	 */
	async getNewHourVerificationRequests(lookbackDays = 30) {
		const grid = await this.fetchHourVerificationGrid();
		if (!grid) {
			console.error('❌ Failed to get hour verification data from Google Sheets');
			return null;
		}

		const { rows, headerRowCount, dateColumnIndex, confirmerColumnMap } = grid;
		if (rows.length <= headerRowCount) {
			return { requests: [] };
		}

		const effectiveLookback = this.normalizeLookbackDays(lookbackDays);
		const confirmerFieldColumn = this.getHourVerificationConfirmerFieldColumn();

		const pendingRequests = [];
		for (let i = headerRowCount; i < rows.length; i++) {
			const row = rows[i];
			const rowName = row[0] ? row[0].trim() : '';
			if (!rowName) {
				continue;
			}

			const dateValue = row[dateColumnIndex] ?? '';
			const parsedDate = this.parseHourVerificationDate(dateValue);
			if (!parsedDate) {
				continue;
			}
			if (!this.isDateWithinLookback(parsedDate, effectiveLookback)) {
				continue;
			}

			const confirmer = row[confirmerFieldColumn] ? String(row[confirmerFieldColumn]).trim() : '';
			if (!confirmer) {
				continue;
			}

			const confirmerColumnIndex = this.resolveConfirmerColumnIndex(confirmer, confirmerColumnMap);
			let confirmerStatus;
			
			if (confirmerColumnIndex !== null) {
				confirmerStatus = row[confirmerColumnIndex] ? String(row[confirmerColumnIndex]).trim() : '';
			}
			else {
				// If no specific column (e.g. group like "Anyone on the EC" or unrecognized), fallback to overall Verdict (Column C, index 2)
				confirmerStatus = row[2] ? String(row[2]).trim() : '';
				const sampleHeaders = [...confirmerColumnMap.keys()].slice(0, 12).join(', ');
				console.warn(
					`[HourVerification] Row ${i + 1}: no header column for "${confirmer}", falling back to overall Verdict.`,
				);
			}

			if (!this.isPendingConfirmerStatus(confirmerStatus)) {
				continue;
			}

			pendingRequests.push({
				rowNumber: i + 1,
				name: rowName,
				hours: row[1] || 'N/A',
				verdict: confirmerStatus || 'Pending',
				department: row[3] || 'N/A',
				confirmer,
				confirmerColumnIndex,
				date: dateValue || 'N/A',
				type: row[7] || 'N/A',
				description: row[8] || 'N/A',
			});
		}

		pendingRequests.sort((a, b) => b.rowNumber - a.rowNumber);

		console.log(
			`[HourVerification] Found ${pendingRequests.length} pending request(s) `
			+ `within ${effectiveLookback} day lookback (date column index ${dateColumnIndex})`,
		);

		return { requests: pendingRequests };
	}

	/**
	 * Whether a confirmer column cell still needs action
	 * @param {string} status - Raw cell value
	 * @returns {boolean}
	 */
	isPendingConfirmerStatus(status) {
		const normalized = (status || '').trim().toLowerCase();
		if (!normalized) {
			return true;
		}
		if (normalized === 'approved' || normalized === 'changed' || normalized === 'denied') {
			return false;
		}
		return normalized === 'pending' || normalized === 'unverified';
	}

	/**
	 * @param {number} rowNumber
	 * @param {number} confirmerColumnIndex
	 * @returns {Promise<boolean>}
	 */
	async isConfirmerRowPending(rowNumber, confirmerColumnIndex) {
		const grid = await this.fetchHourVerificationGrid();
		if (!grid) {
			return false;
		}

		const row = grid.rows[rowNumber - 1];
		if (!row) {
			return false;
		}

		const statusColumn = (confirmerColumnIndex !== null && confirmerColumnIndex !== undefined) ? confirmerColumnIndex : 2;
		const status = row[statusColumn] ? String(row[statusColumn]).trim() : '';
		return this.isPendingConfirmerStatus(status);
	}

	/**
	 * Parse a date cell from the Hour Verification sheet
	 * @param {string|number} dateValue - Raw cell value
	 * @returns {Date|null} Parsed date, or null if unparseable
	 */
	parseHourVerificationDate(dateValue) {
		if (dateValue === undefined || dateValue === null || dateValue === '') {
			return null;
		}

		if (typeof dateValue === 'number') {
			// Google Sheets serial date (days since 1899-12-30)
			const utcMs = (dateValue - 25569) * 86400 * 1000;
			const date = new Date(utcMs);
			return Number.isNaN(date.getTime()) ? null : date;
		}

		const parsed = Date.parse(String(dateValue).trim());
		if (Number.isNaN(parsed)) {
			return null;
		}
		return new Date(parsed);
	}

	/**
	 * Update the hours value (column B) for an hour verification row
	 * @param {number} rowNumber - 1-indexed sheet row number
	 * @param {number|string} hours - Hours to write
	 * @returns {Promise<boolean>} Success status
	 */
	async updateHourVerificationHours(rowNumber, hours) {
		const eventsSheetId = process.env.EVENTS_SHEET_ID;

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.update({
				spreadsheetId: eventsSheetId,
				range: `'Hour Verification'!B${rowNumber}`,
				valueInputOption: 'USER_ENTERED',
				resource: {
					values: [[hours]],
				},
			}),
			'updateHourVerificationHours',
		);

		return Boolean(response);
	}

	/**
	 * Set Approved / Changed / Denied in the confirmer's column for a row
	 * @param {number} rowNumber - 1-indexed sheet row number
	 * @param {number} confirmerColumnIndex - 0-based column under the confirmer header
	 * @param {string} status - Approved, Changed, or Denied
	 * @param {number|string|null} hours - If set, updates column B first
	 * @returns {Promise<boolean>} Success status
	 */
	async setConfirmerHourStatus(rowNumber, confirmerColumnIndex, status, hours = null, approverName = null) {
		if (hours !== null && hours !== undefined) {
			const hoursUpdated = await this.updateHourVerificationHours(rowNumber, hours);
			if (!hoursUpdated) {
				return false;
			}
		}

		let finalColumnIndex = confirmerColumnIndex;
		if (finalColumnIndex === null || finalColumnIndex === undefined) {
			const grid = await this.fetchHourVerificationGrid();
			if (grid && approverName) {
				finalColumnIndex = this.resolveConfirmerColumnIndex(approverName, grid.confirmerColumnMap);
			}
			if (finalColumnIndex === null || finalColumnIndex === undefined) {
				finalColumnIndex = 2; // Fallback to writing in the Verdict column (C)
			}
		}

		const eventsSheetId = process.env.EVENTS_SHEET_ID;
		const columnLetter = this.columnIndexToLetter(finalColumnIndex);

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.update({
				spreadsheetId: eventsSheetId,
				range: `'Hour Verification'!${columnLetter}${rowNumber}`,
				valueInputOption: 'USER_ENTERED',
				resource: {
					values: [[status]],
				},
			}),
			'setConfirmerHourStatus',
		);

		return Boolean(response);
	}

	/**
	 * Whether an Hour Verification verdict still needs approver action
	 * @param {string} verdict - Raw verdict cell value
	 * @returns {boolean}
	 */
	isPendingHourVerdict(verdict) {
		return this.isPendingConfirmerStatus(verdict);
	}

	/**
	 * Get upcoming events, optionally filtered by department
	 * Sheet is organized by COLUMNS (each column = one event date)
	 * Department mapping: 1=Engineering, 2=Mentoring, 3=Programming, 4=Physics/Math, 5=Natural Sciences
	 * @param {string|null} department - Department filter ('all' for all departments)
	 * @returns {Promise<Array>} List of upcoming events
	 */
	async getUpcomingEvents(department = null, maxDays = null) {
		const spreadsheetId = process.env.EVENTS_SHEET_ID;

		// Fetch data from "Signup Sheet" tab
		// Data is organized by columns, not rows
		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: '\'Signup Sheet\'!A1:ZZ11',
			}),
			'getUpcomingEvents',
		);

		if (!response || !response.data) {
			console.error('❌ Failed to get events data from Google Sheets');
			return [];
		}

		const rows = response.data.values || [];
		if (rows.length < 11) {
			return [];
		}

		const now = new Date();
		now.setHours(0, 0, 0, 0); // Set to start of day for comparison

		let maxDate = null;
		if (maxDays) {
			maxDate = new Date(now);
			maxDate.setDate(maxDate.getDate() + maxDays);
		}

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

			// Skip placeholder dates (exactly "Mon XX, XXXX")
			if (dateCell.trim().toLowerCase() === 'mon xx, xxxx') {
				continue;
			}

			// Validate and parse the date value
			const parsed = Date.parse(dateCell);
			if (Number.isNaN(parsed)) continue; // Skip cells that aren't valid dates
			const eventDate = new Date(parsed);
			if (eventDate < now) continue; // Skip past events
			if (maxDate && eventDate >= maxDate) continue; // Skip events beyond max days

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

	/**
	 * Get contact information for a department
	 * Sheet format: A=Name, B=Department, C=Email, D=Discord Username, E=Discord User ID, F=Role/Note
	 * @param {string} department - Department name to filter by
	 * @returns {Promise<Array>} List of contacts matching the department
	 */
	async getContacts(department) {
		const spreadsheetId = process.env.LEADERSHIP_SHEET_ID;

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: 'Sheet1!A:F', // Adjust sheet name if needed
			}),
			'getContacts',
		);

		if (!response || !response.data) {
			console.error('❌ Failed to get contacts data from Google Sheets');
			return [];
		}

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

	/**
	 * Get leadership contact by name
	 * @param {string} name - The name to search for
	 * @returns {Promise<Object|null>} The contact data or null if not found
	 */
	async getContactByName(name) {
		const spreadsheetId = process.env.LEADERSHIP_SHEET_ID;

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: 'Sheet1!A:F', // Adjust sheet name if needed
			}),
			'getContactByName',
		);

		if (!response || !response.data) {
			console.error('❌ Failed to get contacts data from Google Sheets for getContactByName');
			return null;
		}

		const rows = response.data.values || [];
		const normalizedSearchName = name.toLowerCase().trim();
		
		// Map data
		const contacts = rows.slice(1)
			.map(row => ({
				name: row[0] || 'Unknown',
				department: row[1] || '',
				email: row[2] || 'No email listed',
				discordUsername: row[3] || 'Unknown',
				discordId: row[4] || '',
				role: row[5] || 'Member',
			}));

		// Find contact by exact match (case-insensitive) or partial if exact fails
		const contact = contacts.find(c => c.name.toLowerCase().trim() === normalizedSearchName);
		
		if (contact && contact.discordId && contact.discordId.trim()) {
			return contact;
		}

		// Fallback: partial match
		const partialContact = contacts.find(c => normalizedSearchName.includes(c.name.toLowerCase().trim()));
		if (partialContact && partialContact.discordId && partialContact.discordId.trim()) {
			return partialContact;
		}

		return null;
	}

	/**
	 * Pick a leadership contact with Discord ID from a department list
	 * @param {Array} contacts
	 * @returns {Object|null}
	 */
	pickLeadershipContact(contacts) {
		const withDiscord = contacts.filter(contact => contact.discordId && contact.discordId.trim());
		if (withDiscord.length === 0) {
			return null;
		}

		const lead = withDiscord.find(contact => /lead/i.test(contact.role || ''));
		return lead || withDiscord[0];
	}

	/**
	 * Resolve who should receive the approval DM for a confirmer assignment
	 * @param {string} confirmerName - Value from the sheet (person or group label)
	 * @returns {Promise<Object|null>}
	 */
	async getApproverForConfirmer(confirmerName) {
		const normalized = this.normalizeConfirmerName(confirmerName);

		if (normalized.includes('ec/bd') || normalized.includes('ec / bd')) {
			const ecContact = this.pickLeadershipContact(await this.getContacts('EC'));
			if (ecContact) {
				return ecContact;
			}
		}

		if (normalized.includes('anyone') && normalized.includes('ec')) {
			const ecContact = this.pickLeadershipContact(await this.getContacts('EC'));
			if (ecContact) {
				return ecContact;
			}
		}

		return this.getContactByName(confirmerName);
	}

	/**
	 * Log hours request to Google Sheets
	 * @param {string} discordUserId - User's Discord ID
	 * @param {string} username - User's Discord username
	 * @param {string} details - Request details
	 * @returns {Promise<boolean>} Success status
	 */
	async logHoursRequest(discordUserId, username, details) {
		const spreadsheetId = process.env.REQUESTS_SHEET_ID;
		const timestamp = new Date().toISOString();

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.append({
				spreadsheetId,
				range: 'HoursRequests!A:D',
				valueInputOption: 'USER_ENTERED',
				resource: {
					values: [[timestamp, discordUserId, username, details]],
				},
			}),
			'logHoursRequest',
		);

		if (!response) {
			console.error('❌ Failed to log hours request to Google Sheets');
			return false;
		}

		return true;
	}

	/**
	 * Verify and log a new user
	 * @param {Object} userData - User verification data
	 * @returns {Promise<boolean>} Success status
	 */
	async verifyUser(userData) {
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

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.append({
				spreadsheetId,
				range: "'#nextech-verify'!A:J", // Sheet tab name with special character
				valueInputOption: 'USER_ENTERED',
				insertDataOption: 'INSERT_ROWS', // Explicitly insert new rows
				resource: { values },
			}),
			'verifyUser (append to sheet)',
		);

		if (!response) {
			console.error('❌ Failed to log verification to Google Sheets');
			return false;
		}

		const updatedRange = response?.data?.updates?.updatedRange;
		if (updatedRange) {
			console.log(`✅ Logged verification to range: ${updatedRange}`);
		}
		else {
			console.warn('⚠️ Verification append succeeded without updatedRange info.');
		}

		// If a custom nickname was supplied, attach it as a cell note on the Name cell (column B)
		if (userData.customNickname && updatedRange) {
			// updatedRange looks like "'#nextech-verify'!A42:J42" — pull the row number
			const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
			const rowNumber = rowMatch ? parseInt(rowMatch[1], 10) : null;

			if (rowNumber) {
				const sheetId = await this.getSheetId(spreadsheetId, '#nextech-verify');
				if (sheetId !== null) {
					await this.safeApiCall(
						() => this.sheets.spreadsheets.batchUpdate({
							spreadsheetId,
							resource: {
								requests: [{
									updateCells: {
										range: {
											sheetId,
											startRowIndex: rowNumber - 1,
											endRowIndex: rowNumber,
											startColumnIndex: 1, // Column B
											endColumnIndex: 2,
										},
										rows: [{ values: [{ note: `${userData.customNickname}` }] }],
										fields: 'note',
									},
								}],
							},
						}),
						'verifyUser (set custom nickname note)',
					);
				}
			}
			else {
				console.warn('⚠️ Could not parse row number from updatedRange; custom nickname note not written.');
			}
		}

		return true;
	}

	/**
	 * Get verification data for a specific Discord user
	 * @param {string} discordUserId - Discord user ID
	 * @returns {Promise<Object|null>} User verification data or null if not found
	 */
	async getVerificationData(discordUserId) {
		const spreadsheetId = process.env.VERIFICATION_SHEET_ID;

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: "'#nextech-verify'!A:J",
			}),
			'getVerificationData',
		);

		if (!response || !response.data || !response.data.values) {
			console.error('❌ Failed to get verification data from Google Sheets');
			return null;
		}

		const rows = response.data.values;
		if (rows.length === 0) {
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
	}

	/**
	 * Get hours leaderboard
	 * @param {number} limit - Maximum number of entries to return
	 * @returns {Promise<Array>} Leaderboard data
	 */
	async getHoursLeaderboard(limit = 10) {
		// Fetch from EVENTS_SHEET_ID (public sheet)
		// "Tracker" tab - Columns: A (Name), K (Total Hours)
		const publicSheetId = process.env.EVENTS_SHEET_ID;

		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: publicSheetId,
				range: '\'Tracker\'!A:K',
			}),
			'getHoursLeaderboard',
		);

		if (!response || !response.data) {
			console.error('❌ Failed to get leaderboard data from Google Sheets');
			return [];
		}

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

	/**
	 * Get membership status from Google Sheets
	 * Fetches data from "Membership Status" sheet (Column A=Name, B=Status)
	 * and matches with Discord IDs from "Limited Data" sheet (Column A=Name, E=Discord ID)
	 * @returns {Promise<Array>} Array of membership status objects
	 */
	async getMembershipStatus() {
		const eventsSheetId = process.env.EVENTS_SHEET_ID;
		const volunteersSheetId = process.env.VOLUNTEERS_SHEET_ID;

		// Fetch membership status (skip rows 1-9 which are headers)
		const membershipResponse = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: eventsSheetId,
				range: '\'Membership Status\'!A10:B',
			}),
			'getMembershipStatus (fetch membership data)',
		);

		if (!membershipResponse || !membershipResponse.data) {
			console.error('❌ Failed to get membership status from Google Sheets');
			return [];
		}

		const membershipRows = membershipResponse.data.values || [];

		// Fetch Discord IDs from volunteers sheet
		const volunteersResponse = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId: volunteersSheetId,
				range: '\'Limited Data\'!A:E',
			}),
			'getMembershipStatus (fetch volunteer IDs)',
		);

		if (!volunteersResponse || !volunteersResponse.data) {
			console.error('❌ Failed to get volunteer data from Google Sheets');
			return [];
		}

		const volunteersRows = volunteersResponse.data.values || [];

		// Create a map of name -> Discord ID
		// Use normalized names (lowercase, trimmed) as keys for case-insensitive matching
		const nameToDiscordId = {};
		const normalizedToOriginal = {}; // Track original names for debugging
		
		volunteersRows.slice(1).forEach((row) => {
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

	/**
	 * Check verification sheet for users who left the server and mark their rows
	 * @param {Guild} guild - Discord guild to check members against
	 * @returns {Promise<Object>} Result with counts of marked and unmarked users
	 */
	async checkLeftUsers(guild) {
		const spreadsheetId = process.env.VERIFICATION_SHEET_ID;
		const sheetName = "'#nextech-verify'";
		const sheetId = await this.getSheetId(spreadsheetId, '#nextech-verify');
		
		if (sheetId === null) {
			console.error('[CheckLeftUsers] Failed to get sheet ID');
			return { checked: 0, marked: 0 };
		}
		
		// Fetch all data from the verification sheet (values only)
		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.values.get({
				spreadsheetId,
				range: `${sheetName}!A:J`,
			}),
			'checkLeftUsers (fetch sheet data)',
		);

		if (!response || !response.data || !response.data.values) {
			console.error('[CheckLeftUsers] Failed to get verification data');
			return { checked: 0, marked: 0 };
		}

		const rows = response.data.values;
		if (rows.length <= 1) {
			console.log('[CheckLeftUsers] No data to check');
			return { checked: 0, marked: 0 };
		}

		// Fetch cell formatting to check existing backgrounds
		const sheetData = await this.safeApiCall(
			() => this.sheets.spreadsheets.get({
				spreadsheetId,
				ranges: [`${sheetName}!A:J`],
				includeGridData: true,
			}),
			'checkLeftUsers (fetch formatting data)',
		);

		if (!sheetData || !sheetData.data || !sheetData.data.sheets) {
			console.error('[CheckLeftUsers] Failed to get sheet formatting data');
			return { checked: 0, marked: 0 };
		}

		const gridData = sheetData.data.sheets[0].data[0].rowData;

		// Ensure member cache is populated
		console.log('[CheckLeftUsers] Checking member cache...');
		
		// Use existing cache if it's already populated from the ready event
		if (guild.members.cache.size > 0) {
			console.log(`[CheckLeftUsers] Using cached members (${guild.members.cache.size} in cache)`);
		}
		else {
			console.log('[CheckLeftUsers] Cache is empty - cannot verify members. Aborting to prevent false positives.');
			return { checked: 0, marked: 0, skipped: 0 };
		}
		
		const batchUpdates = [];
		let markedCount = 0;
		let unmarkedCount = 0;
		let skippedCount = 0;

		// Start from row 2 (index 1) to skip header
		for (let i = 1; i < rows.length; i++) {
			const row = rows[i];
			const discordId = row[0]; // Column A
			
			if (!discordId) continue;

			// Check if user is still in the server (check cache first, then fetch from API)
			let member = guild.members.cache.get(discordId);
			
			// If not in cache, try fetching from the API to avoid false positives
			// (new members may not be in cache yet)
			if (!member) {
				try {
					member = await guild.members.fetch(discordId);
				}
				catch {
					// fetch throws if member is not in the guild — member stays null
				}
			}

			// Helper: check if this row is currently marked red
			const rowData = gridData[i];
			let isMarkedRed = false;
			if (rowData && rowData.values && rowData.values[0]) {
				const cellFormat = rowData.values[0].effectiveFormat;
				const bgColor = cellFormat?.backgroundColor;
				
				if (bgColor && 
					Math.abs(bgColor.red - 0.956) < 0.01 && 
					Math.abs(bgColor.green - 0.8) < 0.01 && 
					Math.abs(bgColor.blue - 0.8) < 0.01) {
					isMarkedRed = true;
				}
			}
			
			if (!member) {
				// User is not in the server
				if (isMarkedRed) {
					skippedCount++;
					continue; // Already marked, nothing to do
				}

				// Mark the row with red background
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
			else if (isMarkedRed) {
				// User IS in the server but row is red — unmark it
				const rowNumber = i + 1;
				
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
									red: 1,
									green: 1,
									blue: 1,
								},
							},
						},
						fields: 'userEnteredFormat.backgroundColor',
					},
				});
				
				unmarkedCount++;
				console.log(`[CheckLeftUsers] Unmarked row ${rowNumber} - User ${discordId} is in the server`);
			}
		}

		// Apply all formatting updates in a single batch
		if (batchUpdates.length > 0) {
			const batchResult = await this.safeApiCall(
				() => this.sheets.spreadsheets.batchUpdate({
					spreadsheetId,
					resource: {
						requests: batchUpdates,
					},
				}),
				'checkLeftUsers (apply formatting updates)',
			);

			if (!batchResult) {
				console.error('[CheckLeftUsers] Failed to apply formatting updates');
				return { checked: rows.length - 1, marked: 0, unmarked: 0, skipped: skippedCount };
			}
		}

		console.log(`[CheckLeftUsers] Checked ${rows.length - 1} users, marked ${markedCount} as left, unmarked ${unmarkedCount}, skipped ${skippedCount} already marked`);
		return { checked: rows.length - 1, marked: markedCount, unmarked: unmarkedCount, skipped: skippedCount };
	}

	/**
	 * Get the sheet ID (gid) for a specific sheet name within a spreadsheet
	 * @param {string} spreadsheetId - The spreadsheet ID
	 * @param {string} sheetName - The name of the sheet/tab
	 * @returns {Promise<number|null>} The sheet ID or null on error
	 */
	async getSheetId(spreadsheetId, sheetName) {
		const response = await this.safeApiCall(
			() => this.sheets.spreadsheets.get({
				spreadsheetId,
			}),
			`getSheetId (sheet: "${sheetName}")`,
		);

		if (!response || !response.data || !response.data.sheets) {
			console.error(`[GetSheetId] Failed to get spreadsheet data for "${sheetName}"`);
			return null;
		}

		const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
		if (!sheet) {
			console.error(`[GetSheetId] Sheet "${sheetName}" not found in spreadsheet`);
			return null;
		}

		return sheet.properties.sheetId;
	}
}

module.exports = new SheetsManager();
