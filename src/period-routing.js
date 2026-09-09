/**
 * Anniversary-aware period routing for a per-employee attendance workbook.
 *
 * The problem this solves: a naive PTO tracker keeps one tab per calendar year
 * and routes every request to String(year). That is correct for long-tenured
 * staff and wrong for anyone hired mid-year, because a first PTO year runs
 * hire date to the day before the first anniversary, not January to December.
 * Splitting that year across two calendar tabs gives each tab its own
 * allotment and the employee's balance double-counts.
 *
 * The lifecycle this module encodes:
 *   year1    : [hire, anniversary1)            one tab, spans the calendar boundary
 *   stub     : [anniversary1, Dec 31 of that year]
 *   calendar : Jan 1 to Dec 31, every year after the stub
 *
 * Tab-name convention: "8.22.25 to 8.21.26" (M.D.YY to M.D.YY) for year1 and
 * stub, "2027" for calendar years. The routing degrades to the legacy
 * behaviour: for an employee past the stub, every date resolves to the plain
 * calendar-year name, byte-for-byte what the old system produced.
 *
 * These functions are pure and have no Sheets dependency, so the same file
 * runs under Node for the test suite and pastes unchanged into an Apps Script
 * project. The Apps Script adapters (reading the hire date off a sheet,
 * resolving a Sheet object with a fallback) are in adapters/apps-script.gs.
 */

/** A new Date at LOCAL midnight for the given date's Y/M/D. */
function atMidnight_(d) {
  var x = (d instanceof Date) ? d : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

/** "M.D.YY", no zero padding, two-digit year. The tab-name date format. */
function tabDate_(d) {
  var x = atMidnight_(d);
  return (x.getMonth() + 1) + '.' + x.getDate() + '.' + String(x.getFullYear()).slice(-2);
}

/**
 * Given a hire date and an arbitrary date, return the period descriptor the
 * date belongs to. The single source of truth for the lifecycle.
 *
 * Returns { kind: 'year1' | 'stub' | 'calendar', name, baseYear, start, end }.
 *
 * Leap-day hires: new Date(y + 1, 1, 29) overflows to March 1, so a 2/29 hire
 * has its anniversary on 3/1 and year1 ends 2/28. The tests pin this down.
 */
function periodForHire_(hireDate, date) {
  var H = atMidnight_(hireDate);
  var D = atMidnight_(date);
  var anniv1 = new Date(H.getFullYear() + 1, H.getMonth(), H.getDate());

  if (D < anniv1) {
    var y1End = new Date(anniv1);
    y1End.setDate(y1End.getDate() - 1);
    return { kind: 'year1', name: tabDate_(H) + ' to ' + tabDate_(y1End),
             baseYear: H.getFullYear(), start: H, end: y1End };
  }

  var stubEnd = new Date(anniv1.getFullYear(), 11, 31);
  if (D <= stubEnd) {
    return { kind: 'stub', name: tabDate_(anniv1) + ' to ' + tabDate_(stubEnd),
             baseYear: anniv1.getFullYear(), start: anniv1, end: stubEnd };
  }

  return { kind: 'calendar', name: String(D.getFullYear()), baseYear: D.getFullYear(),
           start: new Date(D.getFullYear(), 0, 1), end: new Date(D.getFullYear(), 11, 31) };
}

/**
 * Every period an employee owns from hire through `throughYear`, in order:
 * year1, stub, then each calendar year. Used to build missing tabs.
 */
function periodsForHireThrough_(hireDate, throughYear) {
  var H = atMidnight_(hireDate);
  var anniv1 = new Date(H.getFullYear() + 1, H.getMonth(), H.getDate());
  var periods = [periodForHire_(H, H), periodForHire_(H, anniv1)];
  for (var y = anniv1.getFullYear() + 1; y <= throughYear; y++) {
    periods.push(periodForHire_(H, new Date(y, 5, 1)));
  }
  return periods;
}

/** The tab name a date routes to. No hire date known: legacy calendar-year name. */
function resolvePeriodTabName_(hireDate, date) {
  var d = atMidnight_(date);
  if (!hireDate) return String(d.getFullYear());
  return periodForHire_(hireDate, d).name;
}

/** A tab name that is exactly a four-digit year: a legacy calendar tab. */
function isCalendarYearTabName_(name) {
  return /^\d{4}$/.test(String(name).trim());
}

/**
 * True for any tab the totals recompute must walk: calendar-year tabs AND
 * anniversary period tabs. INVARIANT: every tab a request date can route to
 * through periodForHire_ must satisfy this predicate, or the write path and
 * the refresh path disagree and totals silently stop updating. That exact bug
 * shipped once; tests/recompute-tab-selection.test.js is its regression test.
 */
function isRecomputableTab_(tabName) {
  var n = String(tabName || '').trim();
  if (/^\d{4}$/.test(n)) return true;
  return /^\d{1,2}\.\d{1,2}\.\d{2} to \d{1,2}\.\d{1,2}\.\d{2}$/.test(n);
}

/** The calendar year an employee's stub ends in. Calendar tabs at or before it are stale after reconciliation. */
function stubEndYearForHire_(hire) {
  return atMidnight_(hire).getFullYear() + 1;
}

/**
 * Whether an employee still needs anniversary tabs at all. Long-tenured staff
 * are pure calendar-year and are left alone; anyone whose stub ended last year
 * or later is in scope. `today` is injectable for tests.
 */
function needsAnniversaryReconcile_(hire, today) {
  if (!hire) return false;
  var thisYear = (today ? atMidnight_(today) : new Date()).getFullYear();
  return stubEndYearForHire_(hire) >= (thisYear - 1);
}

/** Parse the leading "M/D/YY" or "M/D/YYYY" from an attendance log line, or null. */
function parseLeadingLogDate_(text) {
  var m = String(text).match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  var mo = parseInt(m[1], 10), da = parseInt(m[2], 10), yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  var d = new Date(yr, mo - 1, da);
  if (d.getMonth() !== mo - 1) return null;
  return d;
}

/**
 * Plan the move of every day cell on an employee's legacy calendar tabs onto
 * the anniversary tab it belongs to, and refuse to plan a move that would land
 * two source cells on the same destination cell.
 *
 * The anniversary structure guarantees no collision: the hire year contributes
 * hire-day through December, the anniversary year contributes January through
 * the day before the anniversary, and the shared hire month splits by day. If
 * a bad hire date or dirty data breaks that guarantee, this throws instead of
 * silently overwriting a balance. Returns { moves: [{from, month, day, to}], byTab }.
 */
function planCellMoves_(hireDate, sourceYears) {
  var hire = atMidnight_(hireDate);
  var seen = {}, moves = [], byTab = {};
  for (var s = 0; s < sourceYears.length; s++) {
    var yr = sourceYears[s];
    for (var mo = 0; mo < 12; mo++) {
      for (var da = 1; da <= 31; da++) {
        var date = new Date(yr, mo, da);
        if (date.getMonth() !== mo) continue;          // invalid day of month
        if (date < hire) continue;                      // nothing before hire
        var p = periodForHire_(hire, date);
        if (p.name === String(yr)) continue;            // already on the right tab
        var key = p.name + '|' + mo + '|' + da;
        if (seen[key]) {
          throw new Error('Cell collision on "' + p.name + '" for ' + (mo + 1) + '/' + da +
                          ': sources ' + seen[key] + ' and ' + yr);
        }
        seen[key] = yr;
        moves.push({ from: String(yr), month: mo + 1, day: da, to: p.name });
        byTab[p.name] = (byTab[p.name] || 0) + 1;
      }
    }
  }
  return { moves: moves, byTab: byTab };
}

if (typeof module !== 'undefined') {
  module.exports = {
    atMidnight_: atMidnight_, tabDate_: tabDate_, periodForHire_: periodForHire_,
    periodsForHireThrough_: periodsForHireThrough_, resolvePeriodTabName_: resolvePeriodTabName_,
    isCalendarYearTabName_: isCalendarYearTabName_, isRecomputableTab_: isRecomputableTab_,
    stubEndYearForHire_: stubEndYearForHire_, needsAnniversaryReconcile_: needsAnniversaryReconcile_,
    parseLeadingLogDate_: parseLeadingLogDate_, planCellMoves_: planCellMoves_
  };
}
