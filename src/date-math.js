/**
 * Date and clock-time helpers for a form-driven attendance system.
 *
 * Every function here exists because of a bug that reached a real approver's
 * inbox. The comments say which one. Pure, no Sheets dependency; the same file
 * runs under Node and pastes into Apps Script.
 */

/** True for Saturday and Sunday. */
function isWeekend_(d) {
  var day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Workdays between two dates, inclusive, weekends excluded.
 *
 * A Monday-to-Friday business never takes PTO on a weekend, so a request that
 * spans one (Thursday to Tuesday) must count only the weekdays inside it.
 * Making this the single source of truth means hour totals, cell painting,
 * conflict checks, and the undo path all inherit the rule. It replaced a note
 * on the form that asked people to split cross-week requests in two.
 *
 * Returns [] if the whole span is a weekend; the caller should treat that as a
 * zero-workday request and warn, not silently book zero hours.
 */
function getDateRange(startDate, endDate) {
  var out = [];
  var d = new Date(startDate);
  var end = new Date(endDate);
  d.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    if (!isWeekend_(d)) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Parse a date string as LOCAL midnight. `new Date('2026-04-20')` is UTC
 * midnight by spec, which is the previous evening anywhere west of Greenwich,
 * so a date-only ISO string shifts by a day. Append T00:00:00 to make it local.
 */
function parseLocalDate_(s) {
  if (!s) return null;
  if (s instanceof Date) return new Date(s);
  var str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00');
  return new Date(str);
}

/** "M/D/YY" */
function formatDate(d) {
  var date = (d instanceof Date) ? d : new Date(d);
  return (date.getMonth() + 1) + '/' + date.getDate() + '/' + String(date.getFullYear()).slice(-2);
}

/**
 * Hours and minutes of a Date as seen in a named timezone. In Apps Script this
 * is Utilities.formatDate(date, tz, 'H:m'); under Node, Intl does the same job.
 */
function clockPartsInTz_(date, tz) {
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    var hm = Utilities.formatDate(date, tz, 'H:m').split(':');
    return { h: parseInt(hm[0], 10), m: parseInt(hm[1], 10) };
  }
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(date);
  var h = 0, m = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === 'hour') h = parseInt(parts[i].value, 10) % 24;
    if (parts[i].type === 'minute') m = parseInt(parts[i].value, 10);
  }
  return { h: h, m: m };
}

/**
 * Minutes since midnight for a clock time, or null.
 *
 * Accepts "HH:MM", "H:MM AM/PM", or a Date. The Date branch matters: Sheets
 * coerces a time-looking string written through appendRow into a Date
 * anchored to 1899-12-30 in the SPREADSHEET's timezone, not the script's. When
 * the spreadsheet is set to Asia/Tokyo and the script runs America/Chicago, a
 * "2:10 PM" entry read back with getHours() is 23:10 the previous day, and
 * partial-day calendar events land at the wrong hour. Reading the wall-clock
 * time in the sheet's own timezone recovers what the person typed.
 *
 * Bare "2:10" with no AM/PM is treated as PM when the hour is 1 to 6, because
 * that is what a clinic employee leaving early means and what Sheets would
 * otherwise silently store as 02:10.
 */
function parseClockTime_(s, sheetTz) {
  if (s === null || s === undefined || s === '') return null;
  if (s instanceof Date) {
    var p = clockPartsInTz_(s, sheetTz || 'UTC');
    return p.h * 60 + p.m;
  }
  s = String(s).trim().toUpperCase();
  var m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var min = parseInt(m[2], 10);
  var ampm = m[3];
  if (ampm === 'PM' && h < 12) h += 12;
  else if (ampm === 'AM' && h === 12) h = 0;
  else if (!ampm && h >= 1 && h < 7) h += 12;
  return h * 60 + min;
}

/** "2:10pm", "5pm", "9:30am". Empty string for empty input; the raw string if unparseable. */
function formatClockTime_(v, sheetTz) {
  if (v === null || v === undefined || v === '') return '';
  var minutes = (typeof v === 'number') ? v : parseClockTime_(v, sheetTz);
  if (minutes === null) return (v instanceof Date) ? '' : String(v).trim();
  var h = Math.floor(minutes / 60), m = minutes % 60;
  var ampm = h >= 12 ? 'pm' : 'am';
  var hour12 = h % 12; if (hour12 === 0) hour12 = 12;
  return hour12 + (m === 0 ? '' : ':' + (m < 10 ? '0' + m : m)) + ampm;
}

/**
 * Turn an ambiguous form entry ("2:10", "12:30pm", "2:10 PM ") into an
 * unambiguous "H:MM AM/PM" string BEFORE it is written to a cell, so Sheets
 * coerces it the same way every time. Free text that does not parse ("in late
 * around 9:15 am, dentist") passes through unchanged rather than being destroyed.
 */
function canonicalizeTimeString_(v, sheetTz) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v;
  var minutes = parseClockTime_(v, sheetTz);
  if (minutes === null) return String(v).trim();
  var h = Math.floor(minutes / 60), m = minutes % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hour12 = h % 12; if (hour12 === 0) hour12 = 12;
  return hour12 + ':' + (m < 10 ? '0' + m : String(m)) + ' ' + ampm;
}

/**
 * Hours between two clock times, rounded UP to the next whole hour (35 minutes
 * is 1 hour, 1.25 hours is 2). That is the payroll rule the system was told to
 * follow; it replaced rounding to the nearest quarter hour. Falls back to a
 * full day (8) when either time is unparseable, so a bad entry over-counts
 * visibly rather than under-counting silently.
 */
function hoursBetween(leaveTime, returnTime, sheetTz, fullDayHours) {
  var l = parseClockTime_(leaveTime, sheetTz);
  var r = parseClockTime_(returnTime, sheetTz);
  if (l === null || r === null) return fullDayHours == null ? 8 : fullDayHours;
  var diff = (r - l) / 60;
  if (diff < 0) diff = 0;
  return Math.ceil(diff);
}

if (typeof module !== 'undefined') {
  module.exports = {
    isWeekend_: isWeekend_, getDateRange: getDateRange, parseLocalDate_: parseLocalDate_,
    formatDate: formatDate, parseClockTime_: parseClockTime_, formatClockTime_: formatClockTime_,
    canonicalizeTimeString_: canonicalizeTimeString_, hoursBetween: hoursBetween
  };
}
