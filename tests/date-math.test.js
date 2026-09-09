var t = require('./harness');
var M = require('../src/date-math');
var D = t.D, eq = t.eq;

// Weekend-spanning requests count weekdays only.
eq('Thu to Tue = 4 workdays',   M.getDateRange(D('2026-06-04'), D('2026-06-09')).length, 4);
eq('Sat to Sun = 0 workdays',   M.getDateRange(D('2026-06-06'), D('2026-06-07')).length, 0);
eq('single Wednesday = 1',      M.getDateRange(D('2026-06-03'), D('2026-06-03')).length, 1);
eq('Mon to Fri two weeks = 10', M.getDateRange(D('2026-06-01'), D('2026-06-12')).length, 10);

// Local, not UTC, midnight.
eq('ISO date parses to local midnight', M.parseLocalDate_('2026-04-20').getDate(), 20);
eq('ISO date hours are 0',              M.parseLocalDate_('2026-04-20').getHours(), 0);
eq('formatDate M/D/YY',                 M.formatDate(D('2026-04-20')), '4/20/26');

// Clock strings.
eq('"2:10 PM" = 850 min',        M.parseClockTime_('2:10 PM'), 850);
eq('"14:10" = 850 min',          M.parseClockTime_('14:10'), 850);
eq('bare "2:10" is PM',          M.parseClockTime_('2:10'), 850);
eq('bare "9:30" is AM',          M.parseClockTime_('9:30'), 570);
eq('"12:30 AM" = 30 min',        M.parseClockTime_('12:30 AM'), 30);
eq('"12:30pm" = 750 min',        M.parseClockTime_('12:30pm'), 750);
eq('free text -> null',          M.parseClockTime_('in late around 10 am'), null);

// Canonicalisation before the value reaches a cell.
eq('"2:10" -> "2:10 PM"',                 M.canonicalizeTimeString_('2:10'), '2:10 PM');
eq('"2:10 PM " -> "2:10 PM"',             M.canonicalizeTimeString_('2:10 PM '), '2:10 PM');
eq('"12:30pm" -> "12:30 PM"',             M.canonicalizeTimeString_('12:30pm'), '12:30 PM');
eq('free text passes through unchanged',  M.canonicalizeTimeString_('in late around 9:15 am, dentist'), 'in late around 9:15 am, dentist');
eq('empty -> empty',                      M.canonicalizeTimeString_(''), '');

// Display.
eq('850 -> "2:10pm"', M.formatClockTime_(850), '2:10pm');
eq('1020 -> "5pm"',   M.formatClockTime_(1020), '5pm');
eq('570 -> "9:30am"', M.formatClockTime_(570), '9:30am');

// Payroll rounding: up to the next whole hour.
eq('35 minutes = 1 hour',   M.hoursBetween('2:10 PM', '2:45 PM'), 1);
eq('1.25 hours = 2 hours',  M.hoursBetween('2:00 PM', '3:15 PM'), 2);
eq('exactly 3 hours = 3',   M.hoursBetween('2:00 PM', '5:00 PM'), 3);
eq('unparseable = full day', M.hoursBetween('soon', '5:00 PM'), 8);
eq('return before leave = 0', M.hoursBetween('5:00 PM', '2:00 PM'), 0);

// The timezone bug. A "2:10 PM" entry stored by a spreadsheet set to Asia/Tokyo
// is a Date at 1899-12-30 14:10 Tokyo time. Read in the script's zone
// (America/Chicago) it is 23:10 the previous day; read in the sheet's zone it
// is what the person typed.
var stored = new Date(Date.UTC(1899, 11, 30, 5, 10));            // 14:10 Tokyo == 05:10 UTC
eq('read in the sheet zone recovers 2:10 PM', M.parseClockTime_(stored, 'Asia/Tokyo'), 850);
eq('read in the script zone would be 23:10', M.parseClockTime_(stored, 'America/Chicago'), 23 * 60 + 10);
eq('display uses the sheet zone',            M.formatClockTime_(stored, 'Asia/Tokyo'), '2:10pm');

t.report('date and clock math');
