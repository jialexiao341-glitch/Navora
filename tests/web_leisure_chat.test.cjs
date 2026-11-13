const {test} = require('node:test');
const assert = require('node:assert/strict');
const {appendLeisurePrompt} = require('../channel/web/static/js/core/leisure-chat.js');
test('adds a prompt while preserving an existing draft', () => {
 assert.equal(appendLeisurePrompt('', '猜谜'), '猜谜');
 assert.equal(appendLeisurePrompt('我的想法', '猜谜'), '我的想法\n\n猜谜');
 assert.equal(appendLeisurePrompt('我的想法\n\n', '猜谜'), '我的想法\n\n猜谜');
});
