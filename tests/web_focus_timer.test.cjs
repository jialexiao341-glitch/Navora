const { test } = require('node:test');
const assert = require('node:assert/strict');
const { focusRemaining, normalizeFocusMinutes } = require('../channel/web/static/js/core/focus-timer.js');
test('countdown uses a deadline and never returns negative time', () => {
 assert.equal(focusRemaining({deadline: 10000, remaining: 5000}, 7000), 3000);
 assert.equal(focusRemaining({deadline: 10000, remaining: 5000}, 12000), 0);
 assert.equal(focusRemaining({deadline: null, remaining: 5000}, 12000), 5000);
});
test('duration accepts only whole minutes from 1 to 180', () => {
 assert.equal(normalizeFocusMinutes(25), 25); assert.equal(normalizeFocusMinutes(0), null);
 assert.equal(normalizeFocusMinutes(181), null); assert.equal(normalizeFocusMinutes(1.5), null);
});
