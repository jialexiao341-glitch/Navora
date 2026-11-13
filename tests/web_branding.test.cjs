const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const boot = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/boot.js'), 'utf8');
const callback = boot.slice(boot.indexOf('    fetch(\'/config\')'), boot.indexOf('\n});', boot.indexOf('    fetch(\'/config\')')));

async function loadTitle(title) {
    const heading = { textContent: '' };
    const context = vm.createContext({
        fetch: async () => ({ json: async () => ({ status: 'success', title }) }),
        document: { getElementById: () => heading },
        appConfig: {}, initConfigView() {}, loadHistory() {},
    });
    vm.runInContext(`(async () => { ${callback.replace('    fetch(', '    await fetch(')} })()`, context);
    await new Promise(resolve => setImmediate(resolve));
    return { heading: heading.textContent, title: context.appConfig.title };
}

test('legacy CowAgent backend title is normalized on page load and for new chats', async () => {
    assert.deepEqual(await loadTitle('CowAgent'), { heading: '灵舟 · Navora', title: '灵舟 · Navora' });
});

test('explicit custom titles remain intact', async () => {
    assert.deepEqual(await loadTitle('Custom assistant'), { heading: 'Custom assistant', title: 'Custom assistant' });
});
