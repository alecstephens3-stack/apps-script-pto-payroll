/**
 * The bug: "Refresh All Totals" walked only tabs matching /^\d{4}$/. Once the
 * mid-year hires' data lived on anniversary tabs, the refresh recomputed zero
 * of their tabs and the balances never updated. The office manager's report
 * was "ran totals, did not update."
 *
 * The invariant: every tab a request DATE routes to on the write path must be
 * a tab the refresh path recomputes. This suite computes the write-path target
 * for realistic dates, checks the refresh predicate covers it, and runs the
 * OLD predicate over the same tabs to prove the test can fail on the broken
 * code. A test that cannot fail on the bug proves nothing.
 */
var t = require('./harness');
var P = require('../src/period-routing');
var D = t.D, eq = t.eq;
function writeTab(hire, date) { return P.periodForHire_(D(hire), D(date)).name; }
function oldPredicate(name) { return /^\d{4}$/.test(String(name).trim()); }

var HIRES = [
  { hire: '2025-08-22', dates: ['2026-01-12','2026-04-09','2026-08-21','2026-09-15','2026-12-19'] },
  { hire: '2025-08-12', dates: ['2026-03-01','2026-08-11','2026-08-12','2026-11-01'] },
  { hire: '2025-09-02', dates: ['2026-04-01','2026-09-01','2026-09-02','2026-10-15'] },
  { hire: '2025-09-08', dates: ['2026-03-16','2026-09-07','2026-09-08','2026-12-01'] },
  { hire: '2025-05-09', dates: ['2026-03-01','2026-05-08','2026-05-09','2026-06-19','2026-06-22','2026-07-02'] },
  { hire: '2026-03-04', dates: ['2026-06-01','2027-02-01','2027-06-01','2028-01-01'] },
  { hire: '2026-01-28', dates: ['2026-03-15','2026-12-31','2027-01-28'] }
];

var skippedByOld = {}, skippedByNew = {};
HIRES.forEach(function (e) {
  e.dates.forEach(function (d) {
    var tab = writeTab(e.hire, d);
    eq('hire ' + e.hire + ' ' + d + ' -> "' + tab + '" is recomputable', P.isRecomputableTab_(tab), true);
    if (!P.isRecomputableTab_(tab)) skippedByNew[tab] = true;
    if (!oldPredicate(tab)) skippedByOld[tab] = true;
  });
});
eq('OLD predicate reproduces the bug (skips at least one live period tab)', Object.keys(skippedByOld).length > 0, true);
eq('NEW predicate skips zero write-path tabs', Object.keys(skippedByNew).length, 0);

// The exact reported failure: three approvals in June and July 2026 for a 5/9/2025 hire.
['2026-06-19','2026-06-22','2026-07-02'].forEach(function (d) {
  var tab = writeTab('2025-05-09', d);
  eq(d + ' routes to the stub "5.9.26 to 12.31.26"', tab, '5.9.26 to 12.31.26');
  eq(d + ' was SKIPPED by the old predicate', oldPredicate(tab), false);
  eq(d + ' is INCLUDED by the new predicate', P.isRecomputableTab_(tab), true);
});

// The fix must not over- or under-match.
['2025','2026','2027','2028'].forEach(function (n) { eq('keeps calendar tab "' + n + '"', P.isRecomputableTab_(n), true); });
['8.22.26 to 12.31.26','9.8.26 to 12.31.26','5.9.25 to 5.8.26','1.28.26 to 1.27.27','3.4.27 to 12.31.27'].forEach(function (n) {
  eq('accepts period tab "' + n + '"', P.isRecomputableTab_(n), true);
});
['Roster','Archived Roster','Sheet1','Notes','Legend','Config','Calendar','',' ','RequestLog','2026 copy'].forEach(function (n) {
  eq('rejects non-attendance tab "' + n + '"', P.isRecomputableTab_(n), false);
});

t.report('recompute tab selection');
