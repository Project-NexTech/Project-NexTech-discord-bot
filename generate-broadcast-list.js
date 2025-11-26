#!/usr/bin/env node

/**
 * Generate broadcast-list.csv from a source CSV file
 * 
 * This script reads a CSV file and extracts names from column B (skipping the first 6 rows)
 * to create a broadcast-list.csv file that can be used with the /broadcast command.
 * 
 * Usage:
 *   node generate-broadcast-list.js <input-file.csv>
 * 
 * Example:
 *   node generate-broadcast-list.js my-member-list.csv
 */

const fs = require('fs');
const path = require('path');

// Get input file from command line argument
const args = process.argv.slice(2);

if (args.length === 0) {
	console.error('❌ Error: No input file specified');
	console.log('\nUsage: node generate-broadcast-list.js <input-file.csv>');
	console.log('Example: node generate-broadcast-list.js my-member-list.csv');
	process.exit(1);
}

const inputFile = args[0];
const outputFile = path.join(__dirname, 'data', 'broadcast-list.csv');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
	console.log('📁 Creating data directory...');
	fs.mkdirSync(dataDir, { recursive: true });
}

// Check if input file exists
if (!fs.existsSync(inputFile)) {
	console.error(`❌ Error: File not found: ${inputFile}`);
	process.exit(1);
}

// Read the input CSV file
console.log(`📖 Reading input file: ${inputFile}`);
let csvContent;
try {
	csvContent = fs.readFileSync(inputFile, 'utf8');
} catch (error) {
	console.error(`❌ Error reading file: ${error.message}`);
	process.exit(1);
}

// Parse CSV and extract names from column B (skipping first 6 rows)
const lines = csvContent.split('\n');
const names = [];

console.log(`📊 Processing CSV (skipping first 6 rows, reading column B)...`);

for (let i = 6; i < lines.length; i++) {
	const line = lines[i].trim();
	if (!line) continue;
	
	const columns = parseCSVLine(line);
	
	if (columns.length >= 2 && columns[1].trim()) {
		names.push(columns[1].trim());
	}
}

if (names.length === 0) {
	console.error('❌ Error: No names found in column B (after skipping first 6 rows)');
	process.exit(1);
}

console.log(`✅ Found ${names.length} names`);

// Create the output CSV
// Format: Simple CSV with header
const outputLines = [
	'Name',
	...names
];

const outputContent = outputLines.join('\n');

// Write the output file
try {
	fs.writeFileSync(outputFile, outputContent, 'utf8');
	console.log(`✅ Successfully created: ${outputFile}`);
	console.log(`\n📝 Summary:`);
	console.log(`   Input file:  ${inputFile}`);
	console.log(`   Output file: ${outputFile}`);
	console.log(`   Names:       ${names.length}`);
	console.log(`\n💡 You can now use /broadcast with the "Custom List (CSV)" option`);
} catch (error) {
	console.error(`❌ Error writing output file: ${error.message}`);
	process.exit(1);
}

/**
 * Parses a single CSV line, handling quoted values
 * @param {string} line - A single line from CSV
 * @returns {Array<string>} Array of column values
 */
function parseCSVLine(line) {
	const columns = [];
	let currentColumn = '';
	let inQuotes = false;
	
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				currentColumn += '"';
				i++; // Skip next quote
			} else {
				// Toggle quote state
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			// End of column
			columns.push(currentColumn);
			currentColumn = '';
		} else {
			currentColumn += char;
		}
	}
	
	// Add last column
	columns.push(currentColumn);
	
	return columns;
}
