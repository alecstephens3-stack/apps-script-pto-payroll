var cp = require('child_process');
var path = require('path');
var files = ['period-routing', 'reconcile', 'recompute-tab-selection', 'date-math', 'recompute'];
var failed = 0;
files.forEach(function (f) {
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f + '.test.js')], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
});
if (failed) { console.log('\n' + failed + ' suite(s) failed'); process.exit(1); }
console.log('\nAll suites green.');
