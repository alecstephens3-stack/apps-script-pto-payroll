var pass = 0, fail = 0, failures = [];
function D(s) { return new Date(s + 'T00:00:00'); }
function eq(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  fail++;
  failures.push(label + '\n      got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
}
function report(name) {
  console.log(name + ': ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\nFAILURES:\n  - ' + failures.join('\n  - ')); process.exit(1); }
}
module.exports = { D: D, eq: eq, report: report };
