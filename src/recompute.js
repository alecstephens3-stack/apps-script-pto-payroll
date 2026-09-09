/**
 * Recompute-on-write balances.
 *
 * The first version of the system kept "hours used" as a running counter:
 * every approval did used += hours. It drifted. A duplicate approval added
 * twice, a manual cell edit was never subtracted, an undo did not always
 * find the value it had added. The counter was a second copy of the truth,
 * and second copies drift.
 *
 * The fix is to treat the painted day grid as the only truth and recompute
 * the totals from it after every write. Each day cell carries the hours as
 * its value and the leave type as its background colour, so "paid used" is
 * the sum of cells whose colour is in the paid set, and "unpaid used" the
 * sum over the unpaid set. Idempotent, and correct after any edit, including
 * ones made by hand.
 *
 * A SUMBYBGCOLOR custom function was the obvious alternative and does not
 * work: custom functions only resolve inside the spreadsheet that holds the
 * script, and every employee has their own workbook with no bound script, so
 * every one of them would show #NAME?. Script-side recompute works anywhere.
 *
 * This module is the pure part. The Apps Script side reads the grid's values
 * and backgrounds with getValues()/getBackgrounds() and writes the two totals.
 */

/** Sum numeric cell values whose background colour is in `colors` (case-insensitive hex). */
function sumGridByColors_(values, backgrounds, colors) {
  var set = {};
  for (var i = 0; i < colors.length; i++) set[String(colors[i]).toLowerCase()] = true;
  var sum = 0;
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      var bg = String((backgrounds[r] || [])[c] || '').toLowerCase();
      if (!set[bg]) continue;
      var n = (typeof v === 'number') ? v : parseFloat(v);
      if (!isNaN(n)) sum += n;
    }
  }
  return sum;
}

/** { paid, unpaid } from a grid and the two colour sets. */
function recomputeUsedTotals_(values, backgrounds, paidColors, unpaidColors) {
  return {
    paid: sumGridByColors_(values, backgrounds, paidColors),
    unpaid: sumGridByColors_(values, backgrounds, unpaidColors)
  };
}

if (typeof module !== 'undefined') {
  module.exports = { sumGridByColors_: sumGridByColors_, recomputeUsedTotals_: recomputeUsedTotals_ };
}
