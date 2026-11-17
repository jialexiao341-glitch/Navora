const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('web shell includes desktop pre-paint class hook, window controls, and desktop.js', () => {
    const chatHtml = fs.readFileSync(path.join(ROOT, 'channel/web/chat.html'), 'utf8');
    const headerHtml = fs.readFileSync(path.join(ROOT, 'channel/web/templates/layout/header.html'), 'utf8');
    const configHtml = fs.readFileSync(path.join(ROOT, 'channel/web/templates/views/config.html'), 'utf8');
    const baseCss = fs.readFileSync(path.join(ROOT, 'channel/web/static/css/base.css'), 'utf8');

    assert.match(chatHtml, /window\.electronAPI[\s\S]*electron-desktop/);
    assert.match(chatHtml, /<script defer src="\/assets\/js\/core\/desktop\.js"><\/script>/);
    assert.match(headerHtml, /id="desktop-window-controls"/);
    assert.match(headerHtml, /windowMinimize\(\)/);
    assert.match(headerHtml, /windowMaximize\(\)/);
    assert.match(headerHtml, /windowClose\(\)/);
    assert.match(configHtml, /id="cfg-launch-at-login-wrap"/);
    assert.match(configHtml, /id="cfg-launch-at-login"/);
    assert.match(baseCss, /\.desktop-window-controls\s*\{[^}]*display:\s*none/);
    assert.match(baseCss, /html\.electron-win\s+\.desktop-window-controls\s*\{[^}]*display:\s*flex/);
});

test('desktop.js no-ops cleanly in normal browser without electronAPI', () => {
    const code = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/core/desktop.js'), 'utf8');
    const addedClasses = [];
    const sandbox = {
        window: {},
        document: {
            documentElement: {
                classList: { add: (c) => addedClasses.push(c) },
            },
        },
    };
    vm.runInNewContext(code, sandbox);
    assert.deepEqual(addedClasses, []);
});

test('desktop.js wires window state, version, menu actions, and update status when electronAPI exists', async () => {
    const code = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/core/desktop.js'), 'utf8');
    const classes = [];
    const navigated = [];
    let newChatCalls = 0;
    let switchedSession = null;
    let versionLabel = '';
    const renderCalls = [];
    const handlers = {};
    const maxIcon = { innerHTML: '' };
    const launchWrap = makeEl('cfg-launch-at-login-wrap');
    launchWrap.classList.add('hidden');
    const launchInput = makeEl('cfg-launch-at-login');
    launchInput.checked = false;
    const launchErr = makeEl('cfg-launch-at-login-error');
    launchErr.classList.add('hidden');
    const bodyChildren = [];
    const createdById = {
        'cfg-launch-at-login-wrap': launchWrap,
        'cfg-launch-at-login': launchInput,
        'cfg-launch-at-login-error': launchErr,
    };

    function makeEl(id) {
        return {
            id: id || '',
            className: '',
            textContent: '',
            innerHTML: '',
            style: {},
            children: [],
            classList: {
                _set: new Set(),
                add(c) { this._set.add(c); },
                remove(c) { this._set.delete(c); },
                contains(c) { return this._set.has(c); },
            },
            appendChild(child) { this.children.push(child); },
            addEventListener(ev, fn) { this['on_' + ev] = fn; },
        };
    }

    const sandbox = {
        window: {
            electronAPI: {
                platform: 'win32',
                windowIsMaximized: async () => true,
                onMaximizeChange: (cb) => { handlers.max = cb; return () => {}; },
                getAppVersion: async () => '2.2.2',
                onMenuAction: (cb) => { handlers.menu = cb; return () => {}; },
                onOpenSession: (cb) => { handlers.session = cb; return () => {}; },
                onUpdateStatus: (cb) => { handlers.update = cb; return () => {}; },
                checkForUpdate: async () => {},
                downloadUpdate: async () => {},
                installUpdate: async () => {},
                getLoginItemEnabled: async () => true,
                setLoginItemEnabled: async (enabled) => ({ ok: false, enabled: false, error: 'policy denied' }),
            },
        },
        document: {
            documentElement: {
                classList: { add: (c) => classes.push(c) },
            },
            body: {
                appendChild(el) {
                    bodyChildren.push(el);
                    if (el.id) createdById[el.id] = el;
                    const title = makeEl('dub-title');
                    const close = makeEl('dub-close');
                    const body = makeEl('dub-body');
                    createdById['dub-title'] = title;
                    createdById['dub-close'] = close;
                    createdById['dub-body'] = body;
                },
            },
            createElement: () => makeEl(),
            getElementById: (id) => {
                if (id === 'win-ctrl-max-icon') return maxIcon;
                return createdById[id] || null;
            },
        },
        currentLang: 'zh',
        APP_VERSION: '',
        _updateChecking: false,
        _updateRunning: false,
        _setSidebarVersionLabel: (v) => { versionLabel = v; },
        _renderUpdateAction: (state, label) => { renderCalls.push({ state, label }); },
        navigateTo: (v) => navigated.push(v),
        newChat: () => { newChatCalls += 1; },
        switchSession: (sid) => { switchedSession = sid; },
        t: (k) => 'tr:' + k,
    };

    vm.runInNewContext(code, sandbox);
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(classes.includes('electron-desktop'));
    assert.ok(classes.includes('electron-win'));
    assert.equal(versionLabel, 'v2.2.2');
    assert.match(maxIcon.innerHTML, /M3\.5 4/);

    handlers.menu('new-chat');
    handlers.menu('open-settings');
    handlers.menu('view-logs');
    assert.deepEqual(navigated, ['chat', 'config', 'logs']);
    assert.equal(newChatCalls, 1);

    handlers.session('sess-42');
    assert.equal(switchedSession, 'sess-42');
    assert.equal(navigated[navigated.length - 1], 'chat');

    handlers.update({ state: 'available', version: '2.2.3', userInitiated: true });
    assert.equal(renderCalls[renderCalls.length - 1].state, 'available');
    assert.ok(createdById['desktop-update-banner']);
    assert.equal(createdById['desktop-update-banner'].classList.contains('hidden'), false);

    handlers.update({ state: 'not-available' });
    assert.equal(renderCalls[renderCalls.length - 1].state, 'up_to_date');
    assert.equal(createdById['desktop-update-banner'].classList.contains('hidden'), true);

    // Silent background error should stay hidden and leave menu idle.
    handlers.update({ state: 'error', message: 'No published versions on GitHub', userInitiated: false });
    assert.equal(createdById['desktop-update-banner'].classList.contains('hidden'), true);
    assert.equal(renderCalls[renderCalls.length - 1].state, 'idle');

    // Explicit user check error should surface friendly message in banner.
    handlers.update({ state: 'error', message: 'No published versions on GitHub', userInitiated: true });
    assert.equal(createdById['desktop-update-banner'].classList.contains('hidden'), false);
    assert.equal(renderCalls[renderCalls.length - 1].state, 'failed');
    assert.equal(renderCalls[renderCalls.length - 1].label, 'tr:update_no_releases');

    // Launch-at-login should be visible, reflect initial OS state, and show refusal error on change.
    assert.equal(launchWrap.classList.contains('hidden'), false);
    assert.equal(launchInput.checked, true);
    launchInput.checked = true;
    launchInput.on_change();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(launchInput.checked, false);
    assert.equal(launchErr.classList.contains('hidden'), false);
    assert.match(launchErr.textContent, /policy denied/);
});

test('desktop.js bridges companion events, quick messages, and open-chat in main console', () => {
    const code = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/core/desktop.js'), 'utf8');
    const docListeners = {};
    const dispatched = [];
    const syncedEvents = [];
    const handlers = {};
    const sentMessages = [];
    const navigated = [];
    let chatFocused = false;
    const chatInput = {
        value: 'unfinished draft',
        focus() { chatFocused = true; },
        dispatchEvent() {},
    };

    const sandbox = {
        window: {
            electronAPI: {
                platform: 'win32',
                onMenuAction: (cb) => { handlers.menu = cb; return () => {}; },
                petSyncToOverlay: (ev) => syncedEvents.push(ev),
                onPetQuickMessage: (cb) => { handlers.petQuick = cb; return () => {}; },
                onPetConfigChanged: (cb) => { handlers.petConfig = cb; return () => {}; },
            },
        },
        document: {
            documentElement: {
                classList: {
                    add() {},
                    contains: () => false,
                },
                getAttribute: () => 'zh',
            },
            addEventListener: (type, cb) => { docListeners[type] = cb; },
            dispatchEvent: (ev) => { dispatched.push(ev); },
            getElementById: (id) => (id === 'chat-input' ? chatInput : null),
        },
        CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; },
        Event: function(type, init) { this.type = type; this.bubbles = Boolean(init?.bubbles); },
        navigateTo: (v) => navigated.push(v),
        sendMessage: () => { sentMessages.push(chatInput.value); },
        currentLang: 'zh',
    };

    vm.runInNewContext(code, sandbox);

    docListeners['navora:focus-state']({ detail: { running: true, mode: 'work' } });
    docListeners['navora:reply-complete']({ detail: { speakerName: 'Coder', previewText: 'Done!' } });
    assert.deepEqual(JSON.parse(JSON.stringify(syncedEvents)), [
        { type: 'navora:focus-state', detail: { running: true, mode: 'work' } },
        { type: 'navora:reply-complete', detail: { speakerName: 'Coder', previewText: 'Done!' } },
    ]);

    handlers.petQuick('hello pet');
    assert.deepEqual(sentMessages, ['hello pet']);
    assert.equal(chatInput.value, 'unfinished draft');

    handlers.menu('open-chat');
    assert.deepEqual(navigated, ['chat']);
    assert.equal(chatFocused, true);

    handlers.petConfig({ enabled: false });
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, 'navora:pet-config-sync');
    assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].detail)), { enabled: false });
});
