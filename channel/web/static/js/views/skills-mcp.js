/* Capabilities view - MCP server management and diagnostics.
   Split out of views/skills.js. Loaded immediately after views/skills.js
   in the classic global script scope; see channel/web/README.md. */

// ---------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------

let mcpServersCache = [];
let mcpEditorOriginalName = null;
let mcpEditorTab = 'form';
let mcpSaveAnyway = false;
let mcpPollTimer = null;
let mcpPollDeadline = 0;
const MCP_POLL_INTERVAL_MS = 1500;
const MCP_POLL_MAX_MS = 120000;

const MCP_JSON_PLACEHOLDER = JSON.stringify(
    { mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }, null, 2);

const MCP_TRANSPORT_LABELS = { stdio: 'stdio', sse: 'SSE', 'streamable-http': 'HTTP' };

function kvToObject(text) {
    const out = {};
    String(text || '').split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) return;
        out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
    });
    return out;
}

function objectToKv(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
}

function mcpStatusLabel(status) {
    const key = {
        ready: 'mcp_status_ready',
        pending: 'mcp_status_pending',
        failed: 'mcp_status_failed',
        needs_auth: 'mcp_status_needs_auth',
        disabled: 'mcp_status_disabled',
        idle: 'mcp_status_idle',
    }[status] || 'mcp_status_idle';
    return t(key);
}

function mcpStatusClass(status) {
    if (status === 'ready') return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400';
    if (status === 'failed') return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400';
    if (status === 'needs_auth') return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
    if (status === 'disabled') return 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400';
    return 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400';
}

function loadMcpSection() {
    const emptyEl = document.getElementById('mcp-empty');
    const listEl = document.getElementById('mcp-list');
    const badge = document.getElementById('mcp-count-badge');
    if (!listEl) return;
    const errorEl = () => {
        let el = document.getElementById('mcp-load-error');
        if (!el) {
            el = document.createElement('p');
            el.id = 'mcp-load-error';
            el.className = 'text-sm text-red-500 py-2';
            listEl.parentNode.insertBefore(el, listEl);
        }
        return el;
    };
    const showError = (msg) => {
        listEl.classList.add('hidden');
        emptyEl?.classList.add('hidden');
        const el = errorEl();
        el.textContent = msg;
        el.classList.remove('hidden');
    };
    fetch('/api/mcp/servers').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            showError(`${t('mcp_load_failed')}: ${data.message || ''}`);
            return;
        }
        document.getElementById('mcp-load-error')?.classList.add('hidden');
        mcpServersCache = data.servers || [];
        if (badge) {
            badge.textContent = mcpServersCache.length;
            badge.classList.toggle('hidden', mcpServersCache.length === 0);
        }
        emptyEl?.classList.toggle('hidden', mcpServersCache.length > 0);
        listEl.innerHTML = '';
        mcpServersCache.forEach(server => listEl.appendChild(renderMcpCard(server)));
        listEl.classList.toggle('hidden', mcpServersCache.length === 0);
        applyCapabilitiesFilter();
        scheduleMcpStatusPoll();
    }).catch(() => showError(t('mcp_load_failed')));
}

async function reloadMcpServer(name, btn) {
    if (!name) return;
    const icon = btn?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    if (btn) btn.disabled = true;
    try {
        const data = await postJson('/api/mcp/servers/reload', { name });
        if (data.status !== 'success') throw new Error(data.message || t('mcp_save_error'));
        if (typeof _wsToast === 'function') {
            _wsToast(t('mcp_reloading').replace('{name}', name));
        }
        mcpPollDeadline = 0;
        loadMcpSection();
    } catch (err) {
        if (typeof _wsToast === 'function') _wsToast(err.message || t('mcp_save_error'));
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        if (btn) btn.disabled = false;
    }
}

async function toggleMcpServerDisabled(server, switchBtn) {
    if (!server || !server.name) return;
    if (switchBtn) switchBtn.disabled = true;
    try {
        const nextDisabled = !server.disabled && server.status !== 'disabled';
        const nextServers = mcpServersCache.map(item => (
            item.name === server.name
                ? { ...item, disabled: nextDisabled }
                : item
        ));
        await persistMcpServers(nextServers);
    } catch (err) {
        if (typeof _wsToast === 'function') _wsToast(err.message || t('mcp_save_error'));
    } finally {
        if (switchBtn) switchBtn.disabled = false;
    }
}

/** Saved servers start in the background, so keep refreshing while any is still loading. */
function scheduleMcpStatusPoll() {
    clearTimeout(mcpPollTimer);
    if (!mcpServersCache.some(s => s.status === 'pending')) {
        mcpPollDeadline = 0;
        return;
    }
    if (!mcpPollDeadline) mcpPollDeadline = Date.now() + MCP_POLL_MAX_MS;
    if (Date.now() > mcpPollDeadline) return;
    mcpPollTimer = setTimeout(() => {
        // Stop once the view is no longer on screen; opening it again reloads the list.
        if (document.getElementById('mcp-list')?.offsetParent === null) {
            mcpPollDeadline = 0;
            return;
        }
        loadMcpSection();
    }, MCP_POLL_INTERVAL_MS);
}

function renderMcpCardToolsHtml(server) {
    const tools = Array.isArray(server.tools) ? server.tools.filter(x => x && x.name) : [];
    if (!tools.length) return '';
    const expanded = mcpExpandedToolCards.has(server.name);
    const { visibleTools, hiddenCount, total } = formatMcpToolsPreview(tools, expanded, 5);
    const chips = visibleTools.map(tool => (
        `<span class="cap-chip" title="${escapeHtml(tool.description || tool.name)}">${escapeHtml(tool.name)}</span>`
    )).join('');
    const toggleChip = hiddenCount > 0
        ? `<button type="button" data-mcp-tools-toggle class="cap-chip cap-chip-btn">${escapeHtml(t('mcp_tools_more').replace('{n}', String(hiddenCount)))}</button>`
        : (expanded && total > 5
            ? `<button type="button" data-mcp-tools-toggle class="cap-chip cap-chip-btn">${escapeHtml(t('mcp_tools_collapse'))}</button>`
            : '');
    return `<div class="mt-2 flex flex-wrap gap-1">${chips}${toggleChip}</div>`;
}

function renderMcpCard(server) {
    const card = document.createElement('div');
    card.className = 'group bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3 '
        + 'cursor-pointer hover:border-slate-300 dark:hover:border-white/20 transition-colors';
    const type = server.type || (server.url ? 'sse' : 'stdio');
    const summary = type === 'stdio'
        ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
        : (server.url || '');
    const disabled = server.status === 'disabled' || !!server.disabled;
    const enabled = !disabled;
    const tools = Array.isArray(server.tools) ? server.tools.filter(x => x && x.name) : [];
    const toolSearch = tools.map(tool => `${tool.name || ''} ${tool.description || ''}`).join(' ');
    card.dataset.capSearchText = `${server.name || ''} ${summary || ''} ${server.error || ''} ${toolSearch}`;
    const trackClass = enabled ? 'bg-primary-400' : 'bg-slate-200 dark:bg-slate-700';
    const thumbTranslate = enabled ? 'translate-x-3' : 'translate-x-0.5';
    const toolCountBadge = (server.status === 'ready' && tools.length > 0)
        ? `<span class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400">${escapeHtml(t('mcp_tools_count').replace('{n}', String(tools.length)))}</span>`
        : '';
    const showErrorBanner = (server.status === 'failed' || server.status === 'needs_auth') && server.error;
    card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-plug ${disabled ? 'text-slate-300 dark:text-slate-600' : 'text-amber-500'} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm text-slate-700 dark:text-slate-200 truncate font-mono">${escapeHtml(server.name)}</span>
                <span class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400">${escapeHtml(MCP_TRANSPORT_LABELS[type] || type)}</span>
                <span class="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] ${mcpStatusClass(server.status)}">${escapeHtml(mcpStatusLabel(server.status))}</span>
                ${toolCountBadge}
                <span class="flex-1"></span>
                ${enabled ? `<button type="button" data-mcp-reload title="${escapeHtml(t('mcp_reload'))}"
                        class="flex-shrink-0 p-1 -my-1 rounded text-slate-300 dark:text-slate-600 hover:text-primary-500 dark:hover:text-primary-400 transition-colors">
                    <i class="fas fa-rotate-right text-[10px]"></i>
                </button>` : ''}
                <button type="button" data-mcp-edit title="${escapeHtml(t('mcp_edit'))}"
                        class="flex-shrink-0 p-1 -my-1 rounded text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 transition-colors">
                    <i class="fas fa-pen text-[10px]"></i>
                </button>
                <button type="button" data-mcp-delete title="${escapeHtml(t('mcp_delete'))}"
                        class="flex-shrink-0 p-1 -my-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                    <i class="fas fa-trash text-[10px]"></i>
                </button>
                <button type="button" role="switch" data-mcp-switch aria-checked="${enabled}"
                        class="relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${trackClass}"
                        title="${escapeHtml(t(enabled ? 'mcp_disable' : 'mcp_enable'))}">
                    <span class="inline-block h-3 w-3 mt-0.5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${thumbTranslate}"></span>
                </button>
            </div>
            <p class="text-xs text-slate-400 dark:text-slate-500 truncate font-mono" title="${escapeHtml(summary)}">${escapeHtml(summary || '--')}</p>
            ${renderMcpCardToolsHtml(server)}
            ${showErrorBanner ? `<div class="mcp-card-error" title="${escapeHtml(server.error)}">${escapeHtml(server.error)}</div>` : ''}
        </div>`;
    card.onclick = () => openMcpEditor(server);
    const reloadBtn = card.querySelector('[data-mcp-reload]');
    if (reloadBtn) reloadBtn.onclick = (e) => { e.stopPropagation(); reloadMcpServer(server.name, reloadBtn); };
    card.querySelector('[data-mcp-edit]').onclick = (e) => { e.stopPropagation(); openMcpEditor(server); };
    card.querySelector('[data-mcp-delete]').onclick = (e) => { e.stopPropagation(); deleteMcpServer(server.name); };
    const swBtn = card.querySelector('[data-mcp-switch]');
    if (swBtn) swBtn.onclick = (e) => { e.stopPropagation(); toggleMcpServerDisabled(server, swBtn); };
    const toggleToolsBtn = card.querySelector('[data-mcp-tools-toggle]');
    if (toggleToolsBtn) {
        toggleToolsBtn.onclick = (e) => {
            e.stopPropagation();
            if (mcpExpandedToolCards.has(server.name)) mcpExpandedToolCards.delete(server.name);
            else mcpExpandedToolCards.add(server.name);
            const replacement = renderMcpCard(server);
            card.replaceWith(replacement);
            applyCapabilitiesFilter();
        };
    }
    return card;
}

function mcpTransportOptions() {
    return [
        { value: 'stdio', label: 'stdio', hint: t('mcp_transport_stdio_hint') },
        { value: 'sse', label: 'SSE', hint: t('mcp_transport_remote_hint') },
        { value: 'streamable-http', label: 'Streamable HTTP', hint: t('mcp_transport_remote_hint') },
    ];
}

function mcpEditorTransport() {
    return getDropdownValue(document.getElementById('mcp-field-type')) || 'stdio';
}

function syncMcpEditorTransport() {
    setMcpSaveAnyway(false);
    const stdio = mcpEditorTransport() === 'stdio';
    document.getElementById('mcp-stdio-fields')?.classList.toggle('hidden', !stdio);
    document.getElementById('mcp-url-fields')?.classList.toggle('hidden', stdio);
    document.getElementById('mcp-scope-field')?.classList.toggle('hidden', stdio);
}

function setMcpAdvancedOpen(open) {
    document.getElementById('mcp-advanced-fields')?.classList.toggle('hidden', !open);
    const icon = document.getElementById('mcp-advanced-icon');
    if (icon) icon.style.transform = open ? 'rotate(90deg)' : '';
}

function clearMcpResult() {
    setMcpSaveAnyway(false);
    const result = document.getElementById('mcp-test-result');
    if (!result) return;
    result.className = 'cap-result hidden mt-4';
    result.innerHTML = '';
}

function showMcpResult(kind, html) {
    const result = document.getElementById('mcp-test-result');
    result.className = `cap-result ${kind} mt-4`;
    result.innerHTML = html;
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showMcpError(message) {
    showMcpResult('fail', `
        <div class="flex items-start gap-2">
            <i class="fas fa-circle-exclamation mt-0.5"></i>
            <span class="flex-1 min-w-0 break-words">${escapeHtml(message)}</span>
        </div>`);
}

function fillMcpEditor(server) {
    const s = server || {};
    const nameEl = document.getElementById('mcp-field-name');
    nameEl.value = s.name || '';
    nameEl.disabled = !!s.name;
    const type = s.type || (s.url ? 'sse' : 'stdio');
    initDropdown(document.getElementById('mcp-field-type'), mcpTransportOptions(), type, syncMcpEditorTransport);
    document.getElementById('mcp-field-command').value = s.command || '';
    document.getElementById('mcp-field-args').value = (s.args || []).join('\n');
    document.getElementById('mcp-field-env').value = objectToKv(s.env);
    document.getElementById('mcp-field-url').value = s.url || '';
    document.getElementById('mcp-field-headers').value = objectToKv(s.headers);
    document.getElementById('mcp-field-scope').value = s.scope || '';
    document.getElementById('mcp-field-prefix').value = s.tool_name_prefix || '';
    document.getElementById('mcp-field-timeout').value = s.timeout || '';
    document.getElementById('mcp-field-disabled').checked = !!s.disabled || s.status === 'disabled';
    setMcpAdvancedOpen(!!(s.tool_name_prefix || s.timeout || s.scope));
    syncMcpEditorTransport();
}

function readMcpEditor() {
    const type = mcpEditorTransport();
    const cfg = {
        name: document.getElementById('mcp-field-name').value.trim(),
        type,
    };
    const prefix = document.getElementById('mcp-field-prefix').value;
    if (prefix) cfg.tool_name_prefix = prefix;
    if (document.getElementById('mcp-field-disabled').checked) cfg.disabled = true;
    const timeout = document.getElementById('mcp-field-timeout').value.trim();
    if (timeout) cfg.timeout = Number(timeout);
    if (type === 'stdio') {
        cfg.command = document.getElementById('mcp-field-command').value.trim();
        const args = document.getElementById('mcp-field-args').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (args.length) cfg.args = args;
        const env = kvToObject(document.getElementById('mcp-field-env').value);
        if (Object.keys(env).length) cfg.env = env;
    } else {
        cfg.url = document.getElementById('mcp-field-url').value.trim();
        const headers = kvToObject(document.getElementById('mcp-field-headers').value);
        if (Object.keys(headers).length) cfg.headers = headers;
        const scope = document.getElementById('mcp-field-scope').value.trim();
        if (scope) cfg.scope = scope;
    }
    return cfg;
}

/** A server as it is written in mcp.json: no name, no runtime fields, no empty values. */
function mcpConfigForJson(cfg) {
    const out = {};
    Object.entries(cfg || {}).forEach(([key, value]) => {
        if (key === 'name' || key === 'status') return;
        if (key === 'type' && value === 'stdio') return;
        if (value === '' || value === null || value === undefined || value === false) return;
        if (Array.isArray(value) && !value.length) return;
        if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return;
        out[key] = value;
    });
    return out;
}

function mcpServersToJson(servers) {
    const map = {};
    servers.forEach(s => { map[s.name || 'my-server'] = mcpConfigForJson(s); });
    return JSON.stringify({ mcpServers: map }, null, 2);
}

/**
 * Read the JSON pane. Accepts the {"mcpServers": {...}} file format that MCP
 * directories publish, a bare {name: config} map, a list, or one config that
 * carries its own "name".
 */
function parseMcpJson(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error(t('mcp_json_empty'));
    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (err) {
        throw new Error(`${t('mcp_json_invalid')}: ${err.message}`);
    }
    const fromMap = (map) => Object.entries(map).map(([name, cfg]) => {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
            throw new Error(`${t('mcp_json_invalid')}: ${name}`);
        }
        return { ...cfg, name };
    });
    let servers;
    if (Array.isArray(obj)) {
        servers = obj;
    } else if (obj && typeof obj === 'object') {
        if (obj.mcpServers && typeof obj.mcpServers === 'object') {
            servers = fromMap(obj.mcpServers);
        } else if ('command' in obj || 'url' in obj || 'serverUrl' in obj) {
            if (!obj.name) throw new Error(t('mcp_json_need_name'));
            servers = [obj];
        } else {
            servers = fromMap(obj);
        }
    } else {
        throw new Error(t('mcp_json_invalid'));
    }
    servers = servers.map(s => {
        const cfg = { ...s };
        if (!cfg.url && cfg.serverUrl) cfg.url = cfg.serverUrl;
        delete cfg.serverUrl;
        delete cfg.status;
        return cfg;
    });
    if (!servers.length) throw new Error(t('mcp_json_empty'));
    return servers;
}

function switchMcpTab(tab) {
    if (tab === mcpEditorTab) return;
    const jsonEl = document.getElementById('mcp-field-json');
    if (tab === 'json') {
        const cfg = readMcpEditor();
        const touched = cfg.name || cfg.command || cfg.url;
        if (touched) jsonEl.value = mcpServersToJson([cfg]);
    } else if (jsonEl.value.trim()) {
        let servers;
        try {
            servers = parseMcpJson(jsonEl.value);
        } catch (err) {
            showMcpError(err.message);
            return;
        }
        if (servers.length > 1) {
            showMcpError(t('mcp_json_multi_to_form'));
            return;
        }
        const next = { ...servers[0] };
        if (mcpEditorOriginalName) next.name = mcpEditorOriginalName;
        fillMcpEditor(next);
        document.getElementById('mcp-field-name').disabled = !!mcpEditorOriginalName;
    }
    clearMcpResult();
    showMcpTab(tab);
    if (tab === 'json') jsonEl.focus();
}

function showMcpTab(tab) {
    mcpEditorTab = tab;
    document.querySelectorAll('[data-mcp-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mcpTab === tab);
    });
    document.getElementById('mcp-pane-form').classList.toggle('hidden', tab !== 'form');
    document.getElementById('mcp-pane-json').classList.toggle('hidden', tab !== 'json');
}

/** The servers the editor currently describes, whichever tab is showing. */
function readMcpEditorServers() {
    if (mcpEditorTab === 'json') {
        const servers = parseMcpJson(document.getElementById('mcp-field-json').value);
        if (mcpEditorOriginalName && servers.length > 1) throw new Error(t('mcp_json_edit_single'));
        return servers;
    }
    const cfg = readMcpEditor();
    if (!cfg.name) throw new Error(t('mcp_name_required'));
    return [cfg];
}

function openMcpEditor(server) {
    mcpEditorOriginalName = server ? server.name : null;
    showMcpTab('form');
    fillMcpEditor(server);
    document.getElementById('mcp-field-json').value = server ? mcpServersToJson([server]) : '';
    clearMcpResult();
    const title = document.getElementById('mcp-editor-title');
    const key = server ? 'mcp_edit' : 'mcp_add_title';
    title.dataset.i18n = key;
    title.textContent = t(key);
    document.getElementById('mcp-editor-overlay').classList.remove('hidden');
    if (!server) setTimeout(() => document.getElementById('mcp-field-name')?.focus(), 30);
}

function closeMcpEditor() {
    document.getElementById('mcp-editor-overlay').classList.add('hidden');
    document.getElementById('mcp-field-type')?.classList.remove('open');
    mcpEditorOriginalName = null;
}

async function persistMcpServers(servers) {
    const data = await postJson('/api/mcp/servers', { servers }, 'PUT');
    if (data.status !== 'success') throw new Error(data.message || t('mcp_save_error'));
    mcpServersCache = data.servers || servers;
    mcpPollDeadline = 0;
    loadMcpSection();
    return data;
}

/** After a failed check, the next save skips it: the user has seen why and chose to keep the config. */
function setMcpSaveAnyway(on) {
    if (mcpSaveAnyway === on) return;
    mcpSaveAnyway = on;
    const btn = document.getElementById('mcp-editor-save');
    if (!btn) return;
    const key = on ? 'mcp_save_anyway' : 'mcp_save';
    btn.dataset.i18n = key;
    btn.textContent = t(key);
}

async function saveMcpEditor() {
    const btn = document.getElementById('mcp-editor-save');
    const testBtn = document.getElementById('mcp-editor-test');
    if (btn.disabled) return;
    let servers;
    try {
        servers = readMcpEditorServers();
    } catch (err) {
        showMcpError(err.message);
        return;
    }
    const incoming = new Set(servers.map(s => s.name));
    if (!mcpEditorOriginalName) {
        const clash = mcpServersCache.filter(s => incoming.has(s.name)).map(s => s.name);
        if (clash.length) {
            showMcpError(t('mcp_name_exists').replace('{name}', clash.join(', ')));
            return;
        }
    }
    setButtonBusy(btn, true);
    setButtonBusy(testBtn, true);
    try {
        let notice = t('mcp_saved');
        const active = servers.filter(s => !s.disabled);
        if (!mcpSaveAnyway && active.length) {
            const probes = await runMcpCheck(active);
            // A server waiting for authorization can only be authorized once saved.
            if (!probes.every(p => p.ok || p.needs_auth)) {
                appendMcpResultNote(t('mcp_check_failed'));
                setMcpSaveAnyway(true);
                return;
            }
            const toolCount = probes.reduce((sum, p) => sum + (p.tools || []).length, 0);
            if (toolCount) notice = t('mcp_saved_tools').replace('{n}', toolCount);
        }
        const next = mcpServersCache.filter(s => s.name !== mcpEditorOriginalName && !incoming.has(s.name));
        await persistMcpServers(next.concat(servers));
        closeMcpEditor();
        _wsToast(notice);
    } catch (err) {
        showMcpError(err.message || t('mcp_save_error'));
    } finally {
        setButtonBusy(btn, false);
        setButtonBusy(testBtn, false);
    }
}

function renderMcpToolList(tools) {
    if (!tools.length) {
        return `<p class="mt-2 text-xs opacity-80">${escapeHtml(t('mcp_test_no_tools'))}</p>`;
    }
    const chips = tools.map(tool => `<span class="cap-chip" title="${escapeHtml(tool.description || tool.name)}">${escapeHtml(tool.name)}</span>`).join('');
    return `
        <p class="mt-2.5 mb-1.5 text-xs font-medium opacity-80">${escapeHtml(t('mcp_test_tools'))} (${tools.length})</p>
        <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">${chips}</div>`;
}

/** One probe's outcome. In a mixed batch the box is neutral, so each icon carries its own color. */
function renderMcpProbe(probe, withName, mixed) {
    const tools = (probe.tools || []).filter(x => x && x.name);
    const name = withName ? `<span class="font-mono">${escapeHtml(probe.name)}</span><span class="opacity-50">·</span>` : '';
    if (probe.ok) {
        const color = mixed ? 'text-emerald-500' : '';
        return `
            <div class="flex items-center gap-2 font-medium">
                <i class="fas fa-circle-check ${color}"></i>${name}<span>${escapeHtml(t('mcp_test_ok'))}</span>
            </div>
            ${renderMcpToolList(tools)}`;
    }
    const color = mixed ? 'text-red-500' : '';
    const detail = probe.needs_auth ? t('mcp_test_needs_auth') : (probe.error || '');
    return `
        <div class="flex items-center gap-2 font-medium">
            <i class="fas fa-circle-xmark ${color}"></i>${name}<span>${escapeHtml(t('mcp_test_fail'))}</span>
        </div>
        ${detail ? `<p class="mt-1.5 text-xs break-words opacity-90">${escapeHtml(detail)}</p>` : ''}`;
}

async function probeMcpServer(cfg) {
    try {
        const data = await postJson('/api/mcp/servers/test', { server: { ...cfg, disabled: false } });
        return { name: cfg.name, ...data };
    } catch (err) {
        return { name: cfg.name, ok: false, error: err.message || '' };
    }
}

/** Probe every server and show the outcome in the result box. */
async function runMcpCheck(servers) {
    showMcpResult('info', `
        <div class="flex items-center gap-2">
            <i class="fas fa-spinner fa-spin text-xs"></i><span>${escapeHtml(t('mcp_testing'))}</span>
        </div>`);
    const probes = await Promise.all(servers.map(probeMcpServer));
    const okCount = probes.filter(p => p.ok).length;
    const mixed = okCount > 0 && okCount < probes.length;
    const multi = probes.length > 1;
    const html = probes.map(p => `<div class="${multi ? 'py-2 first:pt-0 last:pb-0' : ''}">${renderMcpProbe(p, multi, mixed)}</div>`).join(
        multi ? '<div class="border-t border-current opacity-10"></div>' : '');
    showMcpResult(mixed ? 'info' : (okCount ? 'ok' : 'fail'), html);
    return probes;
}

function appendMcpResultNote(message) {
    const result = document.getElementById('mcp-test-result');
    if (!result) return;
    result.insertAdjacentHTML('beforeend',
        `<div class="mt-2.5 mb-2 border-t border-current opacity-10"></div><p class="text-xs font-medium">${escapeHtml(message)}</p>`);
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function testMcpEditor() {
    const btn = document.getElementById('mcp-editor-test');
    if (btn.disabled) return;
    let servers;
    try {
        servers = readMcpEditorServers();
    } catch (err) {
        showMcpError(err.message);
        return;
    }
    setButtonBusy(btn, true);
    const icon = document.getElementById('mcp-editor-test-icon');
    icon.className = 'fas fa-spinner fa-spin text-xs';
    try {
        await runMcpCheck(servers);
    } finally {
        setButtonBusy(btn, false);
        icon.className = 'fas fa-plug-circle-check text-xs';
    }
}

function deleteMcpServer(name) {
    showConfirmDialog({
        title: t('mcp_delete'),
        message: t('mcp_delete_confirm'),
        okText: t('mcp_delete'),
        onConfirm: async () => {
            try {
                await persistMcpServers(mcpServersCache.filter(s => s.name !== name));
            } catch (err) {
                _wsToast(err.message || t('mcp_save_error'));
            }
        },
    });
}
