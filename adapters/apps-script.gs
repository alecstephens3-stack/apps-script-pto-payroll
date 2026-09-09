/**
 * Apps Script adapters around the pure modules in src/. Paste src/*.js and
 * this file into the bound project. Assumes a CELL_MAP that names where the
 * hire date, the day grid, and the two totals live on an attendance tab.
 */

// Per-execution cache. Apps Script resets globals each run, so it cannot go stale.
var _HIRE_DATE_CACHE_ = {};

/** The spreadsheet's timezone, which can differ from the script's. See parseClockTime_. */
function getSheetTz_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); }
  catch (e) { return Session.getScriptTimeZone(); }
}

/** A date-typed cell read in the sheet's timezone, so a date-only cell does not shift a day. */
function parseSheetDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return new Date(Utilities.formatDate(v, getSheetTz_(), 'yyyy-MM-dd') + 'T00:00:00');
  }
  var d = parseLocalDate_(String(v).trim());
  return (!d || isNaN(d.getTime())) ? null : atMidnight_(d);
}

/** Hire date from the first tab that has one, cached per workbook for the execution. */
function getEmployeeHireDate_(empSs) {
  var id = empSs.getId();
  if (_HIRE_DATE_CACHE_.hasOwnProperty(id)) return _HIRE_DATE_CACHE_[id];
  var hire = null, sheets = empSs.getSheets();
  for (var i = 0; i < sheets.length && !hire; i++) {
    hire = parseSheetDate_(sheets[i].getRange(CELL_MAP.startDateCell).getValue());
  }
  _HIRE_DATE_CACHE_[id] = hire;
  return hire;
}

/**
 * Resolve the Sheet a date should be written to, with a safe fallback:
 *   1. the computed period tab, if it exists
 *   2. else the plain calendar-year tab (legacy behaviour)
 *   3. else { sheet: null } so the caller raises a clear error
 * The fallback is what makes it safe to deploy the routing before every
 * employee's period tabs exist: a live request can never break, it lands where
 * it always did until the tabs are built.
 */
function resolvePeriodSheet_(empSs, date) {
  var wantName = resolvePeriodTabName_(getEmployeeHireDate_(empSs), date);
  var sheet = empSs.getSheetByName(wantName);
  if (sheet) return { sheet: sheet, name: wantName, fellBack: false };
  var calName = String(atMidnight_(date).getFullYear());
  if (calName !== wantName) {
    var calSheet = empSs.getSheetByName(calName);
    if (calSheet) return { sheet: calSheet, name: calName, fellBack: true };
  }
  return { sheet: null, name: wantName, fellBack: false };
}

/**
 * Group request dates by the tab each routes to. Shared by every write and
 * every reverse path so they always target identical tabs (write/undo symmetry).
 */
function groupDatesByPeriodTab_(empSs, dates) {
  var byTab = {};
  for (var i = 0; i < dates.length; i++) {
    var res = resolvePeriodSheet_(empSs, dates[i]);
    if (!res.sheet) throw new Error('No period tab for ' + formatDate(dates[i]) + ' (looked for "' + res.name + '"). Build the tab first.');
    if (!byTab[res.name]) byTab[res.name] = { sheet: res.sheet, name: res.name, dates: [] };
    byTab[res.name].dates.push(dates[i]);
  }
  return byTab;
}

/** Recompute the two totals on one tab from the painted grid. Idempotent. */
function recomputeTabTotals_(sheet, paidColors, unpaidColors) {
  var rng = sheet.getRange(CELL_MAP.firstMonthRow, CELL_MAP.firstDayCol,
    CELL_MAP.lastMonthRow - CELL_MAP.firstMonthRow + 1,
    CELL_MAP.lastDayCol - CELL_MAP.firstDayCol + 1);
  var t = recomputeUsedTotals_(rng.getValues(), rng.getBackgrounds(), paidColors, unpaidColors);
  sheet.getRange(CELL_MAP.paidUsedRow, 2).setValue(t.paid);
  sheet.getRange(CELL_MAP.unpaidUsedRow, 2).setValue(t.unpaid);
}

/** Refresh every attendance tab of one workbook. The predicate is the invariant; see isRecomputableTab_. */
function recomputeWorkbook_(empSs, paidColors, unpaidColors) {
  var sheets = empSs.getSheets(), touched = 0;
  for (var i = 0; i < sheets.length; i++) {
    if (!isRecomputableTab_(sheets[i].getName())) continue;
    recomputeTabTotals_(sheets[i], paidColors, unpaidColors);
    touched++;
  }
  return touched;
}
