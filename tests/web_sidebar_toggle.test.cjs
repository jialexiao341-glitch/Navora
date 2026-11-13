const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const header = fs.readFileSync(path.join(__dirname, '../channel/web/templates/layout/header.html'), 'utf8');
const sidebar = fs.readFileSync(path.join(__dirname, '../channel/web/templates/layout/sidebar.html'), 'utf8');
const nav = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/core/nav.js'), 'utf8');

test('desktop sidebar toggle is in the header, not sidebar footer', () => {
    assert.match(header, /id="sidebar-collapse-btn"/);
    assert.doesNotMatch(sidebar, /id="sidebar-collapse-btn"/);
});

test('sidebar toggle updates persisted state and accessible name', () => {
    const attrs = {};
    const classes = new Set();
    const values = {};
    const button = { setAttribute: (k, v) => { attrs[k] = v; } };
    const context = vm.createContext({
        document: { documentElement: { classList: { contains: key => classes.has(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key) } }, querySelectorAll: () => [], getElementById: () => button },
        localStorage: { setItem: (key, value) => { values[key] = value; } },
        SIDEBAR_COLLAPSED_KEY: 'cow_sidebar_collapsed', t: key => key,
    });
    vm.runInContext(nav.slice(nav.indexOf('function isSidebarCollapsed()'), nav.indexOf('\nsyncSidebarTips();')), context);
    context.toggleSidebarCollapsed();
    assert.equal(values.cow_sidebar_collapsed, '1');
    assert.equal(attrs['aria-expanded'], 'false');
    assert.equal(attrs['aria-label'], 'sidebar_expand');
    context.toggleSidebarCollapsed();
    assert.equal(values.cow_sidebar_collapsed, '0');
    assert.equal(attrs['aria-expanded'], 'true');
    assert.equal(attrs['aria-label'], 'sidebar_collapse');
});
