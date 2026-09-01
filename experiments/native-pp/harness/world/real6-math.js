// math.js - the module under test. Deliberately buggy: add() multiplies.
function add(a, b) {
  return a * b;
}

function sub(a, b) {
  return a - b;
}

module.exports = { add, sub };
