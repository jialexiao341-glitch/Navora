/* Per-session permission mode and model, as composer chips.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Per-session settings: permission mode and model
//
// Both live next to the workspace picker under the input, because all three
// answer the same question - what this conversation is allowed to do, and with
// what. Each falls back to the global setting until the user pins one here, so
// a session that was never touched keeps following Settings.
// =====================================================================

// Icons and i18n keys per mode. Ordered most-open first so the menu reads from
// "least restricted" downward, matching how the chip colours escalate.
const PERMISSION_META = {
    'full-access':     { icon: 'fa-lock-open',     key: 'perm_full_access' },
    'workspace-write': { icon: 'fa-shield-halved', key: 'perm_workspace_write' },
    'read-only':       { icon: 'fa-eye',           key: 'perm_read_only' },
};

// Last state from GET /api/sessions/<id>/settings; null until first fetch.
let _sessCfg = null;

function _permBtn() { return document.getElementById('permission-selector-btn'); }
function _permMenu() { return document.getElementById('permission-selector-menu'); }
function _modelBtn() { return document.getElementById('model-selector-btn'); }
function _modelMenu() { return document.getElementById('model-selector-menu'); }

function _permLabel(mode) { return t((PERMISSION_META[mode] || {}).key || 'perm_full_access'); }

/** Close every composer popover except `keep` (so one chip's menu replaces another's). */
function _closeComposerMenus(keep) {
    [[_wsSelMenu(), _wsSelBtn()], [_permMenu(), _permBtn()], [_modelMenu(), _modelBtn()]]
        .forEach(([menu, btn]) => {
            if (!menu || menu === keep) return;
            menu.classList.add('hidden');
            if (btn) { btn.classList.remove('open'); if (btn === _modelBtn()) btn.setAttribute('aria-expanded', 'false'); }
        });
    const agentMenu = document.getElementById('composer-agent-menu');
    if (agentMenu && agentMenu !== keep) agentMenu.classList.add('hidden');
}

// Fetch this session's effective model + permission and repaint both chips.
async function refreshSessionSettings() {
    try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/settings`);
        const data = await res.json();
        if (data.status !== 'success') return;
        _sessCfg = { model: data.model, permission: data.permission, team: data.team };
    } catch (e) {
        // Keep whatever the chips already show rather than blanking them.
        return;
    }
    _renderPermissionChip();
    _renderModelChip();
    _renderInputPlaceholder();
    renderComposerIdentity();
}

function _renderPermissionChip() {
    const btn = _permBtn();
    if (!btn || !_sessCfg) return;
    const state = _sessCfg.permission || {};
    const mode = state.mode || 'full-access';
    const meta = PERMISSION_META[mode] || PERMISSION_META['full-access'];

    const label = document.getElementById('permission-selector-label');
    if (label) label.textContent = _permLabel(mode);
    const icon = document.getElementById('permission-selector-icon');
    if (icon) icon.className = `fas ${meta.icon}`;

    // One colour per mode, so an unrestricted session is visibly different from
    // a read-only one without having to read the label.
    btn.classList.remove('perm-read-only', 'perm-workspace-write', 'perm-full-access');
    btn.classList.add(`perm-${mode}`);

    const tip = t('perm_tip').replace('{name}', _permLabel(mode))
        + (state.source === 'global' ? ` · ${t('perm_follow_global')}` : '');
    btn.setAttribute('data-tooltip', tip);
    btn.setAttribute('data-tooltip-pos', 'top');
    btn.setAttribute('data-tip-float', '');
}

// The composer placeholder only advertises "@ an Agent" when the conversation
// actually has other members to address. A solo chat can only @ files, so it
// falls back to the file-only hint. Runs whenever the session's team changes.
function _renderInputPlaceholder() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.placeholder = t(sharedConversation() ? 'input_placeholder_team' : 'input_placeholder');
}

/** Display name a custom provider gives one of its models, or ''. */
function _modelAlias(providers, providerId, model) {
    if (!model) return '';
    const group = (providers || []).find(p => p.id === providerId);
    return (group && group.labels && group.labels[model]) || '';
}

function _renderModelChip() {
    const btn = _modelBtn();
    if (!btn || !_sessCfg) return;
    // Once a conversation has more than one Agent there is no single model to
    // show: each answers on its own. Pinning one here would silently apply to
    // whoever happens to own the conversation.
    const shared = sharedConversation();
    btn.classList.toggle('hidden', shared);
    if (shared) {
        _modelMenu()?.classList.add('hidden');
        btn.classList.remove('open');
        return;
    }
    const state = _sessCfg.model || {};
    const model = state.model || '';
    const activeProvider = state.provider || (state.global && state.global.provider) || '';

    // The chip shows the display name; the tooltip keeps the real model name.
    const label = document.getElementById('model-selector-label');
    if (label) label.textContent = _modelAlias(state.providers, activeProvider, model) || model || t('model_unset');
    const effortLabel = document.getElementById('model-effort-label');
    const control = _modelControlState();
    if (effortLabel) effortLabel.textContent = control.options.length && control.enabled ? t(`model_effort_${control.effort}`) : '';

    const tip = t('model_tip').replace('{name}', model || t('model_unset'))
        + (state.source === 'global' ? ` · ${t('model_follow_global')}` : '')
        + (state.source === 'agent' ? ` · ${t('model_follow_agent')}` : '');
    btn.setAttribute('data-tooltip', tip);
    btn.setAttribute('data-tooltip-pos', 'top');
    btn.setAttribute('data-tip-float', '');
}

function togglePermissionSelector(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const menu = _permMenu();
    if (!menu) return;
    if (!menu.classList.contains('hidden')) {
        _closeComposerMenus();
        return;
    }
    _closeComposerMenus(menu);
    const open = () => { renderPermissionMenu(); menu.classList.remove('hidden'); _permBtn()?.classList.add('open'); };
    if (_sessCfg) open(); else refreshSessionSettings().then(open);
}

function renderPermissionMenu() {
    const menu = _permMenu();
    if (!menu) return;
    const state = (_sessCfg && _sessCfg.permission) || {};
    const modes = state.modes && state.modes.length ? state.modes : Object.keys(PERMISSION_META);
    const current = state.mode || 'full-access';
    const isGlobal = state.source === 'global';

    const parts = [`<div class="composer-menu-title">${escapeHtml(t('perm_menu_title'))}</div>`];
    // Menu order follows PERMISSION_META, not the backend tuple, so the list
    // reads consistently even if the backend reorders its modes. "Follow global"
    // is intentionally not a row of its own: picking a mode simply pins it, and
    // clicking the already-active mode clears the pin (back to global) so the
    // behaviour is still reachable without cluttering the menu.
    Object.keys(PERMISSION_META).filter(m => modes.includes(m)).forEach(mode => {
        const meta = PERMISSION_META[mode];
        const active = mode === current;
        // When this mode is the active one AND it is pinned, clicking it clears
        // the pin; otherwise clicking pins this mode.
        const arg = (active && !isGlobal) ? 'null' : `'${mode}'`;
        parts.push(`
            <button class="composer-menu-item ${active ? 'active' : ''}" onclick="selectSessionPermission(${arg})">
                <i class="fas ${meta.icon}"></i>
                <span class="composer-menu-body">
                    <span class="composer-menu-name">${escapeHtml(t(meta.key))}</span>
                    <span class="composer-menu-desc">${escapeHtml(t(meta.key + '_desc'))}</span>
                </span>
                ${active ? '<i class="fas fa-check composer-menu-check"></i>' : ''}
            </button>`);
    });

    menu.innerHTML = parts.join('');
}

/** Pin this session's permission mode, or pass null to follow the global one. */
async function selectSessionPermission(mode) {
    _closeComposerMenus();
    await _applySessionSettings({ permission: mode });
}

// Insert an actionable hint after a tool card whose call was refused by the
// permission gate. Clicking it opens the permission selector under the input so
// the user can raise the mode without hunting for the chip.
function _appendPermissionDeniedHint(toolEl, mode) {
    if (!toolEl || !toolEl.parentElement) return;
    // Avoid stacking duplicate hints if the model retries the same blocked call.
    if (toolEl.nextElementSibling
        && toolEl.nextElementSibling.classList
        && toolEl.nextElementSibling.classList.contains('perm-denied-hint')) {
        return;
    }
    const label = _permLabel(mode || (_sessCfg && _sessCfg.permission && _sessCfg.permission.mode) || 'workspace-write');
    const hint = document.createElement('div');
    hint.className = 'perm-denied-hint';
    hint.innerHTML = `
        <i class="fas fa-shield-halved"></i>
        <span class="perm-denied-text">${escapeHtml(t('perm_denied_hint').replace('{name}', label))}</span>
        <button type="button" class="perm-denied-btn">${escapeHtml(t('perm_denied_action'))}</button>`;
    hint.querySelector('.perm-denied-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = _permBtn();
        if (btn) { btn.scrollIntoView({ block: 'nearest' }); }
        togglePermissionSelector();
    });
    toolEl.parentElement.insertBefore(hint, toolEl.nextElementSibling);
}

// The model belongs to the chat; reasoning is a model-wide configuration.
function _modelControlState() {
    const state = (_sessCfg && _sessCfg.model) || {};
    const model = state.model || (state.global && state.global.model) || '';
    const provider = state.provider || (state.global && state.global.provider) ||
        (typeof detectProvider === 'function' ? detectProvider(model) : '') || '';
    const config = (appConfig.providers || {})[provider] || {};
    const byModel = config.reasoning_by_model || {};
    const capability = byModel[model] || (model === appConfig.model ? config.reasoning : null) || {};
    let options = capability.supported && Array.isArray(capability.options) ? capability.options : [];
    // DeepSeek accepts xhigh for compatibility but maps it to high.
    if (provider === 'deepseek' && /^deepseek-(v4|flash)/i.test(model)) options = options.filter(option => option.value !== 'xhigh');
    const key = `${provider}:${model.trim().toLowerCase()}`;
    let saved = (appConfig.reasoning_effort_by_model || {})[key] || appConfig.reasoning_effort;
    if (provider === 'deepseek' && /^deepseek-(v4|flash)/i.test(model) && ['medium', 'xhigh'].includes(saved)) saved = 'high';
    const effort = options.some(option => option.value === saved) ? saved : (capability.default || (options[0] || {}).value || '');
    return { model, provider, options, effort, key, defaultEffort: capability.default || (options[0] || {}).value, enabled: !!(appConfig.enable_thinking || capability.thinking_only), thinkingOnly: !!capability.thinking_only };
}

function toggleModelSelector(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const menu = _modelMenu();
    if (!menu) return;
    if (!menu.classList.contains('hidden')) {
        _closeComposerMenus();
        return;
    }
    _closeComposerMenus(menu);
    const open = () => {
        renderModelMenu();
        menu.classList.remove('hidden');
        _modelBtn()?.classList.add('open');
        _modelBtn()?.setAttribute('aria-expanded', 'true');
    };
    // Always re-fetch: the catalog depends on which providers have keys, which
    // may have changed in Settings since this page loaded.
    refreshSessionSettings().then(() => { if (_sessCfg) open(); });
}

function renderModelMenu() {
    const menu = _modelMenu();
    if (!menu) return;
    const state = (_sessCfg && _sessCfg.model) || {};
    const control = _modelControlState();
    const alias = _modelAlias(state.providers, control.provider, control.model);
    const modelName = alias || control.model || t('model_unset');
    const options = control.options;
    const activeIndex = Math.max(0, options.findIndex(option => option.value === control.effort));
    const selected = options[activeIndex];
    const labelKey = selected ? `model_effort_${selected.value}` : '';
    const effortLabel = selected ? t(labelKey) : t('model_effort_unavailable');
    const percent = options.length > 1 ? (activeIndex / (options.length - 1)) * 100 : 0;
    const enabled = control.enabled;
    const dots = options.map((option, index) => {
        const selected = option.value === control.effort;
        const text = t(`model_effort_${option.value}`);
        return `<button type="button" class="model-effort-step ${selected ? 'is-active' : ''}"
            role="radio" aria-checked="${selected}" aria-label="${escapeHtml(text)}"
            ${enabled ? '' : 'disabled'} onclick="setModelEffort('${_wsAttr(option.value)}')">
            <span class="model-effort-dot"></span></button>`;
    }).join('');
    const status = options.length ? (enabled ? t('model_effort_scope') : t('model_effort_disabled')) : t('model_effort_unavailable');
    menu.innerHTML = `<div class="model-control" title="${escapeHtml(status)}">
        <div class="model-control-heading">
            <span class="model-control-symbol" aria-hidden="true"></span>
            <button type="button" class="model-control-select" onclick="event.stopPropagation(); renderModelList()" aria-label="${escapeHtml(t('model_change'))}">
                <strong>${escapeHtml(options.length ? (enabled ? effortLabel : t('model_effort_off')) : '—')}</strong>
                <span>${escapeHtml(modelName)} <i class="fas fa-chevron-right"></i></span>
            </button>
            <button type="button" class="model-control-reset" onclick="setModelEffort('${_wsAttr(control.defaultEffort || '')}')" aria-label="${escapeHtml(t('model_effort_reset'))}" title="${escapeHtml(t('model_effort_reset'))}" ${options.length && enabled ? '' : 'disabled'}><i class="fas fa-rotate-left"></i></button>
        </div>
        ${options.length ? `<div class="model-control-effort">
            <div class="model-effort-track ${enabled ? '' : 'is-disabled'}" role="radiogroup" aria-label="${escapeHtml(t('config_reasoning_effort'))}" style="--effort-progress:calc(${percent}% + ${15 - percent * .3}px)">${dots}</div>
        </div>` : ''}
        ${!options.length || !enabled ? `<div class="model-control-foot"><span>${escapeHtml(status)}</span>${options.length && !enabled ? `<button type="button" onclick="enableModelThinking()">${escapeHtml(t('model_effort_enable'))}</button>` : ''}</div>` : ''}
    </div>`;
}

function renderModelList() {
    const menu = _modelMenu();
    if (!menu) return;
    const state = (_sessCfg && _sessCfg.model) || {};
    const control = _modelControlState();
    let providers = Array.isArray(state.providers) ? state.providers : [];
    // Older servers can omit the current provider when bot_type is inferred.
    // Keep the effective model visible even if no catalog was returned.
    if (!providers.some(p => p.id === control.provider && (p.models || []).includes(control.model)) && control.model) {
        providers = [{ id: control.provider, label: control.provider || t('model_current'), models: [control.model] }, ...providers];
    }
    const pinned = state.source === 'session';
    const parts = [`<div class="model-list-head"><button type="button" class="model-list-back" onclick="event.stopPropagation(); renderModelMenu()" aria-label="${escapeHtml(t('model_back'))}"><i class="fas fa-arrow-left"></i></button><span>${escapeHtml(t('model_change'))}</span></div>`];
    providers.forEach((p, idx) => {
        if (idx > 0) parts.push('<div class="composer-menu-divider"></div>');
        const current = p.id === control.provider ? ' data-current-provider' : '';
        parts.push(`<div class="composer-menu-title"${current}>${escapeHtml(localizedLabel(p.label))}</div>`);
        (p.models || []).forEach(m => {
            const active = m === control.model && p.id === control.provider;
            const arg = (active && pinned) ? 'null, null' : `'${_wsAttr(p.id)}','${_wsAttr(m)}'`;
            const alias = _modelAlias([p], p.id, m);
            const body = alias ? `<span class="composer-menu-name">${escapeHtml(alias)}</span><span class="composer-menu-desc break-all">${escapeHtml(m)}</span>` : `<span class="composer-menu-name">${escapeHtml(m)}</span>`;
            parts.push(`<button type="button" class="composer-menu-item ${active ? 'active' : ''}" onclick="selectSessionModel(${arg})"><i class="fas fa-microchip"></i><span class="composer-menu-body">${body}</span>${active ? '<i class="fas fa-check composer-menu-check"></i>' : ''}</button>`);
        });
    });
    if (!providers.length) parts.push(`<div class="model-list-empty">${escapeHtml(t('model_list_empty'))}</div>`);
    menu.innerHTML = parts.join('');
    _scrollModelMenuToActive(menu);
}

function openReasoningSettings() {
    _closeComposerMenus();
    navigateTo('config');
}

// This setting is global, as indicated in the panel; a deliberate click is
// required before custom providers receive a thinking effort.
async function enableModelThinking() {
    try {
        const response = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: { enable_thinking: true } }) });
        const data = await response.json();
        if (data.status !== 'success') { _wsToast(data.message || t('session_settings_failed')); return; }
        appConfig.enable_thinking = true;
        const settingsToggle = document.getElementById('cfg-enable-thinking');
        if (settingsToggle) settingsToggle.checked = true;
        _renderModelChip();
        renderModelMenu();
    } catch (_) { _wsToast(t('session_settings_failed')); }
}

async function setModelEffort(value) {
    const control = _modelControlState();
    if (!control.enabled || !control.options.some(option => option.value === value) || !control.provider || !control.model) return;
    try {
        const response = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: { reasoning_effort_by_model: { [control.key]: value } } }) });
        const data = await response.json();
        if (data.status !== 'success') { _wsToast(data.message || t('session_settings_failed')); return; }
        const saved = (data.applied && data.applied.reasoning_effort_by_model) || { ...appConfig.reasoning_effort_by_model, [control.key]: value };
        appConfig.reasoning_effort_by_model = saved;
        if (typeof configReasoningByModel !== 'undefined') configReasoningByModel = saved;
        _renderModelChip();
        renderModelMenu();
    } catch (_) { _wsToast(t('session_settings_failed')); }
}

// Scroll the menu (not the page) so the active model sits in the middle; a
// model typed by hand has no row, so fall back to its provider's heading.
function _scrollModelMenuToActive(menu) {
    const target = menu.querySelector('.composer-menu-item.active')
        || menu.querySelector('[data-current-provider]');
    if (!target) return;
    const offset = target.getBoundingClientRect().top - menu.getBoundingClientRect().top + menu.scrollTop;
    menu.scrollTop = Math.max(0, offset - (menu.clientHeight - target.offsetHeight) / 2);
}

/** Pin a model for this session; pass nulls to follow the global model again. */
async function selectSessionModel(provider, model) {
    _closeComposerMenus();
    await _applySessionSettings({ provider: provider, model: model });
}

// Single writer for both chips: POST the change, then repaint from the state the
// backend echoes back so the UI can never disagree with what was stored.
async function _applySessionSettings(body) {
    try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.status !== 'success') { _wsToast(data.message || t('session_settings_failed')); return; }
        _sessCfg = { model: data.model, permission: data.permission };
        _renderPermissionChip();
        _renderModelChip();
    } catch (e) {
        _wsToast(t('session_settings_failed'));
    }
}

document.addEventListener('click', (e) => {
    [[_permMenu(), _permBtn()], [_modelMenu(), _modelBtn()]].forEach(([menu, btn]) => {
        if (!menu || menu.classList.contains('hidden')) return;
        if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
        menu.classList.add('hidden');
        if (btn) { btn.classList.remove('open'); if (btn === _modelBtn()) btn.setAttribute('aria-expanded', 'false'); }
    });
});

