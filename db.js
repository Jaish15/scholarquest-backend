/* ============================================================
   ScholarQuest — JSON File DB Helper
   ============================================================
   This module abstracts file-based storage so that when you
   migrate to MongoDB, you only need to update this file.

   MongoDB Migration Steps (when ready):
   1. npm install mongoose
   2. Create models/ folder with User.js, Quiz.js, Habit.js
   3. Replace read/write calls here with mongoose model calls
   4. Update .env with MONGO_URI=mongodb://...
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

/**
 * Read a JSON data file
 * @param {string} filename - e.g. 'users' or 'quizzes'
 * @returns {Array|Object}
 */
function readDB(filename) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Write data to a JSON file
 * @param {string} filename - e.g. 'users' or 'quizzes'
 * @param {Array|Object} data
 */
function writeDB(filename, data) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readDB, writeDB };
