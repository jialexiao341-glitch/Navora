/* Models & Capabilities view - vendor credential modal and model catalog editor.
   Split out of views/models.js. Loaded before views/models-custom-provider.js
   in the classic global script scope; see channel/web/README.md. */

// ---------- Vendor credential modal ------------------------------------

let vendorModalState = { providerId: '', onSaved: null };

function openVendorModal(providerId, onSaved) {
    vendorModalState = { providerId: providerId || '', onSaved: onSaved || null };

    const overlay = document.getElementById('vendor-modal-overlay');
    const pickerWrap = document.getElementById('vendor-modal-picker-wrap');
    const keyInput = document.getElementById('vendor-modal-key');
    const clearBtn = document.getElementById('vendor-modal-clear');

    // Reset any leftover status (e.g. previous "Saved" message)
    const statusEl = document.getElementById('vendor-modal-status');
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.add('opacity-0');
    }

    if (!providerId) {
        const builtinProviders = modelsState.providers.filter(p => !isCustomProviderCard(p));
        const unconfigured = builtinProviders.filter(p => !p.configured);

        if (!unconfigured.length) {
            openCustomProviderModal('');
            return;
        }

        const pickerOpts = builtinProviders.map(p => ({
            value: p.id,
            label: localizedLabel(p.label),
            _configured: !!p.configured,
        }));
        if (!pickerOpts.some(o => o.value === 'custom')) {
            pickerOpts.push({ value: 'custom', label: t('models_custom_vendor_label'), _configured: false });
        }
        pickerOpts.forEach(o => { if (o.value === 'custom') { o._isAddNew = true; o._configured = false; } });
        const defaultId = unconfigured[0].id;
        pickerWrap.classList.remove('hidden');
        const pickerEl = document.getElementById('vendor-modal-picker');
        const onPick = (val) => {
            if (val === 'custom') {
                closeVendorModal();
                openCustomProviderModal('');
                return;
            }
            fillVendorModalForProvider(val);
        };
        initDropdown(pickerEl, pickerOpts, defaultId, onPick);
        decorateVendorModalPicker(pickerEl, pickerOpts);
        onPick(defaultId);
    } else {
        pickerWrap.classList.add('hidden');
        fillVendorModalForProvider(providerId);
    }

    overlay.classList.remove('hidden');

    document.getElementById('vendor-modal-cancel').onclick = closeVendorModal;
    document.getElementById('vendor-modal-save').onclick = saveVendorModal;
    bindCatalogControls('vendor-modal', vendorModalState.providerId);
    clearBtn.onclick = clearVendorModal;

    keyInput.oninput = function () {
        if (keyInput.dataset.masked === '1' && keyInput.value !== keyInput.dataset.maskedVal) {
            keyInput.dataset.masked = '';
        }
    };

    function onOverlayClick(e) {
        if (e.target === overlay) {
            closeVendorModal();
            overlay.removeEventListener('click', onOverlayClick);
        }
    }
    overlay.addEventListener('click', onOverlayClick);
    keyInput.focus();
}

function fillVendorModalForProvider(providerId) {
    const meta = modelsState.providers.find(p => p.id === providerId);
    if (!meta) return;
    document.getElementById('vendor-modal-title').textContent = localizedLabel(meta.label);
    document.getElementById('vendor-modal-subtitle').textContent = meta.id;

    const manageKey = document.getElementById('vendor-modal-manage-key');
    if (manageKey) {
        if (!manageKey.dataset.defaultHref) manageKey.dataset.defaultHref = manageKey.href;
        manageKey.href = manageKey.dataset.defaultHref;
        manageKey.classList.toggle('hidden', meta.id !== 'linkai');
    }

    const baseWrap = document.getElementById('vendor-modal-base-wrap');
    const baseInput = document.getElementById('vendor-modal-base');
    const baseHint = document.getElementById('vendor-modal-base-hint');
    if (meta.api_base_field) {
        baseWrap.classList.remove('hidden');
        baseInput.placeholder = meta.api_base_default || meta.api_base_placeholder || '';
        baseInput.value = meta.api_base || '';
        baseHint.classList.add('hidden');
    } else {
        baseWrap.classList.add('hidden');
        baseInput.value = '';
    }
    renderVendorBasePresets(meta);

    const keyInput = document.getElementById('vendor-modal-key');
    if (meta.configured && meta.api_key_masked) {
        keyInput.value = meta.api_key_masked;
        keyInput.dataset.masked = '1';
        keyInput.dataset.maskedVal = meta.api_key_masked;
        keyInput.placeholder = '';
    } else {
        keyInput.value = '';
        keyInput.dataset.masked = '';
        keyInput.dataset.maskedVal = '';
        keyInput.placeholder = 'sk-...';
    }

    const clearBtn = document.getElementById('vendor-modal-clear');
    clearBtn.classList.toggle('hidden', !meta.configured);

    fillCatalogForProvider('vendor-modal', providerId);
    bindCatalogControls('vendor-modal', providerId);

    vendorModalState.providerId = providerId;
}

function renderVendorBasePresets(meta) {
    const wrap = document.getElementById('vendor-modal-base-presets');
    const baseInput = document.getElementById('vendor-modal-base');
    if (!wrap || !baseInput) return;
    const presets = (meta.api_base_field && meta.api_base_presets) || [];
    const showChips = currentLang === 'zh';
    wrap.innerHTML = '';
    wrap.classList.toggle('hidden', !(showChips && presets.length));
    baseInput.oninput = null;
    if (!presets.length) return;

    if (!meta.configured && (!meta.api_base || meta.api_base === meta.api_base_default)) {
        baseInput.value = presets[showChips ? 0 : presets.length - 1].value;
    }
    if (showChips) presets.forEach(preset => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.value = preset.value;
        chip.textContent = localizedLabel(preset.label);
        chip.className = 'px-2 py-0.5 rounded-md text-xs border transition-colors cursor-pointer';
        chip.addEventListener('click', () => {
            baseInput.value = preset.value;
            syncVendorBasePresets(presets);
        });
        wrap.appendChild(chip);
    });
    baseInput.oninput = () => syncVendorBasePresets(presets);
    syncVendorBasePresets(presets);
}

function matchBasePreset(presets, base) {
    const domain = (url) => {
        try { return new URL(url).hostname.split('.').slice(-2).join('.'); } catch (e) { return ''; }
    };
    const d = domain((base || '').trim());
    return d ? presets.find(p => domain(p.value) === d) : undefined;
}

function syncVendorBasePresets(presets) {
    const wrap = document.getElementById('vendor-modal-base-presets');
    const active = matchBasePreset(presets, document.getElementById('vendor-modal-base').value);
    wrap.querySelectorAll('button').forEach(chip => {
        const on = !!active && chip.dataset.value === active.value;
        chip.classList.toggle('border-primary-500', on);
        chip.classList.toggle('text-primary-500', on);
        chip.classList.toggle('border-slate-200', !on);
        chip.classList.toggle('dark:border-slate-600', !on);
        chip.classList.toggle('text-slate-500', !on);
    });
    const manageKey = document.getElementById('vendor-modal-manage-key');
    const keysUrl = active && active.keys_url;
    if (manageKey) {
        manageKey.classList.toggle('hidden', !keysUrl);
        if (keysUrl) manageKey.href = keysUrl;
    }
}

function closeVendorModal() {
    document.getElementById('vendor-modal-overlay').classList.add('hidden');
}

// ---------- Model catalog editor (advanced, optional) -------------------

const MODEL_CATALOG_CAPABILITIES = ['text', 'vision', 'image', 'video', 'embedding', 'asr', 'tts'];

const MODEL_CATALOG_TAG_KEYS = {
    text: 'models_tag_chat',
    vision: 'models_tag_vision',
    video: 'models_tag_video',
    image: 'models_tag_image',
    embedding: 'models_tag_embedding',
    asr: 'models_tag_asr',
    tts: 'models_tag_tts',
};

const MODEL_CATALOG_UNBUDGETED = ['embedding', 'image', 'asr', 'tts'];

const catalogDrafts = {};

function _catalogRows(prefix) {
    if (!catalogDrafts[prefix]) catalogDrafts[prefix] = [];
    return catalogDrafts[prefix];
}

function _catalogCapLabel(cap) {
    const key = MODEL_CATALOG_TAG_KEYS[cap];
    return key ? t(key) : cap;
}

/** Render the draft rows for one modal. Each row edits one model entry. */
function renderCatalogRows(prefix) {
    const draft = _catalogRows(prefix);
    const rows = document.getElementById(prefix + '-catalog-rows');
    if (!rows) return;
    const withAlias = prefix === 'custom-provider';
    rows.innerHTML = draft.map((entry, idx) => `
        <div class="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-2.5">
            <div class="flex items-center gap-2 mb-2">
                <input type="text" value="${escapeHtml(entry.name || '')}"
                       placeholder="${escapeHtml(t('models_catalog_name_ph'))}"
                       oninput="updateCatalogRow('${prefix}', ${idx}, 'name', this.value)"
                       class="flex-1 min-w-0 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600
                              bg-white dark:bg-white/5 text-xs text-slate-800 dark:text-slate-100
                              focus:outline-none focus:border-primary-500 font-mono transition-colors">
                ${withAlias ? `<input type="text" value="${escapeHtml(entry.alias || '')}" maxlength="64"
                       placeholder="${escapeHtml(t('models_catalog_alias_ph'))}"
                       title="${escapeHtml(t('models_catalog_alias_tip'))}"
                       oninput="updateCatalogRow('${prefix}', ${idx}, 'alias', this.value)"
                       class="w-[38%] flex-shrink-0 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600
                              bg-white dark:bg-white/5 text-xs text-slate-800 dark:text-slate-100
                              focus:outline-none focus:border-primary-500 transition-colors">` : ''}
                <button type="button" onclick="removeCatalogRow('${prefix}', ${idx})"
                        title="${escapeHtml(t('delete'))}"
                        class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded
                               text-slate-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-50
                               dark:hover:bg-red-900/20 cursor-pointer transition-colors">
                    <i class="fas fa-trash-can text-[11px]"></i>
                </button>
            </div>
            <div class="flex flex-wrap gap-1.5 mb-2">
                ${MODEL_CATALOG_CAPABILITIES.map(cap => {
                    const on = (entry.capabilities || []).includes(cap);
                    return `<button type="button" onclick="toggleCatalogCap('${prefix}', ${idx}, '${cap}')"
                            class="px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors
                                   ${on
                                       ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400'
                                       : 'bg-slate-200/60 dark:bg-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/20'}">
                            ${escapeHtml(_catalogCapLabel(cap))}</button>`;
                }).join('')}
            </div>
            ${(() => {
                const caps = entry.capabilities || [];
                const budgeted = caps.length === 0
                    || caps.some(c => !MODEL_CATALOG_UNBUDGETED.includes(c));
                if (!budgeted) {
                    return `<p class="text-[10px] text-slate-400 dark:text-slate-500">
                            <i class="fas fa-info-circle mr-1"></i>${escapeHtml(t('models_catalog_no_budget'))}</p>`;
                }
                return `<div class="grid grid-cols-2 gap-2">
                    <label class="block">
                        <span class="block text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">${escapeHtml(t('models_catalog_window'))}</span>
                        <input type="number" min="1" value="${entry.context_window || ''}" placeholder="—"
                               oninput="updateCatalogRow('${prefix}', ${idx}, 'context_window', this.value)"
                               class="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-600
                                      bg-white dark:bg-white/5 text-xs text-slate-800 dark:text-slate-100
                                      focus:outline-none focus:border-primary-500 transition-colors">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">${escapeHtml(t('models_catalog_output'))}</span>
                        <input type="number" min="1" value="${entry.max_output_tokens || ''}" placeholder="—"
                               oninput="updateCatalogRow('${prefix}', ${idx}, 'max_output_tokens', this.value)"
                               class="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-600
                                      bg-white dark:bg-white/5 text-xs text-slate-800 dark:text-slate-100
                                      focus:outline-none focus:border-primary-500 transition-colors">
                    </label>
                </div>`;
            })()}
        </div>`).join('');
}

function updateCatalogRow(prefix, idx, field, rawValue) {
    const entry = _catalogRows(prefix)[idx];
    if (!entry) return;
    if (field === 'name' || field === 'alias') {
        entry[field] = rawValue;
        return;
    }
    const n = parseInt(rawValue, 10);
    entry[field] = (rawValue === '' || Number.isNaN(n)) ? '' : n;
}

function toggleCatalogCap(prefix, idx, cap) {
    const entry = _catalogRows(prefix)[idx];
    if (!entry) return;
    const caps = entry.capabilities || [];
    const at = caps.indexOf(cap);
    if (at >= 0) caps.splice(at, 1); else caps.push(cap);
    entry.capabilities = caps;
    const budgeted = caps.length === 0
        || caps.some(c => !MODEL_CATALOG_UNBUDGETED.includes(c));
    if (!budgeted) {
        entry.context_window = '';
        entry.max_output_tokens = '';
    }
    renderCatalogRows(prefix);
}

function addCatalogRow(prefix) {
    _catalogRows(prefix).push({
        name: '', capabilities: ['text'], context_window: '', max_output_tokens: '',
    });
    renderCatalogRows(prefix);
    const rows = document.getElementById(prefix + '-catalog-rows');
    const last = rows && rows.lastElementChild && rows.lastElementChild.querySelector('input');
    if (last) last.focus();
}

function removeCatalogRow(prefix, idx) {
    _catalogRows(prefix).splice(idx, 1);
    renderCatalogRows(prefix);
}

function seedCatalogFromPresets(prefix, providerId) {
    const meta = modelsState.providers.find(p => p.id === providerId);
    const seed = (meta && meta.seed) || [];
    catalogDrafts[prefix] = seed.map(s => ({
        name: s.name,
        capabilities: (s.capabilities || []).slice(),
        context_window: s.context_window || '',
        max_output_tokens: s.max_output_tokens || '',
    }));
    renderCatalogRows(prefix);
}

function clearCatalogRows(prefix) {
    catalogDrafts[prefix] = [];
    renderCatalogRows(prefix);
}

function collectCatalogPayload(prefix) {
    return _catalogRows(prefix)
        .filter(e => (e.name || '').trim())
        .map(e => {
            const out = {
                name: e.name.trim(),
                capabilities: (e.capabilities || []).length ? e.capabilities : ['text'],
            };
            const cw = parseInt(e.context_window, 10);
            const mo = parseInt(e.max_output_tokens, 10);
            if (!Number.isNaN(cw) && cw > 0) out.context_window = cw;
            if (!Number.isNaN(mo) && mo > 0) out.max_output_tokens = mo;
            _setCatalogAlias(out, e.alias);
            return out;
        });
}

const catalogSeeds = {};

function fillCatalogForProvider(prefix, providerId) {
    const meta = modelsState.providers.find(p => p.id === providerId);
    const effective = (meta && meta.effective) || (meta && meta.catalog) || [];
    catalogSeeds[prefix] = ((meta && meta.seed) || []).map(e => ({
        name: e.name || '',
        capabilities: (e.capabilities || []).slice(),
        context_window: e.context_window || '',
        max_output_tokens: e.max_output_tokens || '',
    }));
    catalogDrafts[prefix] = effective.map(e => ({
        name: e.name || '',
        capabilities: (e.capabilities || []).slice(),
        context_window: e.context_window || '',
        max_output_tokens: e.max_output_tokens || '',
        alias: e.alias || '',
    }));
    cancelDiscoverPick(prefix);
    renderCatalogRows(prefix);
    setCatalogSectionOpen(prefix, false);
}

function _normalizeEntries(rows) {
    return rows
        .filter(e => (e.name || '').trim())
        .map(e => {
            const out = {
                name: e.name.trim(),
                capabilities: (e.capabilities || []).length ? e.capabilities : ['text'],
            };
            const cw = parseInt(e.context_window, 10);
            const mo = parseInt(e.max_output_tokens, 10);
            if (!Number.isNaN(cw) && cw > 0) out.context_window = cw;
            if (!Number.isNaN(mo) && mo > 0) out.max_output_tokens = mo;
            _setCatalogAlias(out, e.alias);
            return out;
        });
}

function _setCatalogAlias(out, rawAlias) {
    const alias = (rawAlias || '').trim();
    if (alias && alias !== out.name) out.alias = alias;
}

function setCatalogSectionOpen(prefix, open) {
    const body = document.getElementById(prefix + '-catalog-body');
    const caret = document.getElementById(prefix + '-catalog-caret');
    if (body) body.classList.toggle('hidden', !open);
    if (caret) caret.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
}

function toggleCatalogSection(prefix) {
    const body = document.getElementById(prefix + '-catalog-body');
    if (!body) return;
    setCatalogSectionOpen(prefix, body.classList.contains('hidden'));
}

const catalogDiscoverPicks = {};

function _discoverPickHost(prefix) {
    let el = document.getElementById(prefix + '-catalog-discover-pick');
    if (el) return el;
    const body = document.getElementById(prefix + '-catalog-body');
    if (!body) return null;
    el = document.createElement('div');
    el.id = prefix + '-catalog-discover-pick';
    body.appendChild(el);
    return el;
}

function _catalogEntryFromDiscovered(model) {
    const name = (model && (model.name || model.id)) || '';
    const capabilities = Array.isArray(model.capabilities) && model.capabilities.length
        ? model.capabilities.slice() : ['text'];
    return {
        name,
        capabilities,
        context_window: model.context_window || '',
        max_output_tokens: model.max_output_tokens || '',
    };
}

function renderDiscoverPick(prefix) {
    const host = _discoverPickHost(prefix);
    if (!host) return;
    const pick = catalogDiscoverPicks[prefix];
    if (!pick || !pick.candidates.length) {
        host.innerHTML = '';
        return;
    }
    const selected = pick.selected;
    host.innerHTML = `
        <div class="mt-3 rounded-lg border border-slate-200 dark:border-white/10 p-2.5">
            <div class="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                ${escapeHtml(t('models_catalog_discover_pick'))}
                <span class="font-normal text-slate-400"> · ${selected.size}/${pick.candidates.length}</span>
            </div>
            <div class="max-h-48 overflow-y-auto space-y-1 pr-0.5">
                ${pick.candidates.map((model, idx) => {
                    const checked = selected.has(model.name) ? 'checked' : '';
                    const tags = (model.capabilities || []).map(cap =>
                        `<span class="text-[10px] text-slate-400">${escapeHtml(t(MODEL_CATALOG_TAG_KEYS[cap] || 'models_tag_chat'))}</span>`
                    ).join(' · ');
                    return `<label class="flex items-start gap-2 py-1 cursor-pointer">
                        <input type="checkbox" ${checked} onchange="toggleDiscoverPick('${prefix}', ${idx}, this.checked)"
                               class="mt-0.5 cursor-pointer">
                        <span class="min-w-0">
                            <span class="block text-xs font-mono text-slate-700 dark:text-slate-200 break-all">${escapeHtml(model.name)}</span>
                            <span class="block text-[10px] text-slate-400">${tags}</span>
                        </span>
                    </label>`;
                }).join('')}
            </div>
            <div class="mt-2 flex items-center gap-2">
                <button type="button" onclick="applyDiscoverPick('${prefix}')"
                        class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium
                               bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400
                               hover:bg-primary-100 dark:hover:bg-primary-900/50 cursor-pointer">
                    ${escapeHtml(t('models_catalog_discover_apply'))}
                </button>
                <button type="button" onclick="cancelDiscoverPick('${prefix}')"
                        class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs
                               text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer">
                    ${escapeHtml(t('models_catalog_discover_cancel'))}
                </button>
            </div>
        </div>`;
}

function toggleDiscoverPick(prefix, idx, on) {
    const pick = catalogDiscoverPicks[prefix];
    if (!pick || !pick.candidates[idx]) return;
    const name = pick.candidates[idx].name;
    if (on) pick.selected.add(name);
    else pick.selected.delete(name);
    renderDiscoverPick(prefix);
}

function applyDiscoverPick(prefix) {
    const pick = catalogDiscoverPicks[prefix];
    const status = document.getElementById(prefix + '-status');
    if (!pick) return;
    const draft = _catalogRows(prefix);
    const have = new Set(draft.map(e => (e.name || '').trim()).filter(Boolean));
    let added = 0;
    pick.candidates.forEach(model => {
        if (!pick.selected.has(model.name) || have.has(model.name)) return;
        have.add(model.name);
        draft.push(model);
        added += 1;
    });
    delete catalogDiscoverPicks[prefix];
    renderDiscoverPick(prefix);
    renderCatalogRows(prefix);
    if (status) {
        status.textContent = t('models_catalog_discovered').replace('{n}', added);
        status.classList.remove('opacity-0', 'text-red-500');
        status.classList.add('text-primary-500');
    }
}

function cancelDiscoverPick(prefix) {
    delete catalogDiscoverPicks[prefix];
    renderDiscoverPick(prefix);
}

function discoverCatalogModels(prefix, providerId) {
    const btn = document.getElementById(prefix + '-catalog-discover');
    const status = document.getElementById(prefix + '-status');
    const baseInput = document.getElementById(prefix + '-base');
    const keyInput = document.getElementById(prefix + '-key');
    const apiBase = baseInput ? baseInput.value.trim() : '';
    let apiKey = keyInput ? keyInput.value.trim() : '';
    if (keyInput && keyInput.dataset.masked === '1'
        && apiKey === (keyInput.dataset.maskedVal || '')) {
        apiKey = '';
    }
    if (!apiBase && !providerId) {
        if (status) { status.textContent = t('models_custom_base_required'); status.classList.remove('opacity-0'); }
        return;
    }
    const payload = { action: 'discover_models', provider_id: providerId || '', api_base: apiBase };
    if (apiKey) payload.api_key = apiKey;
    if (btn) btn.disabled = true;
    if (status) {
        status.textContent = t('models_catalog_discovering');
        status.classList.remove('opacity-0', 'text-red-500');
        status.classList.add('text-primary-500');
    }
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (btn) btn.disabled = false;
        if (data.status !== 'success') {
            if (status) {
                status.textContent = data.message || t('models_save_failed');
                status.classList.remove('opacity-0', 'text-primary-500');
                status.classList.add('text-red-500');
            }
            return;
        }
        const have = new Set(_catalogRows(prefix).map(e => (e.name || '').trim()).filter(Boolean));
        const candidates = (data.models || []).map(_catalogEntryFromDiscovered)
            .filter(model => model.name && !have.has(model.name));
        if (!candidates.length) {
            delete catalogDiscoverPicks[prefix];
            renderDiscoverPick(prefix);
            if (status) {
                status.textContent = t('models_catalog_discover_none');
                status.classList.remove('opacity-0', 'text-red-500');
                status.classList.add('text-primary-500');
            }
            return;
        }
        catalogDiscoverPicks[prefix] = {
            candidates,
            selected: new Set(candidates.filter(m => (m.capabilities || []).includes('text')).map(m => m.name)),
        };
        renderDiscoverPick(prefix);
        if (status) {
            status.textContent = '';
            status.classList.add('opacity-0');
        }
    }).catch(() => {
        if (btn) btn.disabled = false;
        if (status) {
            status.textContent = t('models_save_failed');
            status.classList.remove('opacity-0', 'text-primary-500');
            status.classList.add('text-red-500');
        }
    });
}

function bindCatalogControls(prefix, providerIdForSeed) {
    const toggle = document.getElementById(prefix + '-catalog-toggle');
    const add = document.getElementById(prefix + '-catalog-add');
    if (toggle) toggle.onclick = () => toggleCatalogSection(prefix);
    if (add) add.onclick = () => addCatalogRow(prefix);
    const discover = document.getElementById(prefix + '-catalog-discover');
    if (discover) discover.onclick = () => discoverCatalogModels(prefix, providerIdForSeed);
    const seed = document.getElementById(prefix + '-catalog-seed');
    if (seed) seed.onclick = () => seedCatalogFromPresets(prefix, providerIdForSeed);
}

function diffCatalogAgainstSeed(prefix) {
    const seed = _normalizeEntries(catalogSeeds[prefix] || []);
    const draft = collectCatalogPayload(prefix);
    const seedByName = {};
    seed.forEach(e => { seedByName[e.name] = e; });
    const draftNames = new Set(draft.map(e => e.name));

    const overrides = draft.filter(e => {
        const preset = seedByName[e.name];
        return !preset || JSON.stringify(preset) !== JSON.stringify(e);
    });
    const hidden = seed
        .map(e => e.name)
        .filter(name => !draftNames.has(name));
    return { overrides, hidden };
}

function saveCatalogForProvider(prefix, providerId) {
    const meta = modelsState.providers.find(p => p.id === providerId);
    const savedOverrides = (meta && meta.catalog) || [];
    const savedHidden = (meta && meta.hidden) || [];
    const { overrides, hidden } = diffCatalogAgainstSeed(prefix);

    const same = JSON.stringify(overrides) === JSON.stringify(_normalizeEntries(savedOverrides))
        && JSON.stringify([...hidden].sort()) === JSON.stringify([...savedHidden].sort());
    if (same) {
        return Promise.resolve(true);
    }
    return fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'save_catalog', provider_id: providerId,
            models: overrides, hidden: hidden,
        }),
    }).then(r => r.json()).then(data => data.status === 'success').catch(() => false);
}

function saveVendorModal() {
    const providerId = vendorModalState.providerId;
    if (!providerId) return;
    const keyInput = document.getElementById('vendor-modal-key');
    const apiBase = document.getElementById('vendor-modal-base').value.trim();

    let apiKey = keyInput.value.trim();
    const masked = keyInput.dataset.masked === '1';
    const maskedVal = keyInput.dataset.maskedVal || '';
    if (masked && apiKey === maskedVal) {
        apiKey = '';
    }

    if (!apiKey && !masked) {
        keyInput.focus();
        return;
    }

    const btn = document.getElementById('vendor-modal-save');
    btn.disabled = true;
    const payload = { action: 'set_provider', provider_id: providerId, api_base: apiBase };
    if (apiKey) payload.api_key = apiKey;
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            btn.disabled = false;
            showStatus('vendor-modal-status', 'models_save_failed', true);
            return;
        }
        return saveCatalogForProvider('vendor-modal', providerId).then(ok => {
            btn.disabled = false;
            if (!ok) {
                showStatus('vendor-modal-status', 'models_save_failed', true);
                return;
            }
            closeVendorModal();
            const onSaved = vendorModalState.onSaved;
            if (onSaved) {
                try { onSaved(providerId); } catch (e) { /* noop */ }
            } else {
                loadModelsView();
            }
        });
    }).catch(() => {
        btn.disabled = false;
        showStatus('vendor-modal-status', 'models_save_failed', true);
    });
}

function clearVendorModal() {
    const providerId = vendorModalState.providerId;
    if (!providerId) return;
    showConfirmDialog({
        title: t('models_clear_confirm_title'),
        message: t('models_clear_confirm_msg'),
        okText: t('models_clear_credential'),
        cancelText: t('cancel'),
        onConfirm: () => {
            fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_provider', provider_id: providerId }),
            }).then(r => r.json()).then(data => {
                if (data.status === 'success') {
                    closeVendorModal();
                    loadModelsView();
                } else {
                    showStatus('vendor-modal-status', 'models_clear_failed', true);
                }
            }).catch(() => showStatus('vendor-modal-status', 'models_clear_failed', true));
        }
    });
}
