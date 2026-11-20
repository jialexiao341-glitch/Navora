/* Models & Capabilities view - web search capability card and provider key modals.
   Split out of views/models.js. Loaded immediately after views/models.js
   in the classic global script scope; see channel/web/README.md. */

function _searchProviderLabel(cap, providerId) {
    const list = (cap && cap.providers) || [];
    const hit = list.find(p => p.id === providerId);
    return hit ? localizedLabel(hit.label) : providerId;
}

// Search card body: strategy picker + (when fixed) provider picker + a
// status row that surfaces which providers are ready and how to add the
// missing ones. Three of the four backends piggy-back on model-vendor
// credentials (zhipu / qianfan / linkai); bocha owns its own key under
// tools.web_search and gets its own minimal credential modal.
function renderSearchCapability(def, cap, body) {
    const configuredIds = cap.configured_providers || [];
    const hasAny = configuredIds.length > 0;
    const strategy = cap.strategy || 'auto';

    body.innerHTML = `
        <div>
            <label class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">${t('models_search_strategy_label')}</label>
            <div id="cap-search-strategy" class="cfg-dropdown" tabindex="0">
                <div class="cfg-dropdown-selected">
                    <span class="cfg-dropdown-text">--</span>
                    <i class="fas fa-chevron-down cfg-dropdown-arrow"></i>
                </div>
                <div class="cfg-dropdown-menu"></div>
            </div>
        </div>
        <div id="cap-search-provider-wrap" class="hidden">
            <label class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">${t('models_provider')}</label>
            <div id="cap-search-provider" class="cfg-dropdown" tabindex="0">
                <div class="cfg-dropdown-selected">
                    <span class="cfg-dropdown-text">--</span>
                    <i class="fas fa-chevron-down cfg-dropdown-arrow"></i>
                </div>
                <div class="cfg-dropdown-menu"></div>
            </div>
        </div>
        <div id="cap-search-summary"></div>
        <div class="flex items-center justify-end gap-3 pt-1">
            <span id="cap-search-status" class="text-xs text-primary-500 opacity-0 transition-opacity duration-300"></span>
            <button onclick="saveSearchCapability()"
                    class="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium
                           cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed">
                ${t('save')}
            </button>
        </div>
    `;

    // Strategy dropdown — when no provider is configured the strategy
    // value is meaningless, so we show a "待配置" placeholder instead of
    // a default selection. Once any provider gets configured the saved
    // strategy (or "auto") becomes the active value.
    initDropdown(
        body.querySelector('#cap-search-strategy'),
        [
            { value: 'auto',  label: t('models_strategy_auto'),         hint: t('models_search_strategy_auto_hint') },
            { value: 'fixed', label: t('models_search_strategy_fixed'), hint: t('models_search_strategy_fixed_hint') },
        ],
        hasAny ? strategy : '',
        (value) => _onSearchStrategyChange(cap, value, body),
        hasAny ? null : { placeholder: t('models_pending_config') },
    );

    // Provider dropdown — populated with configured providers only;
    // unconfigured ones cannot be pinned (they'd silently fall back).
    const provOpts = configuredIds.map(id => ({
        value: id,
        label: _searchProviderLabel(cap, id),
    }));
    if (provOpts.length === 0) provOpts.push({ value: '', label: '--' });
    initDropdown(
        body.querySelector('#cap-search-provider'),
        provOpts,
        cap.fixed_provider || configuredIds[0] || '',
        () => {},
    );

    _renderSearchSummary(body, cap);
    _setSearchProviderPickerVisible(body, strategy === 'fixed' && hasAny);
}

function _onSearchStrategyChange(cap, value, body) {
    const configuredIds = cap.configured_providers || [];
    _setSearchProviderPickerVisible(body, value === 'fixed' && configuredIds.length > 0);
}

function _setSearchProviderPickerVisible(body, visible) {
    const wrap = body.querySelector('#cap-search-provider-wrap');
    if (!wrap) return;
    if (visible) wrap.classList.remove('hidden');
    else wrap.classList.add('hidden');
}

// Search summary line: just lists configured providers + a trailing "+
// add" button. Unconfigured backends are hidden — the user picks one from
// a small chooser when they click add. Empty state surfaces the same add
// button as a primary CTA.
function _renderSearchSummary(body, cap) {
    const host = body.querySelector('#cap-search-summary');
    if (!host) return;
    const providers = cap.providers || [];
    const configured = providers.filter(p => p.configured);
    // Disabled = credential kept but switched off for search; shown greyed out.
    const disabled = providers.filter(p => p.disabled);

    const missing = providers.filter(p => !p.configured && !p.disabled);

    const addBtn = missing.length
        ? `<button type="button" id="cap-search-add-btn"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md cursor-pointer
                         bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400
                         hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
              <i class="fas fa-plus text-[10px]"></i>${t('models_search_add_provider')}
           </button>`
        : '';

    if (configured.length === 0 && disabled.length === 0) {
        host.innerHTML = `
            <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <i class="fas fa-circle-info text-[10px] text-amber-500"></i>
                <span>${t('models_search_none_configured')}</span>
                ${addBtn}
            </div>
        `;
    } else {
        const chips = configured.map(p => `
            <span class="inline-flex items-center rounded-md text-[11px]
                         bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                <button type="button" data-search-edit-provider="${p.id}"
                        title="${t('models_search_edit_hint')}"
                        class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-l-md cursor-pointer
                               hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors">
                    <i class="fas fa-check text-[10px]"></i>${escapeHtml(localizedLabel(p.label))}${p.anonymous ? ` · ${t('models_search_anonymous_badge')}` : ''}
                </button>
                <button type="button" data-search-disable-provider="${p.id}"
                        title="${t('models_search_disable_hint')}"
                        class="px-1.5 py-0.5 rounded-r-md cursor-pointer opacity-60 hover:opacity-100
                               hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors">
                    <i class="fas fa-xmark text-[10px]"></i>
                </button>
            </span>
        `).join('');
        const disabledChips = disabled.map(p => `
            <button type="button" data-search-enable-provider="${p.id}"
                    title="${t('models_search_enable_hint')}"
                    class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md cursor-pointer
                           bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500
                           hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                ${escapeHtml(localizedLabel(p.label))}
            </button>
        `).join('');
        host.innerHTML = `
            <div class="flex items-center flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>${t('models_search_available_label')}</span>
                ${chips}
                ${disabledChips}
                ${addBtn}
            </div>
        `;
    }

    const addBtnEl = host.querySelector('#cap-search-add-btn');
    if (addBtnEl) {
        addBtnEl.addEventListener('click', (ev) => {
            ev.preventDefault();
            openSearchAddProviderPicker(missing);
        });
    }
    host.querySelectorAll('[data-search-edit-provider]').forEach(el => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            const pid = el.getAttribute('data-search-edit-provider');
            const meta = (cap.providers || []).find(p => p.id === pid);
            _launchSearchProviderConfig(pid, meta);
        });
    });
    host.querySelectorAll('[data-search-disable-provider]').forEach(el => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            _setSearchProviderEnabled(el.getAttribute('data-search-disable-provider'), false);
        });
    });
    host.querySelectorAll('[data-search-enable-provider]').forEach(el => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            _setSearchProviderEnabled(el.getAttribute('data-search-enable-provider'), true);
        });
    });
}

// Toggle a provider in/out of search without touching its credential.
function _setSearchProviderEnabled(providerId, enabled) {
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_search_provider_enabled', provider: providerId, enabled }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            loadModelsView({ preserveScroll: true });
        } else {
            console.log('[setSearchProviderEnabled] Error:', data.message);
            showStatus('cap-search-status', 'models_save_failed', true);
        }
    }).catch(() => showStatus('cap-search-status', 'models_save_failed', true));
}

// Two-step add flow: click "+ 添加厂商" -> chooser dialog -> per-provider
// credential editor. Bocha lands on the dedicated key modal; the others
// piggy-back on the existing vendor credential modal.
function openSearchAddProviderPicker(missingProviders) {
    if (!missingProviders || missingProviders.length === 0) return;
    if (missingProviders.length === 1) {
        _launchSearchProviderConfig(missingProviders[0].id);
        return;
    }

    const existing = document.getElementById('search-add-modal');
    if (existing) existing.remove();

    const rows = missingProviders.map(p => `
        <button type="button" data-pid="${p.id}"
                class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer
                       bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10
                       text-sm text-slate-700 dark:text-slate-200 transition-colors">
            <span>${escapeHtml(localizedLabel(p.label))}</span>
            <i class="fas fa-chevron-right text-[10px] text-slate-400"></i>
        </button>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'search-add-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10
                    w-full max-w-md mx-4 p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">${t('models_search_add_provider')}</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${t('models_search_add_desc')}</p>
            <div class="space-y-2">${rows}</div>
            <div class="flex items-center justify-end mt-5">
                <button type="button" onclick="document.getElementById('search-add-modal').remove()"
                        class="px-3 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300
                               hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                    ${t('cancel')}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-pid]').forEach(el => {
        el.addEventListener('click', () => {
            const pid = el.getAttribute('data-pid');
            modal.remove();
            _launchSearchProviderConfig(pid);
        });
    });
}

function _launchSearchProviderConfig(providerId, providerMeta) {
    // Providers that hold their own credential (dedicated key or, for SearXNG,
    // an instance URL) use the bespoke search-key modal. zhipu/qianfan/linkai
    // reuse a model-vendor key and go through the vendor modal instead.
    if (['bocha', 'anysearch', 'serply', 'tavily', 'outcrawl', 'firecrawl', 'specstream', 'searxng', 'keenable'].includes(providerId)) {
        openSearchKeyModal(providerId, providerMeta);
    } else if (providerId === 'deepseek') {
        openDeepseekSearchModal();
    } else {
        openVendorModal(providerId, () => loadModelsView({ preserveScroll: true }));
    }
}

function saveSearchCapability() {
    const strategyDd = document.getElementById('cap-search-strategy');
    const providerDd = document.getElementById('cap-search-provider');
    // 如果策略下拉框的值是空（待配置），默认使用 'auto'
    const strategy = strategyDd ? (getDropdownValue(strategyDd) || 'auto') : 'auto';
    const provider = (strategy === 'fixed' && providerDd) ? getDropdownValue(providerDd) : '';

    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'set_capability',
            capability: 'search',
            strategy,
            provider,
        }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            showStatus('cap-search-status', 'models_save_success', false);
            setTimeout(() => loadModelsView({ preserveScroll: true }), 400);
        } else {
            console.log('[saveSearchCapability] Error:', data.message);
            showStatus('cap-search-status', 'models_save_failed', true);
        }
    }).catch(() => showStatus('cap-search-status', 'models_save_failed', true));
}

// Minimal bocha API-key modal. Reuses the existing vendor-modal markup
// helpers would be nice, but bocha isn't in PROVIDER_MODELS (it's not a
// model vendor), so we render a tiny dedicated dialog.
// For search vendors that hold their own keys.

function openSearchKeyModal(providerId, providerMeta) {
    const existing = document.getElementById('search-key-modal');
    if (existing) existing.remove();

    const searchCap = (modelsState && modelsState.capabilities && modelsState.capabilities.search) || {};
    const prov = (searchCap.providers || []).find(p => p.id === providerId);
    const isSearxng = providerId === 'searxng';
    // SearXNG holds an instance URL (echoed back verbatim in url_masked); the
    // rest hold a masked API key. Resolve whichever applies as the field value.
    let masked;
    if (isSearxng) {
        masked = (providerMeta && providerMeta.url_masked) || (prov && prov.url_masked) || '';
    } else {
        masked = (providerMeta && providerMeta.api_key_masked) || '';
        if (!masked && prov && prov.api_key_masked) masked = prov.api_key_masked;
    }
    // SearXNG URL is not masked, so it's safe to keep editable (not a sentinel).
    const hasKey = !!masked;
    const isAnonymous = (providerId === 'anysearch' || providerId === 'keenable')
        && !!((providerMeta && providerMeta.anonymous) || (prov && prov.anonymous));
    const clearBtnHtml = (hasKey || isAnonymous)
        ? `<button type="button" id="search-key-clear"
                  class="px-3 py-1.5 rounded-md text-xs text-red-500 dark:text-red-400
                         hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors">
              ${t('models_clear_credential')}
           </button>`
        : '';
    let descText = t('models_search_' + providerId + '_desc');
    if (providerId === 'anysearch') {
        const hint = currentLang === 'zh'
            ? '（留空可启用匿名模式，每日有免费额度）'
            : '(Leave blank to enable anonymous mode with daily free quota)';
        descText = descText + ' ' + hint;
    }
    const modal = document.createElement('div');
    modal.id = 'search-key-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm';
    modal.innerHTML = `
        <div id="search-key-modal-card"
             class="bg-panel rounded-xl border border-slate-200 dark:border-white/10
                    w-full max-w-md mx-4 p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">${t('models_search_' + providerId + '_title')}</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${descText}</p>
            <label class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">${providerId === 'searxng' ? 'Instance URL' : 'API Key'}</label>
            <input id="search-key-input" type="text" autocomplete="off" data-1p-ignore data-lpignore="true"
                   class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600
                          bg-slate-50 dark:bg-white/5 text-sm text-slate-800 dark:text-slate-100
                          focus:outline-none focus:border-primary-500 ${isSearxng ? '' : 'font-mono'} ${(hasKey && !isSearxng) ? 'cfg-key-masked' : ''}"
                   value="${escapeHtml(masked)}"
                   data-masked="${(hasKey && !isSearxng) ? '1' : ''}"
                   placeholder="${isSearxng ? 'https://searxng.example.com' : 'sk-...'}" />
            <div class="flex items-center justify-between gap-3 mt-5">
                <div>${clearBtnHtml}</div>
                <div class="flex items-center gap-3">
                    <button type="button" onclick="document.getElementById('search-key-modal').remove()"
                            class="px-3 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300
                                   hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        ${t('cancel')}
                    </button>
                    <button type="button" onclick="_saveSearchKey('${providerId}')"
                            class="px-4 py-1.5 rounded-md bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium
                                   cursor-pointer transition-colors">
                        ${t('save')}
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Reset masked sentinel as soon as the user starts editing so the save
    // handler can tell apart "kept the existing key" vs "typed a new one".
    const input = document.getElementById('search-key-input');
    if (input) {
        const unmask = () => {
            if (input.dataset.masked === '1') {
                input.value = '';
                input.dataset.masked = '';
                input.classList.remove('cfg-key-masked');
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' || e.key === 'Escape') return;
            unmask();
        });
        input.addEventListener('paste', unmask);
        if (!hasKey) setTimeout(() => input.focus(), 50);
    }
    const clearBtn = document.getElementById('search-key-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => _clearSearchKey(providerId));

    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) modal.remove();
    });
    const onKey = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);
}

function _saveSearchKey(providerId) {
    const input = document.getElementById('search-key-input');
    if (!input) return;
    if (input.dataset.masked === '1') {
        const modal = document.getElementById('search-key-modal');
        if (modal) modal.remove();
        return;
    }
    const apiKey = input.value.trim();

    // anysearch and keenable: saving with an empty key enables the anonymous tier.
    if (providerId === 'anysearch' || providerId === 'keenable') {
        fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'set_search_credential',
                provider: providerId,
                api_key: apiKey,
                anonymous: !apiKey,
            }),
        }).then(r => r.json()).then(data => {
            if (data.status === 'success') {
                const modal = document.getElementById('search-key-modal');
                if (modal) modal.remove();
                loadModelsView({ preserveScroll: true });
            }
        });
        return;
    }

    if (providerId === 'searxng') {
        // SearXNG uses an instance URL, not an API key. Empty input is a no-op
        // here (use the clear button to remove it).
        if (!apiKey) {
            input.focus();
            return;
        }
        fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'set_search_credential',
                provider: providerId,
                url: apiKey,
            }),
        }).then(r => r.json()).then(data => {
            if (data.status === 'success') {
                const modal = document.getElementById('search-key-modal');
                if (modal) modal.remove();
                loadModelsView({ preserveScroll: true });
            }
        });
        return;
    }

    if (!apiKey) {
        input.focus();
        return;
    }
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_search_credential', provider: providerId, api_key: apiKey }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            const modal = document.getElementById('search-key-modal');
            if (modal) modal.remove();
            loadModelsView({ preserveScroll: true });
        }
    });
}

// DeepSeek search shares the model vendor's key and base, so it saves through
// set_provider. No clear button: clearing would also disable the chat model.
function openDeepseekSearchModal() {
    const existing = document.getElementById('search-key-modal');
    if (existing) existing.remove();

    const searchCap = (modelsState && modelsState.capabilities && modelsState.capabilities.search) || {};
    const prov = (searchCap.providers || []).find(p => p.id === 'deepseek') || {};
    const masked = prov.api_key_masked || '';
    const inputCls = `w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600
                      bg-slate-50 dark:bg-white/5 text-sm text-slate-800 dark:text-slate-100
                      focus:outline-none focus:border-primary-500 font-mono`;
    const labelCls = 'block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5';

    const modal = document.createElement('div');
    modal.id = 'search-key-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10
                    w-full max-w-md mx-4 p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">${t('models_search_deepseek_title')}</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${t('models_search_deepseek_desc')}</p>
            <label class="${labelCls}">Base URL</label>
            <input id="search-ds-base" type="text" autocomplete="off" class="${inputCls}"
                   value="${escapeHtml(prov.api_base || '')}" placeholder="https://api.deepseek.com/v1" />
            <label class="${labelCls} mt-4">API Key</label>
            <input id="search-key-input" type="text" autocomplete="off" data-1p-ignore data-lpignore="true"
                   class="${inputCls} ${masked ? 'cfg-key-masked' : ''}"
                   value="${escapeHtml(masked)}" data-masked="${masked ? '1' : ''}" placeholder="sk-..." />
            <div class="flex items-center justify-end gap-3 mt-5">
                <button type="button" onclick="document.getElementById('search-key-modal').remove()"
                        class="px-3 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300
                               hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                    ${t('cancel')}
                </button>
                <button type="button" onclick="_saveDeepseekSearch()"
                        class="px-4 py-1.5 rounded-md bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium
                               cursor-pointer transition-colors">
                    ${t('save')}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById('search-key-input');
    const unmask = () => {
        if (input.dataset.masked === '1') {
            input.value = '';
            input.dataset.masked = '';
            input.classList.remove('cfg-key-masked');
        }
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' || e.key === 'Escape') return;
        unmask();
    });
    input.addEventListener('paste', unmask);
    if (!masked) setTimeout(() => input.focus(), 50);

    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) modal.remove();
    });
    const onKey = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);
}

function _saveDeepseekSearch() {
    const input = document.getElementById('search-key-input');
    const baseInput = document.getElementById('search-ds-base');
    if (!input || !baseInput) return;
    const keptKey = input.dataset.masked === '1';
    const apiKey = keptKey ? '' : input.value.trim();
    if (!keptKey && !apiKey) {
        input.focus();
        return;
    }
    const payload = { action: 'set_provider', provider_id: 'deepseek', api_base: baseInput.value.trim() };
    if (apiKey) payload.api_key = apiKey;
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            const modal = document.getElementById('search-key-modal');
            if (modal) modal.remove();
            loadModelsView({ preserveScroll: true });
        }
    });
}

function _clearSearchKey(providerId) {
    // SearXNG is cleared by emptying its instance URL, not an API key.
    const payload = (providerId === 'searxng')
        ? { action: 'set_search_credential', provider: providerId, url: '' }
        : { action: 'set_search_credential', provider: providerId, api_key: '' };
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            const modal = document.getElementById('search-key-modal');
            if (modal) modal.remove();
            loadModelsView({ preserveScroll: true });
        }
    });
}
