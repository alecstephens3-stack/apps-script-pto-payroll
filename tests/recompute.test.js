var t = require('./harness');
var R = require('../src/recompute');
var eq = t.eq;
var PAID = ['#ffff00', '#00ff00'], UNPAID = ['#ff9900'];
var values = [[8, 8, '', 4], ['', 8, 3, ''], ['x', '', 8, 8]];
var bgs    = [['#FFFF00', '#ffff00', '#ffffff', '#ff9900'], ['#ffffff', '#00ff00', '#ff9900', '#ffffff'], ['#ffff00', '#ffffff', '#ffffff', '#ff9900']];

var tot = R.recomputeUsedTotals_(values, bgs, PAID, UNPAID);
eq('paid sums yellow + green cells',            tot.paid, 24);
eq('unpaid sums orange cells',                  tot.unpaid, 15);
eq('colour match is case-insensitive',          R.sumGridByColors_([[8]], [['#FFFF00']], ['#ffff00']), 8);
eq('non-numeric values are ignored',            R.sumGridByColors_([['x']], [['#ffff00']], ['#ffff00']), 0);
eq('unpainted cells are ignored',               R.sumGridByColors_([[8]], [['#ffffff']], PAID), 0);
eq('idempotent: same input, same totals',       R.recomputeUsedTotals_(values, bgs, PAID, UNPAID).paid, 24);
// The reason the counter approach was replaced: a hand edit to one cell is reflected with no bookkeeping.
values[0][0] = 4;
eq('a manual cell edit is reflected on recompute', R.recomputeUsedTotals_(values, bgs, PAID, UNPAID).paid, 20);

t.report('recompute-on-write');
