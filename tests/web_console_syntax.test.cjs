const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'channel', 'web');
const STATIC_DIR = path.join(WEB_DIR, 'static');

function collectAllJs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectAllJs(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out.sort();
}

test('all first-party web console JS files parse with valid syntax', () => {
    const files = collectAllJs(path.join(STATIC_DIR, 'js'));
    assert.ok(files.length > 30, 'expected web console JS files');
    for (const file of files) {
        const code = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file);
        assert.doesNotThrow(() => new vm.Script(code, { filename: rel }), `Syntax error in ${rel}`);
    }
});

test('split i18n locale modules load cleanly and resolve zh, zh-Hant, and en translations', () => {
    const locales = ['zh', 'zh-Hant', 'en'];
    const sandbox = {
        window: { __cowResolveLang__: () => 'zh', addEventListener() {} },
        localStorage: { getItem: () => 'zh', setItem() {} },
        navigator: { language: 'zh-CN' },
        fetch: () => Promise.resolve({ ok: true }),
        currentView: 'chat',
        _applyInputTooltips() {},
        installContextUsagePopover() {},
        document: {
            addEventListener() {},
            querySelectorAll: () => [],
            getElementById: () => null,
        },
    };
    vm.createContext(sandbox);

    for (const loc of locales) {
        const file = path.join(STATIC_DIR, 'js', 'core', 'i18n', `${loc}.js`);
        vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    }
    const runtimeFile = path.join(STATIC_DIR, 'js', 'core', 'i18n.js');
    vm.runInContext(fs.readFileSync(runtimeFile, 'utf8'), sandbox, { filename: runtimeFile });

    const table = sandbox.window.__I18N_LOCALES__;
    for (const loc of locales) {
        assert.ok(table[loc] && Object.keys(table[loc]).length > 300, `missing keys for ${loc}`);
    }
    assert.equal(sandbox.t('memory_index_rebuild'), '重建索引');
    sandbox.setLanguage('en');
    assert.equal(sandbox.t('memory_index_rebuild'), 'Rebuild Index');
    sandbox.setLanguage('zh-Hant');
    assert.equal(sandbox.t('evo_restore_short'), '回滾');
});
