const {test} = require('node:test');
const assert = require('node:assert/strict');
const {clampCompanionPosition} = require('../channel/web/static/js/core/companion.js');
test('keeps the companion inside the viewport even after resize', () => {
 assert.deepEqual(clampCompanionPosition(-20, 800, 400, 500, 68, 68), {x:8,y:424});
 assert.deepEqual(clampCompanionPosition(90, 100, 50, 50, 68, 68), {x:8,y:8});
});
const {companionPhaseForEvent} = require('../channel/web/static/js/core/companion.js');
test('only reports searching for actual search or web tools', () => {
 assert.equal(companionPhaseForEvent('tool_start', 'web_search'), 'search');
 assert.equal(companionPhaseForEvent('tool_start', 'web_fetch'), 'search');
 assert.equal(companionPhaseForEvent('tool_start', 'write'), 'tool');
 assert.equal(companionPhaseForEvent('reasoning', ''), 'thinking');
 assert.equal(companionPhaseForEvent('delta', ''), 'answering');
 assert.equal(companionPhaseForEvent('unrelated', ''), null);
});

test('roaming stays in chat bounds and honors each personality step', () => {
 const {nextCompanionWalk} = require('../channel/web/static/js/core/companion.js');
 const rect = {left:100, top:80, right:900, bottom:600};
 const gentle = nextCompanionWalk({x:400,y:250}, rect, 68, 68, 'tuantuan', () => 1);
 const playful = nextCompanionWalk({x:400,y:250}, rect, 68, 68, 'tiaotiao', () => 1);
 assert.ok(playful.x - 400 > gentle.x - 400);
 assert.ok(playful.x <= 824 && playful.y <= 524);
 const edge = nextCompanionWalk({x:820,y:520}, rect, 68, 68, 'momo', () => 1);
 assert.ok(edge.x <= 824 && edge.y <= 524);
});
