/**
 * The migration from calendar tabs to anniversary tabs is only safe if no two
 * source cells can land on the same destination cell. planCellMoves_ encodes
 * that guarantee and throws if it is ever violated; this suite proves it holds
 * for the hire-date shapes that were actually migrated, and that the helper
 * predicates around the migration behave.
 */
var t = require('./harness');
var P = require('../src/period-routing');
var D = t.D, eq = t.eq;

// Source-tab detection.
eq('"2026" is a legacy source tab',    P.isCalendarYearTabName_('2026'), true);
eq('"2025" is a legacy source tab',    P.isCalendarYearTabName_('2025'), true);
eq('stub name is NOT a source tab',    P.isCalendarYearTabName_('8.22.26 to 12.31.26'), false);
eq('year1 name is NOT a source tab',   P.isCalendarYearTabName_('8.22.25 to 8.21.26'), false);

// Cleanup cutoffs: calendar tabs at or before the stub-end year are stale after migration.
eq('hire 2025-08-22 cutoff 2026', P.stubEndYearForHire_(D('2025-08-22')), 2026);
eq('hire 2025-05-09 cutoff 2026', P.stubEndYearForHire_(D('2025-05-09')), 2026);
eq('hire 2026-03-04 cutoff 2027', P.stubEndYearForHire_(D('2026-03-04')), 2027);
eq('hire 2026-01-28 cutoff 2027', P.stubEndYearForHire_(D('2026-01-28')), 2027);

// Scope: who needs anniversary tabs at all (today injected).
eq('recent hire is in scope',      P.needsAnniversaryReconcile_(D('2025-08-22'), D('2026-06-03')), true);
eq('last year stub still in scope', P.needsAnniversaryReconcile_(D('2024-03-01'), D('2026-06-03')), true);
eq('long-tenured is out of scope', P.needsAnniversaryReconcile_(D('2022-03-01'), D('2026-06-03')), false);
eq('no hire date is out of scope', P.needsAnniversaryReconcile_(null, D('2026-06-03')), false);

// Log-line date parsing (log lines start with the date the entry covers).
eq('parse "1/12/26 ..."',           P.tabDate_(P.parseLeadingLogDate_('1/12/26 8 HOURS UNPAID EXCUSED PTO. abc')), '1.12.26');
eq('parse "10/7/25 ..."',           P.tabDate_(P.parseLeadingLogDate_('10/7/25 note on file. 3 HOURS UNPAID EXCUSED PTO. xyz')), '10.7.25');
eq('parse multi-day "8/13/26-8/14/26"', P.tabDate_(P.parseLeadingLogDate_('8/13/26-8/14/26 full days, 8 HOURS UNPAID EXCUSED PTO. abc')), '8.13.26');
eq('non-date line -> null',         P.parseLeadingLogDate_('PAID PTO Used'), null);
eq('impossible date -> null',       P.parseLeadingLogDate_('2/30/26 nonsense'), null);

// THE COLLISION GUARANTEE, over the eight hire shapes that were migrated.
var HIRES = [
  { hire: '2025-08-22', sources: [2025, 2026] },
  { hire: '2025-08-12', sources: [2025, 2026] },
  { hire: '2025-09-02', sources: [2025, 2026] },
  { hire: '2025-09-08', sources: [2025, 2026] },
  { hire: '2025-05-09', sources: [2025, 2026] },
  { hire: '2026-03-04', sources: [2026, 2027] },
  { hire: '2026-01-28', sources: [2026] },
  { hire: '2026-01-28', sources: [2026] }
];
HIRES.forEach(function (e) {
  var plan = null, err = null;
  try { plan = P.planCellMoves_(D(e.hire), e.sources); } catch (x) { err = x.message; }
  eq('hire ' + e.hire + ': no cell collision', err, null);
  eq('hire ' + e.hire + ': moves only to period tabs', plan && plan.moves.every(function (m) { return !P.isCalendarYearTabName_(m.to); }), true);
});

// A specific plan, read closely: hire 8/22/2025 with 2025 and 2026 source tabs.
(function () {
  var plan = P.planCellMoves_(D('2025-08-22'), [2025, 2026]);
  eq('hire-year cells from 8/22 on move to year1',   plan.byTab['8.22.25 to 8.21.26'] > 0, true);
  eq('anniversary-year cells after 8/22 move to stub', plan.byTab['8.22.26 to 12.31.26'] > 0, true);
  eq('nothing moves to a calendar tab', Object.keys(plan.byTab).some(P.isCalendarYearTabName_), false);
  eq('year1 holds exactly 365 days', plan.byTab['8.22.25 to 8.21.26'], 365);
  eq('stub holds Aug 22 to Dec 31 = 132 days', plan.byTab['8.22.26 to 12.31.26'], 132);
})();

// The guard fires: an impossible hire date (after the source years) is not "no moves", it is caught upstream;
// here we prove the throw path itself by feeding a plan two overlapping sources.
(function () {
  var threw = false;
  try { P.planCellMoves_(D('2025-08-22'), [2025, 2025]); } catch (x) { threw = /collision/i.test(x.message); }
  eq('duplicate source years trip the collision guard', threw, true);
})();

// Spot-checks used during the migration.
eq('hire 2025-08-22, 1/12/2026 -> year1',                 P.periodForHire_(D('2025-08-22'), D('2026-01-12')).name, '8.22.25 to 8.21.26');
eq('hire 2025-05-09, 6/3/2026 (post-anniversary) -> stub', P.periodForHire_(D('2025-05-09'), D('2026-06-03')).name, '5.9.26 to 12.31.26');
eq('hire 2025-05-09, 3/1/2026 (pre-anniversary) -> year1', P.periodForHire_(D('2025-05-09'), D('2026-03-01')).name, '5.9.25 to 5.8.26');
eq('hire 2026-03-04, 2/1/2027 (stray next-year tab) -> year1', P.periodForHire_(D('2026-03-04'), D('2027-02-01')).name, '3.4.26 to 3.3.27');
eq('hire 2026-03-04, 6/1/2027 -> stub',                    P.periodForHire_(D('2026-03-04'), D('2027-06-01')).name, '3.4.27 to 12.31.27');

t.report('reconciliation');
