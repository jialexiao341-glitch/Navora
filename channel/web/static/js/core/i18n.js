/* Translation runtime and the t() / applyI18n() helpers.
   Locale dictionaries live in core/i18n/{zh,zh-Hant,en}.js and populate
   window.__I18N_LOCALES__ before this script executes. */

// =====================================================================
// i18n
// =====================================================================
const I18N = (typeof window !== 'undefined' && window.__I18N_LOCALES__) || {};

// Resolve language by priority: user choice (localStorage) -> backend-detected
// (cow_lang) -> browser language -> 'zh'. Shares __cowResolveLang__ defined in
// chat.html; falls back to a local resolver if loaded standalone.
let currentLang = (typeof window.__cowResolveLang__ === 'function')
    ? window.__cowResolveLang__()
    : (function () {
        const norm = (raw) => {
            if (!raw) return '';
            const v = String(raw).trim().toLowerCase();
            if (v === 'auto') return '';
            // Handle Traditional Chinese variants first (more specific)
            if (v === 'zh-hant' || v.startsWith('zh-hant-') || v === 'zh-tw' || v === 'zh-hk') return 'zh-Hant';
            // Then Simplified Chinese
            if (v.indexOf('zh') === 0) return 'zh';
            if (v.indexOf('en') === 0) return 'en';
            return '';
        };
        return norm(localStorage.getItem('cow_lang'))
            || norm(window.__COW_DEFAULT_LANG__)
            || norm(navigator.language)
            || 'zh';
    })();

// An empty string is a real translation (e.g. a unit English leaves out).
function t(key) {
    const own = I18N[currentLang] && I18N[currentLang][key];
    if (typeof own === 'string') return own;
    return typeof I18N.en[key] === 'string' ? I18N.en[key] : key;
}

// Resolve a localized label that may be either a plain string or
// a {zh, en} object returned by the backend.
function localizedLabel(label) {
    if (label && typeof label === 'object') {
        return label[currentLang] || label.en || label.zh || '';
    }
    return label || '';
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset['i18nPlaceholder']);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset['i18nTitle']);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        el.setAttribute('aria-label', t(el.dataset['i18nAriaLabel']));
    });
    document.querySelectorAll('[data-i18n-tip]').forEach(el => {
        el.setAttribute('data-tip', t(el.dataset['i18nTip']));
    });
    document.querySelectorAll('[data-tip-key]').forEach(el => {
        el.setAttribute('data-tooltip', t(el.dataset.tipKey));
    });
    installCfgTipPortal();
    installContextUsagePopover();
    if (typeof syncSidebarTips === 'function') syncSidebarTips();
    
    // Clear any status messages when language changes
    document.querySelectorAll('[id$="-status"]').forEach(el => {
        el.classList.add('opacity-0');
    });
    
    _syncLangControls();
    // Point the docs link to the locale-specific Navora documentation.
    const docsLink = document.getElementById('docs-link');
    if (docsLink) docsLink.href = currentLang === 'zh'
        ? 'https://github.com/jialexiao341-glitch/Navora/blob/master/docs/zh/README.md'
        : 'https://github.com/jialexiao341-glitch/Navora#readme';
    const websiteLink = document.getElementById('website-link');
    if (websiteLink) websiteLink.href = 'https://github.com/jialexiao341-glitch/Navora/releases';
    // Workspace panel content is rendered by JS, not data-i18n attributes.
    if (typeof relocalizeWorkspacePanel === 'function') relocalizeWorkspacePanel();
}

// Single entry point for switching language. Updates the in-memory language,
// persists the user choice locally, re-renders the UI, and binds the choice to
// the backend `cow_lang` config so logs / agent replies / CLI follow suit.
function setLanguage(lang) {
    const next = (lang === 'en' || lang === 'zh' || lang === 'zh-Hant') ? lang : 'zh';
    if (next === currentLang) {
        // Still persist + sync in case storage/backend drifted from the UI.
        syncLanguageToBackend(next);
        return;
    }
    currentLang = next;
    localStorage.setItem('cow_lang', currentLang);
    applyI18n();
    _applyInputTooltips();
    // Keep the language switch button and config selector visually in sync.
    try { updateLangControls(); } catch (e) {}
    
    // Sync language choice to backend first, then trigger dynamic views reload
    // to avoid race conditions on API endpoints.
    syncLanguageToBackend(currentLang, () => {
        try { rerenderDynamicViews(); } catch (e) {}
    });
}

// Persist the language to the backend `cow_lang` config (best-effort; the UI
// has already switched locally, so a network failure is non-blocking).
function syncLanguageToBackend(lang, callback) {
    try {
        fetch('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: { cow_lang: lang } })
        })
        .then(() => { if (callback) callback(); })
        .catch(() => { if (callback) callback(); });
    } catch (e) {
        if (callback) callback();
    }
}

// Reflect the current language on both the top-right toggle and the config
// selector (if present), so the two entry points stay synchronized.
function updateLangControls() {
    _syncLangControls();
    // The config language picker is the custom .cfg-dropdown component. Only
    // sync it once it has been initialized (i.e. the config panel was opened).
    const sel = document.getElementById('cfg-lang-select');
    if (sel && sel._ddValue !== undefined && sel._ddValue !== currentLang) {
        sel._ddValue = currentLang;
        const textEl = sel.querySelector('.cfg-dropdown-text');
        if (textEl) {
            if (currentLang === 'zh-Hant') textEl.textContent = '繁體中文';
            else if (currentLang === 'zh') textEl.textContent = '简体中文';
            else textEl.textContent = 'English';
        }
        sel.querySelectorAll('.cfg-dropdown-item').forEach(i => {
            i.classList.toggle('active', i.dataset.value === currentLang);
        });
    }
}

// Reflect the current language on the header dropdown: short label on the
// toggle (简 / 繁 / EN) plus the active item highlighted in the menu.
function _syncLangControls() {
    const langLabel = document.getElementById('lang-label');
    if (langLabel) {
        if (currentLang === 'zh-Hant') langLabel.textContent = '繁';
        else if (currentLang === 'zh') langLabel.textContent = '简';
        else langLabel.textContent = 'EN';
    }
    document.querySelectorAll('#lang-menu .lang-menu-item').forEach(item => {
        const active = item.dataset.lang === currentLang;
        item.classList.toggle('text-blue-600', active);
        item.classList.toggle('dark:text-blue-400', active);
        item.classList.toggle('font-medium', active);
    });
}

// Toggle the header language dropdown menu open/closed.
function toggleLangMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('lang-menu');
    if (menu) menu.classList.toggle('hidden');
}

// Pick a language from the dropdown, then close the menu.
function selectLanguage(lang) {
    const menu = document.getElementById('lang-menu');
    if (menu) menu.classList.add('hidden');
    setLanguage(lang);
}
window.toggleLangMenu = toggleLangMenu;
window.selectLanguage = selectLanguage;

// Close the language menu when clicking outside of it.
document.addEventListener('click', (e) => {
    const selector = document.getElementById('lang-selector');
    const menu = document.getElementById('lang-menu');
    if (menu && !menu.classList.contains('hidden') && selector && !selector.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// Refresh JS-rendered views after a language switch. Each branch uses the
// lightweight in-memory re-render path (no extra network round-trips).
function rerenderDynamicViews() {
    // Models are a tab of the config view, not a view of their own.
    if (currentView === 'config' && typeof renderModelsView === 'function'
            && modelsState && (modelsState.providers || modelsState.capabilities)) {
        renderModelsView();
    }
    // Reload task list after language switch
    if (currentView === 'tasks') {
        tasksLoaded = false;
        loadTasksView();
    }
    // Reload skills and tools after language switch
    if (currentView === 'skills') {
        toolsLoaded = false;
        loadSkillsView();
    }
    // Reload channels after language switch
    if (currentView === 'channels') {
        loadChannelsView();
    }
    // Reload config after language switch
    if (currentView === 'config') {
        loadConfigView();
    }
    // Repaint the Agents workbench after a language switch. The grid, detail
    // pane and avatar picker are built from t() into innerHTML, so applyI18n()
    // (which only touches data-i18n nodes) can't relocalize them; re-render from
    // the in-memory catalog instead of refetching.
    if (currentView === 'agents') {
        renderAgentsGrid();
        if (selectedAdminAgentId) renderAgentDetail();
    }
    if (currentView === 'artifacts') rerenderArtifactsView();
}

// Floating tooltip portal for [data-tip-key] elements. Tooltip nodes are
// appended to <body> so they aren't clipped by overflow:hidden ancestors
// (e.g. the config panel's scroll container).
let _cfgTipPortalEl = null;
let _cfgTipPortalInstalled = false;
function installCfgTipPortal() {
    if (_cfgTipPortalInstalled) return;
    _cfgTipPortalInstalled = true;

    const showTip = (target) => {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;
        if (!_cfgTipPortalEl) {
            _cfgTipPortalEl = document.createElement('div');
            _cfgTipPortalEl.className = 'cfg-tip-floating';
            document.body.appendChild(_cfgTipPortalEl);
        }
        _cfgTipPortalEl.textContent = text;
        const rect = target.getBoundingClientRect();
        // Render once to measure, then position relative to the target.
        _cfgTipPortalEl.style.left = '0px';
        _cfgTipPortalEl.style.top = '0px';
        _cfgTipPortalEl.classList.add('show');
        const tipRect = _cfgTipPortalEl.getBoundingClientRect();
        const pos = target.getAttribute('data-tooltip-pos');
        let left;
        let top;
        if (pos === 'right') {
            left = rect.right + 10;
            top = rect.top + rect.height / 2 - tipRect.height / 2;
        } else {
            left = rect.left + rect.width / 2 - tipRect.width / 2;
            // Clamp horizontally to the viewport with an 8px gutter.
            left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
            // Default above the target; place below when data-tooltip-pos="bottom".
            top = pos === 'bottom' ? rect.bottom + 6 : rect.top - tipRect.height - 6;
        }
        _cfgTipPortalEl.style.left = left + 'px';
        _cfgTipPortalEl.style.top = top + 'px';
    };
    // Runs on every scroll and pointerdown, so skip the DOM write when already
    // hidden: a no-op classList.remove still wakes the Tailwind runtime.
    const hideTip = () => {
        if (_cfgTipPortalEl && _cfgTipPortalEl.classList.contains('show')) {
            _cfgTipPortalEl.classList.remove('show');
        }
    };

    // Matches config keys and any element opting into the floating tooltip via
    // [data-tip-float] (used for dynamic tooltips like the workspace selector,
    // whose data-tooltip is set at runtime rather than from a translation key).
    const _tipSel = '[data-tip-key],[data-tip-float]';
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest(_tipSel);
        if (target) showTip(target);
    });
    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest(_tipSel);
        if (target) hideTip();
    });
    // Hide on scroll/resize so the tooltip doesn't drift away from its anchor,
    // and on press: a click may hide or move the anchor, so no mouseout follows.
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
    document.addEventListener('pointerdown', hideTip, true);
}

