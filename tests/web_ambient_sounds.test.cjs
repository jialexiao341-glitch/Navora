const {test} = require('node:test');
const assert = require('node:assert/strict');
const {makeAmbientNoise} = require('../channel/web/static/js/core/ambient-sounds.js');
test('generates bounded deterministic audio for each atmosphere', () => {
 for (const kind of ['rain','wind','fire']) {
  let n = 0; const data = makeAmbientNoise(kind, 8000, 1, () => ((n++ * 7919) % 997) / 997);
  assert.equal(data.length, 8000); assert.ok(data.some(x => x !== 0));
  assert.ok(data.every(x => Number.isFinite(x) && Math.abs(x) <= 1));
 }
});
