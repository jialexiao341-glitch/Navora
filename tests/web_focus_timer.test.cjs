const { test } = require('node:test');
const assert = require('node:assert/strict');
const { focusRemaining, normalizeFocusMinutes, notifyFocusCompletion } = require('../channel/web/static/js/core/focus-timer.js');
test('countdown uses a deadline and never returns negative time', () => {
 assert.equal(focusRemaining({deadline: 10000, remaining: 5000}, 7000), 3000);
 assert.equal(focusRemaining({deadline: 10000, remaining: 5000}, 12000), 0);
 assert.equal(focusRemaining({deadline: null, remaining: 5000}, 12000), 5000);
});
test('duration accepts only whole minutes from 1 to 180', () => {
 assert.equal(normalizeFocusMinutes(25), 25); assert.equal(normalizeFocusMinutes(0), null);
 assert.equal(normalizeFocusMinutes(181), null); assert.equal(normalizeFocusMinutes(1.5), null);
});
test('focus completion prefers Electron native notification with force and falls back to browser', () => {
 const electronCalls = [];
 assert.equal(
  notifyFocusCompletion('专注计时', '专注时间结束', {
   electronAPI: { notify: (payload) => { electronCalls.push(payload); return Promise.resolve(true); } },
   hidden: false,
  }),
  'electron'
 );
 assert.deepEqual(electronCalls, [{ title: '专注计时', body: '专注时间结束', force: true }]);

 const browserCalls = [];
 function FakeNotification(title, opts) { browserCalls.push({ title, opts }); }
 FakeNotification.permission = 'granted';
 assert.equal(notifyFocusCompletion('Focus', 'Done', { Notification: FakeNotification, hidden: false }), 'none');
 assert.equal(notifyFocusCompletion('Focus', 'Done', { Notification: FakeNotification, hidden: true }), 'browser');
 assert.deepEqual(browserCalls, [{ title: 'Focus', opts: { body: 'Done' } }]);
});
