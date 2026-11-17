const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAmbientQueue } = require('../channel/web/static/js/core/ambient-player.js');

test('queue tracks files and releases URLs when removed or cleared', () => {
 const released = []; let n = 0;
 const q = createAmbientQueue({createObjectURL: () => `blob:${++n}`, revokeObjectURL: url => released.push(url)});
 q.add([{name:'one.mp3'}, {name:'two.mp3'}]);
 assert.equal(q.current().name, 'one.mp3');
 q.next(); assert.equal(q.current().name, 'two.mp3');
 q.remove(1); assert.equal(q.current().name, 'one.mp3');
 q.clear(); assert.deepEqual(released, ['blob:2','blob:1']); assert.equal(q.current(), null);
});
test('queue handles boundaries and list looping', () => {
 const q = createAmbientQueue({createObjectURL: f => f.name, revokeObjectURL() {}});
 assert.equal(q.next(), null); q.add([{name:'a'}, {name:'b'}]);
 q.next(); assert.equal(q.next(), null); assert.equal(q.current().name, 'b');
 assert.equal(q.next(true).name, 'a'); assert.equal(q.previous(true).name, 'b');
});

test('built-in tracks keep their URLs and do not revoke them', () => {
 const released = []; const q = createAmbientQueue({createObjectURL: f => f.name, revokeObjectURL: u => released.push(u)});
 q.addBuiltins([{name:'Still water', url:'/assets/audio/still.wav'}]);
 assert.equal(q.current().url, '/assets/audio/still.wav'); q.clear(); assert.deepEqual(released, []);
});
test('floating position stays within viewport', () => {
 const { clampAmbientPosition } = require('../channel/web/static/js/core/ambient-player.js');
 assert.deepEqual(clampAmbientPosition(-10, 999, 400, 600, 42), {x:8, y:550});
});

test('loop defaults on for new and existing preferences and respects explicit new choice', () => {
 const { ambientLoopEnabled } = require('../channel/web/static/js/core/ambient-player.js');
 assert.equal(ambientLoopEnabled({}), true);
 assert.equal(ambientLoopEnabled({loop:false}), true);
 assert.equal(ambientLoopEnabled({loop:false, loopPreferenceVersion:1}), false);
 assert.equal(ambientLoopEnabled({loop:true, loopPreferenceVersion:1}), true);
});

test('local audio playlist entries deduplicate, serialize, and restore safely', () => {
 const {
  createAmbientQueue,
  serializePersistedTracks,
  parsePersistedTracks,
 } = require('../channel/web/static/js/core/ambient-player.js');
 const released = [];
 const q = createAmbientQueue({ createObjectURL: f => `blob:${f.name}`, revokeObjectURL: u => released.push(u) });
 q.addBuiltins([{ name: 'Still water', url: '/assets/audio/still.wav' }]);
 q.addLocalEntries([
  { name: 'rain.mp3', path: 'D:/Music/rain.mp3' },
  { name: 'rain.mp3', path: 'D:/Music/rain.mp3' },
  { name: '', path: 'D:/Music/lofi.flac' },
 ]);
 assert.equal(q.items.length, 3);
 assert.equal(q.items[2].name, 'lofi.flac');
 const saved = serializePersistedTracks(q.items);
 assert.deepEqual(saved, [
  { name: 'rain.mp3', path: 'D:/Music/rain.mp3' },
  { name: 'lofi.flac', path: 'D:/Music/lofi.flac' },
 ]);
 assert.deepEqual(parsePersistedTracks(JSON.stringify(saved)), saved);
 assert.deepEqual(parsePersistedTracks('bad-json'), []);
 assert.deepEqual(parsePersistedTracks(JSON.stringify([{ name: 'no-path' }, null])), []);
});
