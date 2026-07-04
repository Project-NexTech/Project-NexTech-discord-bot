const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'test.env') });
const sheetsManager = require('../utils/sheets');

(async () => {
	try {
		await sheetsManager.initialize();

		const grid = await sheetsManager.fetchHourVerificationGrid();
		if (!grid) {
			console.error('Failed to fetch Hour Verification grid');
			process.exit(2);
		}

		const { rows, headerRowCount, dateColumnIndex, confirmerColumnMap } = grid;
		console.log('headerRowCount=', headerRowCount, 'dateColumnIndex=', dateColumnIndex);

		console.log('confirmerColumnMap keys (first 50):');
		let i = 0;
		for (const [k, v] of confirmerColumnMap.entries()) {
			console.log(`  [${v}] ${k}`);
			i++;
			if (i >= 50) break;
		}

		const targetRowNumber = 3109;
		const idx = targetRowNumber - 1;
		console.log(`rows.length = ${rows.length}`);
		if (idx < 0 || idx >= rows.length) {
			console.error(`Row ${targetRowNumber} is out of range`);
			process.exit(3);
		}

		const row = rows[idx];
		console.log(`\nRaw row ${targetRowNumber}:`, JSON.stringify(row));

		const confirmerFieldColumn = sheetsManager.getHourVerificationConfirmerFieldColumn();
		const confirmerValue = (row[confirmerFieldColumn] || '').toString().trim();
		const confirmerColumnIndex = sheetsManager.resolveConfirmerColumnIndex(confirmerValue, confirmerColumnMap);
		console.log('confirmerFieldColumn(index) =', confirmerFieldColumn, 'confirmerValue =', confirmerValue);
		console.log('confirmerColumnIndex =', confirmerColumnIndex);

		const overallVerdict = row[2] || '';
		console.log('overallVerdict (col C) =', overallVerdict);
		if (confirmerColumnIndex !== null) {
			console.log('confirmerColumnValue =', row[confirmerColumnIndex] || '');
		}
		else {
			console.log('No specific confirmer column found; fallback verdict used.');
		}

		process.exit(0);
	}
	catch (error) {
		console.error('Script error:', error);
		process.exit(1);
	}
})();
