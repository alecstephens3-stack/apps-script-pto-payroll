/**
 * Routing correctness is the whole ballgame: wrong routing silently corrupts
 * balances, so it gets exhaustive assertions before anything is deployed.
 * Hire dates below are the shapes that broke or nearly broke in production
 * (mid-year, January 1, December 31, leap day, long-tenured), with the
 * employees anonymised.
 */
var t = require('./harness');
var P = require('../src/period-routing');
var D = t.D, eq = t.eq;
function route(hire, date) { return P.periodForHire_(D(hire), D(date)).name; }
function kind(hire, date)  { return P.periodForHire_(D(hire), D(date)).kind; }

// Employee A, hired 8/22/2025: the canonical double-count case.
// Year 1 = 8/22/25 to 8/21/26, ONE bucket spanning the calendar boundary.
eq('A 2025-10-07 year1 (hire-year side)',            route('2025-08-22','2025-10-07'), '8.22.25 to 8.21.26');
eq('A 2025-12-19 year1',                             route('2025-08-22','2025-12-19'), '8.22.25 to 8.21.26');
eq('A 2026-01-12 year1, NOT a new 2026 bucket',      route('2025-08-22','2026-01-12'), '8.22.25 to 8.21.26');
eq('A 2026-04-09 year1',                             route('2025-08-22','2026-04-09'), '8.22.25 to 8.21.26');
eq('A 2026-08-21 year1 last day',                    route('2025-08-22','2026-08-21'), '8.22.25 to 8.21.26');
eq('A 2026-08-22 stub first day',                    route('2025-08-22','2026-08-22'), '8.22.26 to 12.31.26');
eq('A 2026-12-19 stub',                              route('2025-08-22','2026-12-19'), '8.22.26 to 12.31.26');
eq('A 2026-12-31 stub last day',                     route('2025-08-22','2026-12-31'), '8.22.26 to 12.31.26');
eq('A 2027-01-01 calendar',                          route('2025-08-22','2027-01-01'), '2027');
eq('A kind 2026-04-09 = year1',                      kind('2025-08-22','2026-04-09'),  'year1');
eq('A kind 2026-09-15 = stub',                       kind('2025-08-22','2026-09-15'),  'stub');
eq('A kind 2027-06-01 = calendar',                   kind('2025-08-22','2027-06-01'),  'calendar');
eq('A full period list through 2027',
   P.periodsForHireThrough_(D('2025-08-22'), 2027).map(function (p) { return p.name; }).join(' | '),
   '8.22.25 to 8.21.26 | 8.22.26 to 12.31.26 | 2027');

// Employee B, hired 9/8/2025.
eq('B 2026-09-07 year1 last day', route('2025-09-08','2026-09-07'), '9.8.25 to 9.7.26');
eq('B 2026-09-08 stub first day', route('2025-09-08','2026-09-08'), '9.8.26 to 12.31.26');
eq('B 2026-03-16 year1',          route('2025-09-08','2026-03-16'), '9.8.25 to 9.7.26');

// Employee C, hired 3/4/2026: year1 crosses the calendar boundary into 2027.
eq('C 2026-03-04 year1 first day',            route('2026-03-04','2026-03-04'), '3.4.26 to 3.3.27');
eq('C 2026-12-31 year1, crosses calendar',    route('2026-03-04','2026-12-31'), '3.4.26 to 3.3.27');
eq('C 2027-02-10 year1, still pre-anniversary', route('2026-03-04','2027-02-10'), '3.4.26 to 3.3.27');
eq('C 2027-03-03 year1 last day',             route('2026-03-04','2027-03-03'), '3.4.26 to 3.3.27');
eq('C 2027-03-04 stub first day',             route('2026-03-04','2027-03-04'), '3.4.27 to 12.31.27');
eq('C 2028-01-01 calendar',                   route('2026-03-04','2028-01-01'), '2028');
eq('C period list through 2028',
   P.periodsForHireThrough_(D('2026-03-04'), 2028).map(function (p) { return p.name; }).join(' | '),
   '3.4.26 to 3.3.27 | 3.4.27 to 12.31.27 | 2028');

// Long-tenured (hired 2022): MUST be byte-identical to the legacy calendar-year behaviour.
eq('long-tenured 2026-04-09 = "2026"', route('2022-03-01','2026-04-09'), '2026');
eq('long-tenured 2027-01-01 = "2027"', route('2022-03-01','2027-01-01'), '2027');
eq('long-tenured 2025-12-31 = "2025"', route('2022-03-01','2025-12-31'), '2025');
eq('long-tenured kind = calendar',      kind('2022-03-01','2026-04-09'), 'calendar');
eq('no hire date known = legacy name',  P.resolvePeriodTabName_(null, D('2026-04-09')), '2026');

// Boundaries.
eq('Jan 1 hire year1 name',        route('2025-01-01','2025-06-15'), '1.1.25 to 12.31.25');
eq('Jan 1 hire anniversary = stub', route('2025-01-01','2026-01-01'), '1.1.26 to 12.31.26');
eq('Jan 1 hire calendar',          route('2025-01-01','2027-01-01'), '2027');
eq('Dec 31 hire year1',            route('2025-12-31','2026-06-15'), '12.31.25 to 12.30.26');
eq('Dec 31 hire stub is one day',  route('2025-12-31','2026-12-31'), '12.31.26 to 12.31.26');
// Leap-day hire 2/29/2024: the anniversary rolls to 3/1/2025 (Date overflow), year1 ends 2/28/2025.
eq('leap 2/29 hire year1 end',              route('2024-02-29','2024-06-01'), '2.29.24 to 2.28.25');
eq('leap 2/29 anniversary lands 3/1 (stub)', route('2024-02-29','2025-03-01'), '3.1.25 to 12.31.25');
eq('leap 2/29 day before anniversary = year1', route('2024-02-29','2025-02-28'), '2.29.24 to 2.28.25');

// A multi-day request straddling the anniversary must split across two tabs.
(function () {
  var hire = D('2025-08-22');
  var names = ['2026-08-20','2026-08-21','2026-08-24'].map(function (s) { return P.periodForHire_(hire, D(s)).name; });
  eq('span 8/20 -> year1', names[0], '8.22.25 to 8.21.26');
  eq('span 8/21 -> year1', names[1], '8.22.25 to 8.21.26');
  eq('span 8/24 -> stub',  names[2], '8.22.26 to 12.31.26');
})();

// August of year1 holds BOTH 8/22-31 of the hire year and 8/1-21 of the anniversary year:
// same grid row, different day columns, both route to year1.
eq('Aug 25 (hire-year tail) -> year1',     route('2025-08-22','2025-08-25'), '8.22.25 to 8.21.26');
eq('Aug 10 (anniversary-year head) -> year1', route('2025-08-22','2026-08-10'), '8.22.25 to 8.21.26');

t.report('period routing');
