// ─── Sheet constants ──────────────────────────────────────────────────────────

const SHEET_NAME       = 'Filters';
const SPREADSHEET_NAME = 'Gmail Filter Manager';

const COL_CRITERIA   = 1;
const COL_ACTIONS    = 2;
const COL_LAST_SYNCED = 3;
const HEADER_ROW     = ['Criteria', 'Actions', 'Last Synced'];
const DATA_START_ROW = 2;

// ─── Spreadsheet access ───────────────────────────────────────────────────────

/**
 * Returns the Gmail Filter Manager spreadsheet, creating it if it doesn't exist.
 * Caches the spreadsheet ID in PropertiesService so subsequent calls skip the
 * Drive search entirely.
 *
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getOrCreateSpreadsheet() {
  // 1. Fast path: ID already cached
  const cachedId = props.getProperty('spreadsheet:id');
  if (cachedId) {
    try {
      return SpreadsheetApp.openById(cachedId);
    } catch (e) {
      // File was deleted — clear cache and fall through
      props.deleteProperty('spreadsheet:id');
    }
  }

  // 2. Search Drive by name
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    const ss = SpreadsheetApp.openById(files.next().getId());
    props.setProperty('spreadsheet:id', ss.getId());
    return ss;
  }

  // 3. Create fresh
  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('spreadsheet:id', ss.getId());
  console.log(`Created spreadsheet: ${ss.getUrl()}`);
  return ss;
}

/**
 * Returns the Filters sheet, creating and formatting it if it doesn't exist.
 *
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet() {
  const ss    = getOrCreateSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    formatSheet(sheet);
  }

  return sheet;
}

/**
 * Applies header row, column widths, freeze, and checkbox columns to a fresh sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function formatSheet(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, HEADER_ROW.length);
  headerRange.setValues([HEADER_ROW]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f3f3');

  sheet.setColumnWidth(COL_CRITERIA,    400);
  sheet.setColumnWidth(COL_ACTIONS,     300);
  sheet.setColumnWidth(COL_LAST_SYNCED, 160);

  sheet.setFrozenRows(1);
}

// ─── Sheet read / write ───────────────────────────────────────────────────────

/**
 * Reads all filter rows from the sheet and returns them as an array of objects.
 *
 * @returns {Spreadsheet_Row[]}
 */
function readFiltersFromSheet() {
  const sheet   = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const numRows = lastRow - DATA_START_ROW + 1;
  const values  = sheet.getRange(DATA_START_ROW, 1, numRows, HEADER_ROW.length).getValues();

  return values
    .filter(row => String(row[COL_CRITERIA - 1]).trim().length > 0)
    .map(row => ({
      criteria:   String(row[COL_CRITERIA   - 1]).trim(),
      actions:    String(row[COL_ACTIONS    - 1]).trim(),
      lastSynced: String(row[COL_LAST_SYNCED - 1] || '').trim(),
    }));
}

/**
 * Appends a new filter row to the sheet.
 * Does nothing if a row with the same criteria string already exists.
 *
 * @param {string}  criteriaStr
 * @param {string}  actionsStr
 * @param {boolean} backfill
 * @returns {{ status: 'created'|'skipped'|'error', message: string }} 
 */
function writeFilterToSheet(criteriaStr, actionsStr, backfill) {
  if (filterExistsInSheet(criteriaStr)) {
    return {
      status: 'skipped',
      message: `  Sheet: "${criteriaStr}" already exists — skipping`
    }
  }

  const sheet    = getOrCreateSheet();
  const newRow   = sheet.getLastRow() + 1;
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();

  sheet.getRange(newRow, COL_CRITERIA).setValue(criteriaStr);
  sheet.getRange(newRow, COL_ACTIONS).setValue(actionsStr);
  sheet.getRange(newRow, COL_LAST_SYNCED).setValue(new Date().toLocaleString());

  return {
      status: 'created',
      message: `  Sheet: appended "${criteriaStr}" & "${actionsStr}"`
    }
}

/**
 * Updates the Last Synced timestamp for a given criteria row.
 *
 * @param {string} criteriaStr
 */
function markSyncedInSheet(criteriaStr) {
  const sheet   = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return;

  const criteriaCol = sheet.getRange(DATA_START_ROW, COL_CRITERIA, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < criteriaCol.length; i++) {
    if (String(criteriaCol[i][0]).trim() === criteriaStr) {
      sheet.getRange(DATA_START_ROW + i, COL_LAST_SYNCED).setValue(new Date().toLocaleString());
      return;
    }
  }
}

/**
 * Returns true if a row with the given criteria string already exists in the sheet.
 *
 * @param {string} criteriaStr
 * @returns {boolean}
 */
function filterExistsInSheet(criteriaStr) {
  console.warn('Bug alert — July 2026 | filterExistsInSheet only checks for a filter with a matching criteria string')
  const sheet   = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return false;

  const criteria = sheet
    .getRange(DATA_START_ROW, COL_CRITERIA, lastRow - DATA_START_ROW + 1, 1)
    .getValues()
    .flat()
    .map(c => String(c).trim().toLowerCase());

  return criteria.includes(criteriaStr.toLowerCase());
}

// ─── Other ────────────────────────────────────────────────────────────────────

/**
 * Reads every row from the sheet and ensures a matching Gmail label and filter
 * exists for each one. Safe to run repeatedly.
 * @param {Spreadsheet_Row[]}
 * @return {{ created: number, skipped: number, errors: number }}
 */
function syncSheetToGmail(rows) {
  const syncStatus = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  if (rows.length === 0) {
    console.log('No filter rows found in sheet. Add entries via the web app and run again.');
    return syncStatus;
  }

  for (const { criteria, actions } of rows) {
    try {
      const { status, message } = applyFilter(criteria, actions);
      let icon;
      if (status === 'created') {
        icon = '✅';
        syncStatus.created += 1;
      } else {
        icon = '⏭️';
        syncStatus.skipped += 1;
      }
      console.log(`${icon} ${criteria} ${actions} — ${message}`);
      markSyncedInSheet(criteria);
    } catch (e) {
      console.error(`❌ ${criteria} ${actions} : ${e.message}`);
      syncStatus.errors += 1;
    }
  }
  return syncStatus;
}