# Apps Script PTO and Payroll

The routing, balance, and date logic behind a Google Sheets attendance system
that replaced a paper time-off process for a family-owned practice: **a request
lands on the right tab of the right employee's workbook, the balances on that
tab are always the truth, and a "2:10 PM" typed into a form comes back out as
2:10 PM.**

Those three sentences sound trivial and were not. Each one is a bug that
reached a real approver's inbox. This repo is the pure logic that fixes them,
with the reasoning written next to the code and a test suite made of the
regressions. It is derived from a system in daily use since April 2026 and
rebuilt generically with no client content: no names, no sheet IDs, no
workbook layout beyond the cell map the adapters expect.

```
src/period-routing.js     hire-anniversary periods, tab names, the collision guard
src/date-math.js          weekday ranges, local midnight, clock parsing in the sheet's timezone
src/recompute.js          balances recomputed from the painted grid, never counted
adapters/apps-script.gs   the Sheets-facing layer: hire date lookup, tab resolution with fallback
tests/                    183 assertions across 5 suites, most of them former production bugs
```

No dependencies. `src/*.js` runs under Node for the tests and pastes unchanged
into an Apps Script project (each file ends in a `module.exports` guard that
Apps Script ignores).

## The three problems

### 1. A first year of PTO is not a calendar year

The obvious design keeps one tab per calendar year and routes every request to
`String(year)`. That is right for long-tenured staff and wrong for anyone hired
mid-year: their first PTO year runs from the hire date to the day before the
first anniversary. Split across two calendar tabs, each tab carries its own
allotment and the balance double-counts. It was found on a real employee's
sheet, not in review.

`periodForHire_(hire, date)` is the single source of truth for the lifecycle:

```
year1     [hire, anniversary)              "8.22.25 to 8.21.26"   one tab, spans New Year
stub      [anniversary, Dec 31]            "8.22.26 to 12.31.26"  prorated allotment, entered by a person
calendar  Jan 1 to Dec 31, ever after      "2027"
```

Two properties made it safe to ship into a live system:

- **It degrades to the legacy behaviour.** Past the stub, every date resolves
  to the plain calendar-year name, byte-for-byte what the old code produced,
  so long-tenured employees never noticed a deploy.
- **The adapter falls back.** If the computed period tab does not exist yet,
  `resolvePeriodSheet_` writes to the calendar tab exactly as before. Routing
  could go live before any employee's tabs were rebuilt, and no live request
  could break.

The migration from calendar tabs to anniversary tabs copies day cells between
tabs, which is only safe if two source cells can never land on one destination
cell. The anniversary structure guarantees it (hire year contributes hire-day
to December, anniversary year contributes January to the day before the
anniversary, the shared month splits by day), and `planCellMoves_` **throws**
if dirty data ever breaks that guarantee rather than overwriting a balance.
The engine ran dry by default, copied without deleting, and a conservation
check (hours on the new tabs equal hours on the old) gated the cleanup.

The system stores, it does not compute. Allotments, proration, and carryover
are human judgments entered by the bookkeeper. The code's only job is to know
the hire date, build the right tabs, and route.

### 2. Balances are recomputed, never counted

Version one kept "hours used" as a counter: every approval did `used += hours`.
It drifted. A duplicate approval added twice, a hand edit to a day cell was
never subtracted, an undo did not always find what it had added. The counter
was a second copy of the truth, and second copies drift.

`recompute.js` treats the painted day grid as the only truth. Each day cell
holds the hours as its value and the leave type as its background colour, so
paid-used is the sum of cells in the paid colour set and unpaid-used the sum
over the unpaid set, recomputed after every write. Idempotent, and correct
after any edit including ones made by hand.

A `SUMBYBGCOLOR` custom function was the obvious alternative and cannot work
here: custom functions resolve only inside the spreadsheet that holds the
script, and every employee has their own workbook with no bound script. Every
one of them would show `#NAME?`.

**The invariant that bit anyway.** The refresh routine walked tabs matching
`/^\d{4}$/`. Once mid-year hires' data lived on anniversary tabs, the refresh
recomputed zero of their tabs and the office manager reported "ran totals, did
not update." `isRecomputableTab_` now accepts both tab shapes, and
`tests/recompute-tab-selection.test.js` asserts that every tab the write path
can route a date to is a tab the refresh path recomputes. The suite also runs
the old predicate over the same tabs and asserts it *fails*, because a
regression test that cannot fail on the bug proves nothing.

### 3. The spreadsheet and the script disagree about what time it is

A time typed into a form and written with `appendRow` is coerced by Sheets into
a `Date` anchored at 1899-12-30 in the **spreadsheet's** timezone. The script
runs in its own. When the workbook was set to Asia/Tokyo and the script to
America/Chicago, "2:10 PM" read back with `getHours()` was 23:10 the previous
day, and four employees' partial-day calendar events posted at the wrong hour.

`parseClockTime_(date, sheetTz)` reads the wall-clock time in the sheet's own
zone (`Utilities.formatDate` in Apps Script, `Intl` under Node) and recovers
what the person typed. `canonicalizeTimeString_` runs before the write so a
bare "2:10" becomes "2:10 PM" instead of being stored as 02:10, while free
text like "in late around 9:15, dentist" passes through untouched rather than
being destroyed.

Also in `date-math.js`: `getDateRange` counts weekdays only, so a Thursday to
Tuesday request books three days, not six, and replaced a note on the form
asking people to split cross-week requests in two; `parseLocalDate_` avoids
the `new Date('2026-04-20')` UTC-midnight trap; `hoursBetween` rounds up to the
whole hour because that is the payroll rule, and falls back to a full day on
unparseable input so a bad entry over-counts visibly instead of under-counting
silently.

## Two deployment lessons that are not in the code

- **`clasp push` updates HEAD. The web app runs its pinned deployment.** Form
  triggers and the sheet menu execute HEAD; the approve/deny links execute
  whatever version the deployment was last rolled to. Pushing a routing change
  without rolling the deployment gave a split-brain where triggers wrote to
  anniversary tabs and approvals looked for calendar tabs.
- **Manifest changes do not touch existing deployments.** `executeAs` and
  `access` in `appsscript.json` seed new deployments only; an existing one has
  to be edited in Manage Deployments. And a Workspace policy can block a script
  owned outside the organisation from writing to an org-shared calendar even
  when the executing user has edit rights. The fix was a calendar owned by an
  in-domain account, shared to the organisation.

## Running the tests

```bash
npm test
```

## Using it in Apps Script

1. Paste `src/period-routing.js`, `src/date-math.js`, `src/recompute.js`, and
   `adapters/apps-script.gs` into the bound project.
2. Define a `CELL_MAP` with `startDateCell`, the day-grid bounds
   (`firstMonthRow`, `lastMonthRow`, `firstDayCol`, `lastDayCol`), and
   `paidUsedRow` / `unpaidUsedRow`.
3. On every write: `groupDatesByPeriodTab_` to route, paint the cells, then
   `recomputeTabTotals_` on each touched tab. On undo, the same grouping, so
   write and reverse always target identical tabs.

## License

MIT.
