// test.js - plain node assertions against math.js.
const fs = require('fs');
const { add, sub } = require('./math.js');

let failures = 0;
function check(label, actual, expected) {
  if (actual !== expected) {
    failures += 1;
    console.log(`FAIL ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok ${label}`);
  }
}

check('add(2,3)', add(2, 3), 5);
check('add(-1,4)', add(-1, 4), 3);
check('sub(5,2)', sub(5, 2), 3);

const result = failures === 0 ? 'PASS' : 'FAIL';
fs.writeFileSync('test-result.txt', result);
console.log(`RESULT: ${result}`);
process.exitCode = failures === 0 ? 0 : 1;
