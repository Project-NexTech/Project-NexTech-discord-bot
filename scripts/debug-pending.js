const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', 'test.env'), override: true });
const sheetsManager = require('../utils/sheets');

function loadNotifiedRows() {
	const notifiedFilePath = path.join(__dirname, '..', 'data', 'hour-approval-notified.json');
	try {
		if (fs.existsSync(notifiedFilePath)) {
			const data = JSON.parse(fs.readFileSync(notifiedFilePath, 'utf8'));
			return new Set(data.notifiedRowNumbers || []);
		}
	}
	catch (e) {
		console.error('Failed to load notified file', e);
	}
	return new Set();
}

(async () => {
	try {
		await sheetsManager.initialize();
		const result = await sheetsManager.getNewHourVerificationRequests(parseInt(process.env.HOUR_APPROVAL_LOOKBACK_DAYS, 10) || 30);
		if (!result) {
			console.error('No result from getNewHourVerificationRequests');
			process.exit(2);
		}

		const notified = loadNotifiedRows();
		console.log('Notified rows count =', notified.size);
		console.log('Pending requests count =', result.requests.length);
		for (const req of result.requests) {
			const approver = await sheetsManager.getApproverForConfirmer(req.confirmer);
			console.log(`Row ${req.rowNumber}: confirmer='${req.confirmer}', confirmerColumnIndex=${req.confirmerColumnIndex}, verdict='${req.verdict}', inNotified=${notified.has(req.rowNumber)}, approver=${approver ? approver.name + '|' + approver.discordId : 'NULL'}`);
		}
		process.exit(0);
	}
	catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
})();
