const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/chat/session-settings.js'), 'utf8');
function make(cfg, model) {
 const ctx = vm.createContext({ appConfig: cfg, detectProvider: () => 'deepseek' });
 vm.runInContext('let _sessCfg = ' + JSON.stringify({ model }) + ';\n' + src.slice(src.indexOf('function _modelControlState('), src.indexOf('function toggleModelSelector(')), ctx);
 return ctx._modelControlState();
}
test('uses supported native options and saved per-model strength', () => {
 const cap = { supported: true, options: [{value:'low'}, {value:'high'}], default: 'high' };
 const out = make({ enable_thinking: true, reasoning_effort_by_model: {'deepseek:deepseek-flash':'low'}, providers: {deepseek:{reasoning_by_model:{'deepseek-flash':cap}}} }, { model:'deepseek-flash',provider:'deepseek' });
 assert.equal(out.effort, 'low'); assert.equal(out.enabled, true); assert.equal(out.options.length, 2);
});
test('does not invent options for unsupported models', () => {
 const out = make({ providers: {deepseek:{reasoning:{supported:false, options:[]}}} }, {model:'unknown', provider:'deepseek'});
 assert.equal(out.options.length, 0);
});

test('saving effort updates only the active model and preserves server values', async () => {
 let request;
 const ctx = vm.createContext({
   _modelControlState: () => ({ enabled:true, options:[{value:'low'},{value:'high'}], key:'deepseek:deepseek-flash', provider:'deepseek', model:'deepseek-flash' }),
   fetch: async (url, init) => { request = {url, body:JSON.parse(init.body)}; return {json:async () => ({status:'success',applied:{reasoning_effort_by_model:{'other:model':'max','deepseek:deepseek-flash':'low'}}})}; },
   appConfig: {reasoning_effort_by_model:{'other:model':'max'}}, _renderModelChip() {}, renderModelMenu() {}, _wsToast() {}, t:k=>k,
 });
 vm.runInContext(src.slice(src.indexOf('async function setModelEffort('), src.indexOf('// Scroll the menu')), ctx);
 await ctx.setModelEffort('low');
 assert.equal(request.url,'/config');
 assert.equal(request.body.updates.reasoning_effort_by_model['deepseek:deepseek-flash'],'low');
 assert.equal(ctx.appConfig.reasoning_effort_by_model['other:model'],'max');
});

test('DeepSeek compatibility alias xhigh is displayed as high instead of an extra level', () => {
 const cap = { supported:true, options:['low','high','xhigh','max'].map(value => ({value})), default:'high' };
 const out = make({ enable_thinking:true, reasoning_effort_by_model:{'deepseek:deepseek-v4-flash':'xhigh'}, providers:{deepseek:{reasoning_by_model:{'deepseek-v4-flash':cap}}} }, { model:'deepseek-v4-flash', provider:'deepseek' });
 assert.deepEqual(Array.from(out.options, option => option.value), ['low','high','max']);
 assert.equal(out.effort, 'high');
});

test('enabling thinking applies the global setting and refreshes the panel', async () => {
 let request;
 const ctx = vm.createContext({
  appConfig: {enable_thinking:false}, document: {getElementById: () => null}, renderModelMenu() {}, _renderModelChip() {}, _wsToast() {}, t:k=>k,
  fetch: async (url, init) => { request=JSON.parse(init.body); return { json:async () => ({status:'success'}) }; },
 });
 vm.runInContext(src.slice(src.indexOf('async function enableModelThinking('), src.indexOf('async function setModelEffort(')), ctx);
 await ctx.enableModelThinking();
 assert.equal(request.updates.enable_thinking,true);
 assert.equal(ctx.appConfig.enable_thinking,true);
});
