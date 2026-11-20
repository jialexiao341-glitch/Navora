/* Capabilities view: built-in tools, MCP tools, and installed skills.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Capabilities View
// =====================================================================
let toolsLoaded = false;
let toolsExpanded = false;
let capabilitiesSearchQuery = '';
const mcpExpandedToolCards = new Set();
const TOOLS_COLLAPSED_COUNT = 4;

function matchesCapabilityQuery(fields, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const tokens = q.split(/\s+/).filter(Boolean);
    const haystack = (Array.isArray(fields) ? fields : [fields])
        .map(v => String(v || ''))
        .join('\n')
        .toLowerCase();
    return tokens.every(tok => haystack.includes(tok));
}

function filterCapabilityItems(items, query, extractor) {
    const list = Array.isArray(items) ? items : [];
    const q = String(query || '').trim();
    if (!q) return list.slice();
    return list.filter(item => matchesCapabilityQuery(extractor(item), q));
}

function formatMcpToolsPreview(tools, expanded = false, limit = 5) {
    const list = Array.isArray(tools) ? tools.filter(x => x && x.name) : [];
    if (expanded || list.length <= limit) {
        return { visibleTools: list, hiddenCount: 0, total: list.length };
    }
    return {
        visibleTools: list.slice(0, limit),
        hiddenCount: list.length - limit,
        total: list.length,
    };
}

const TOOL_ICONS = {
    bash: 'fa-terminal',
    edit: 'fa-pen-to-square',
    read: 'fa-file-lines',
    write: 'fa-file-pen',
    ls: 'fa-folder-open',
    send: 'fa-paper-plane',
    web_search: 'fa-magnifying-glass',
    browser: 'fa-globe',
    env_config: 'fa-key',
    scheduler: 'fa-clock',
    time: 'fa-calendar-day',
    memory_get: 'fa-brain',
    memory_search: 'fa-brain',
};

function getToolIcon(name) {
    return TOOL_ICONS[name] || 'fa-wrench';
}

function loadSkillsView() {
    bindSkillsConfigUi();
    loadToolsSection();
    loadMcpSection();
    loadSkillsSection();
}

let skillsConfigUiBound = false;

function bindSkillsConfigUi() {
    if (skillsConfigUiBound) return;
    skillsConfigUiBound = true;
    const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);

    on('tools-toggle-btn', 'click', () => { toolsExpanded = !toolsExpanded; applyToolsCollapse(); });
    on('capabilities-search', 'input', (e) => {
        capabilitiesSearchQuery = e.target.value || '';
        applyCapabilitiesFilter();
    });
    on('capabilities-search-clear', 'click', () => {
        const input = document.getElementById('capabilities-search');
        if (input) {
            input.value = '';
            input.focus();
        }
        capabilitiesSearchQuery = '';
        applyCapabilitiesFilter();
    });

    on('mcp-add-btn', 'click', () => openMcpEditor());
    on('mcp-editor-cancel', 'click', closeMcpEditor);
    on('mcp-editor-test', 'click', testMcpEditor);
    on('mcp-editor-save', 'click', saveMcpEditor);
    on('mcp-advanced-toggle', 'click', () => setMcpAdvancedOpen(
        document.getElementById('mcp-advanced-fields').classList.contains('hidden')));
    on('mcp-editor-overlay', 'click', (e) => { if (e.target.id === 'mcp-editor-overlay') closeMcpEditor(); });
    on('mcp-editor-overlay', 'input', () => setMcpSaveAnyway(false));
    on('mcp-editor-overlay', 'change', () => setMcpSaveAnyway(false));
    document.querySelectorAll('[data-mcp-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchMcpTab(btn.dataset.mcpTab));
    });
    const jsonEl = document.getElementById('mcp-field-json');
    if (jsonEl) jsonEl.placeholder = MCP_JSON_PLACEHOLDER;

    bindSkillAddUi();

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.getElementById('mcp-editor-overlay')?.classList.contains('hidden')) closeMcpEditor();
        else if (!document.getElementById('skill-add-overlay')?.classList.contains('hidden')) closeSkillAdd();
    });
}

function setButtonBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
}

async function postJson(url, body, method) {
    const res = await fetch(url, {
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

// ---------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------

function applyCapabilitiesFilter() {
    const query = capabilitiesSearchQuery.trim();
    const clearBtn = document.getElementById('capabilities-search-clear');
    const metaEl = document.getElementById('capabilities-search-meta');
    const emptyEl = document.getElementById('capabilities-search-empty');
    clearBtn?.classList.toggle('hidden', !query);

    let matchedTotal = 0;

    // 1. Built-in tools
    const toolsList = document.getElementById('tools-list');
    const toolsSection = document.getElementById('tools-section');
    let toolsShown = 0;
    if (toolsList && toolsLoaded) {
        const cards = Array.from(toolsList.children);
        cards.forEach((card, i) => {
            const ok = !query || matchesCapabilityQuery(card.dataset.capSearchText || '', query);
            if (ok) toolsShown += 1;
            const visible = query ? ok : (toolsExpanded || i < TOOLS_COLLAPSED_COUNT);
            card.classList.toggle('hidden', !visible);
        });
        matchedTotal += toolsShown;
        const toggleBtn = document.getElementById('tools-toggle-btn');
        if (toggleBtn) toggleBtn.classList.toggle('hidden', !!query || cards.length <= TOOLS_COLLAPSED_COUNT);
        toolsList.classList.toggle('hidden', toolsShown === 0);
        toolsSection?.classList.toggle('hidden', !!query && toolsShown === 0);
    } else {
        toolsSection?.classList.remove('hidden');
    }

    // 2. MCP servers
    const mcpList = document.getElementById('mcp-list');
    const mcpSection = document.getElementById('mcp-section');
    let mcpShown = 0;
    if (mcpList && mcpServersCache.length) {
        Array.from(mcpList.children).forEach(card => {
            const ok = !query || matchesCapabilityQuery(card.dataset.capSearchText || '', query);
            card.classList.toggle('hidden', !ok);
            if (ok) mcpShown += 1;
        });
        matchedTotal += mcpShown;
        mcpList.classList.toggle('hidden', mcpShown === 0);
        mcpSection?.classList.toggle('hidden', !!query && mcpShown === 0);
    } else {
        mcpSection?.classList.toggle('hidden', !!query);
    }

    // 3. Skills
    const skillsList = document.getElementById('skills-list');
    const skillsSection = document.getElementById('skills-section');
    let skillsShown = 0;
    if (skillsList && skillsList.children.length) {
        Array.from(skillsList.children).forEach(card => {
            const ok = !query || matchesCapabilityQuery(card.dataset.capSearchText || '', query);
            card.classList.toggle('hidden', !ok);
            if (ok) skillsShown += 1;
        });
        matchedTotal += skillsShown;
        skillsList.classList.toggle('hidden', skillsShown === 0);
        skillsSection?.classList.toggle('hidden', !!query && skillsShown === 0);
    } else if (query && !skillsList?.children.length) {
        skillsSection?.classList.add('hidden');
    } else {
        skillsSection?.classList.remove('hidden');
    }

    if (metaEl) {
        metaEl.textContent = t('capabilities_search_matches').replace('{n}', String(matchedTotal));
        metaEl.classList.toggle('hidden', !query);
    }
    emptyEl?.classList.toggle('hidden', !query || matchedTotal > 0);
}

function applyToolsCollapse() {
    applyCapabilitiesFilter();
    const label = document.getElementById('tools-toggle-label');
    if (label) {
        const key = toolsExpanded ? 'tools_collapse' : 'tools_show_all';
        label.dataset.i18n = key;
        label.textContent = t(key);
    }
    const icon = document.getElementById('tools-toggle-icon');
    if (icon) icon.style.transform = toolsExpanded ? 'rotate(180deg)' : '';
}

function loadToolsSection() {
    if (toolsLoaded) return;
    const emptyEl = document.getElementById('tools-empty');
    const listEl = document.getElementById('tools-list');
    const badge = document.getElementById('tools-count-badge');
    const showEmpty = (key) => {
        emptyEl.classList.remove('hidden');
        emptyEl.innerHTML = `<span class="text-sm text-slate-400 dark:text-slate-500">${escapeHtml(t(key))}</span>`;
    };

    fetch('/api/tools').then(r => r.json()).then(data => {
        if (data.status !== 'success') { showEmpty('tools_load_failed'); return; }
        const tools = data.tools || [];
        emptyEl.classList.add('hidden');
        if (tools.length === 0) { showEmpty('tools_empty'); return; }
        badge.textContent = tools.length;
        badge.classList.remove('hidden');
        listEl.innerHTML = '';
        tools.forEach(tool => {
            const card = document.createElement('div');
            card.className = 'bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3';
            card.dataset.capSearchText = `${tool.name || ''} ${tool.description || ''}`;
            card.innerHTML = `
                <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                    <i class="fas ${getToolIcon(tool.name)} text-blue-500 dark:text-blue-400 text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <span class="block font-medium text-sm text-slate-700 dark:text-slate-200 font-mono truncate">${escapeHtml(tool.name)}</span>
                    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2">${escapeHtml(tool.description || '--')}</p>
                </div>`;
            listEl.appendChild(card);
        });
        listEl.classList.remove('hidden');
        toolsLoaded = true;
        applyToolsCollapse();
    }).catch(() => showEmpty('tools_load_failed'));
}


// MCP servers and skill installation/authoring workflows live in
// views/skills-mcp.js and views/skills-add.js, loaded immediately after this file.
// ---------------------------------------------------------------------
// Installed skills
// ---------------------------------------------------------------------

function deleteSkill(name) {
    showConfirmDialog({
        title: t('skill_delete'),
        message: t('skill_delete_confirm'),
        okText: t('skill_delete'),
        onConfirm: async () => {
            try {
                const data = await postJson('/api/skills', { action: 'delete', name });
                if (data.status !== 'success') throw new Error(data.message || t('skill_delete_error'));
                loadSkillsSection();
            } catch (err) {
                _wsToast(err.message || t('skill_delete_error'));
            }
        },
    });
}

/** Reload the skill cards; `highlight` names get a brief ring so a fresh install is easy to spot. */
function loadSkillsSection(highlight) {
    const emptyEl = document.getElementById('skills-empty');
    const listEl = document.getElementById('skills-list');
    const badge = document.getElementById('skills-count-badge');
    const fresh = new Set(highlight || []);

    return fetch('/api/skills').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const skills = data.skills || [];
        badge.textContent = skills.length;
        badge.classList.toggle('hidden', skills.length === 0);
        listEl.innerHTML = '';
        if (skills.length === 0) {
            emptyEl.classList.remove('hidden');
            const title = emptyEl.querySelector('p');
            if (title) { title.dataset.i18n = 'skills_empty'; title.textContent = t('skills_empty'); }
            const desc = emptyEl.querySelectorAll('p')[1];
            if (desc) { desc.dataset.i18n = 'skills_empty_hint'; desc.textContent = t('skills_empty_hint'); }
            return;
        }
        emptyEl.classList.add('hidden');

        skills.forEach(sk => {
            const card = document.createElement('div');
            card.className = 'bg-panel rounded-xl border border-slate-200 dark:border-white/10 '
                + 'p-4 flex items-start gap-3 transition-opacity cursor-pointer '
                + 'hover:border-slate-300 dark:hover:border-white/20';
            card.dataset.skillName = sk.name;
            card.dataset.skillDesc = sk.display_description || sk.description || '';
            card.dataset.skillDisplayName = sk.display_name || '';
            card.dataset.enabled = sk.enabled ? '1' : '0';
            card.dataset.deletable = sk.deletable ? '1' : '0';
            card.dataset.capSearchText = `${sk.name || ''} ${sk.display_name || ''} ${sk.display_description || sk.description || ''}`;
            renderSkillCard(card, sk);
            if (fresh.has(sk.name)) {
                card.classList.add('cap-flash');
                setTimeout(() => card.classList.remove('cap-flash'), 2600);
            }
            listEl.appendChild(card);
        });
        applyCapabilitiesFilter();
    }).catch(() => {});
}

function renderSkillCard(card, sk) {
    const enabled = sk.enabled;
    const iconColor = enabled ? 'text-primary-500' : 'text-slate-300 dark:text-slate-600';
    const trackClass = enabled
        ? 'bg-primary-400'
        : 'bg-slate-200 dark:bg-slate-700';
    const thumbTranslate = enabled ? 'translate-x-3' : 'translate-x-0.5';
    const sourceBadge = sk.deletable === false
        ? `<span class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400">${escapeHtml(t('skill_badge_builtin'))}</span>`
        : (sk.version
            ? `<span class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400">v${escapeHtml(String(sk.version))}</span>`
            : '');
    card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-bolt ${iconColor} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm text-slate-700 dark:text-slate-200 truncate">${escapeHtml(sk.display_name || sk.name)}</span>
                ${sourceBadge}
                <span class="flex-1"></span>
                <button
                    data-skill-edit
                    class="flex-shrink-0 p-1 -mx-1 -mt-1.5 -mb-1 rounded text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    title="${t('skill_edit_hint')}"
                >
                    <i class="fas fa-pen text-[10px]"></i>
                </button>
                ${sk.deletable ? `
                <button
                    data-skill-delete
                    class="flex-shrink-0 p-1 -mx-1 -mt-1.5 -mb-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    title="${t('skill_delete')}"
                >
                    <i class="fas fa-trash text-[10px]"></i>
                </button>` : ''}
                <button
                    role="switch"
                    data-skill-switch
                    aria-checked="${enabled}"
                    class="relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${trackClass}"
                    title="${t(enabled ? 'skill_click_disable' : 'skill_click_enable')}"
                >
                    <span class="inline-block h-3 w-3 mt-0.5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${thumbTranslate}"></span>
                </button>
            </div>
            <p class="text-xs text-slate-400 dark:text-slate-500 line-clamp-2">${escapeHtml(sk.display_description || sk.description || '--')}</p>
        </div>`;

    // Bound here rather than written into the markup above: a skill name comes
    // from its own frontmatter, and one containing a quote would break out of
    // an inline onclick attribute.
    card.title = t('skill_open_hint');
    card.onclick = () => openSkillFile(sk.name);
    const editBtn = card.querySelector('[data-skill-edit]');
    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openSkillFile(sk.name, { edit: true });
        };
    }
    const deleteBtn = card.querySelector('[data-skill-delete]');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSkill(sk.name);
        };
    }
    const sw = card.querySelector('[data-skill-switch]');
    if (sw) {
        sw.onclick = (e) => {
            e.stopPropagation();
            toggleSkill(sk.name, enabled);
        };
    }
}

function toggleSkill(name, currentlyEnabled) {
    const action = currentlyEnabled ? 'close' : 'open';
    const card = document.querySelector(`[data-skill-name="${CSS.escape(name)}"]`);
    if (card) card.style.opacity = '0.5';

    postJson('/api/skills', { action, name })
    .then(data => {
        if (card) card.style.opacity = '1';
        if (data.status !== 'success') {
            _wsToast(t('skill_toggle_error'));
            return;
        }
        if (card) {
            card.dataset.enabled = currentlyEnabled ? '0' : '1';
            renderSkillCard(card, {
                name: name,
                description: card.dataset.skillDesc || '',
                display_name: card.dataset.skillDisplayName || '',
                enabled: !currentlyEnabled,
                deletable: card.dataset.deletable === '1',
            });
        }
    })
    .catch(() => {
        if (card) card.style.opacity = '1';
        _wsToast(t('skill_toggle_error'));
    });
}

// ---------------------------------------------------------------------
// Skill viewer / editor
// ---------------------------------------------------------------------

/** The files of the skill the viewer has open, as `/api/skills/files` listed them. */
let _skillFiles = [];
/** Directories the reader has folded away, by path. Empty means all open. */
let _skillFoldedDirs = new Set();
// Counts the reads the viewer has asked for, so a slow one that lands after the
// reader has already moved on to another file is dropped instead of replacing
// what they are looking at now.
let _skillReadSeq = 0;
// Whether the file list is showing at all. Remembered across sessions: someone
// who reads skills on a narrow window should not have to fold it away again on
// every visit.
const SKILL_FILES_PANEL_KEY = 'cow_skill_files_panel';
let _skillFilesPanelOpen = typeof localStorage !== 'undefined'
    ? localStorage.getItem(SKILL_FILES_PANEL_KEY) !== '0'
    : true;

/**
 * A skill is addressed by name, not by path: which directory a name resolves to
 * is the loader's business, and a builtin skill lives outside the workspace
 * that the file APIs are confined to. `path` then names one file inside that
 * directory, and defaults to the skill's own SKILL.md.
 */
async function skillReadContent(name, path) {
    const query = `name=${encodeURIComponent(name)}`
        + (path ? `&path=${encodeURIComponent(path)}` : '');
    const res = await fetch(`/api/skills/content?${query}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'read failed');
    return data;
}

/** Save one of a skill's files. Returns the raw response, a conflict included. */
async function skillWriteContent(name, path, content, expectedMtime) {
    const res = await fetch('/api/skills/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name, path: path || '', content: content, expected_mtime: expectedMtime,
        }),
    });
    return res.json();
}

/** The files a skill is made of. Empty on failure: the tree is not the point. */
async function skillListFiles(name) {
    try {
        const res = await fetch(`/api/skills/files?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        return data.status === 'success' ? (data.files || []) : [];
    } catch (e) {
        return [];
    }
}

/** The i18n key explaining why a skill cannot be edited, or null if it can. */
function skillReadonlyReason(data) {
    if (data.editable) return null;
    // Not `source === 'builtin'`: the workspace copy of a builtin skill reads
    // back as `custom` and is refused all the same, so the server says so.
    if (data.ships_with_install) return 'skill_builtin_readonly';
    return docUneditableReason(data);
}

/** Drop the surrounding quotes a YAML scalar may carry. */
function yamlScalar(raw) {
    return raw.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Split a skill's SKILL.md into its YAML frontmatter fields and the markdown
 * body. The `---` header is metadata, not prose: fed to the markdown renderer
 * as-is it turns into a giant bold heading and a horizontal rule. Pull it out
 * so the viewer can present name/description as a proper header instead.
 *
 * Frontmatter nests: `metadata.cowagent.requires.anyEnv` is a list four levels
 * down. Read line by line with no regard for indentation, each container key
 * showed up as an empty row and the list under it vanished. So this walks the
 * indentation instead: a nested map becomes one row per leaf, keyed by its
 * dotted path; a list or a block scalar (`|`, `>`) becomes one row with its
 * lines joined. Only leaves are rows - a key that merely holds others has
 * nothing to say on its own. Kept in step with the desktop client's copy.
 *
 * @returns {{fields: Array<[string, string]>, body: string}}
 */
function parseSkillFrontmatter(content) {
    const text = content || '';
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!match) return { fields: [], body: text };

    const fields = [];
    // The key at each indentation level above the current line.
    const path = [];
    // A key whose value is still being collected from the lines below it: the
    // items of a list, or the lines of a block scalar.
    let open = null;

    const flush = () => {
        if (!open) return;
        fields.push([open.key, open.block ? open.items.join(' ').trim() : open.items.join(', ')]);
        open = null;
    };

    for (const raw of match[1].split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const indent = raw.length - raw.trimStart().length;
        // Inside a block scalar a `#` line is text, not a comment.
        if (open && open.block && indent > open.indent) {
            open.items.push(line);
            continue;
        }
        if (line.startsWith('#')) continue;
        // A list's dashes may sit level with their key or under it.
        if (open && !open.block && indent >= open.indent && line.startsWith('- ')) {
            open.items.push(yamlScalar(line.slice(2)));
            continue;
        }
        // Anything else ends an open value: what follows is the next key, or -
        // under a key opened as a possible list - the first key of a map.
        flush();

        while (path.length && path[path.length - 1].indent >= indent) path.pop();
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = yamlScalar(line.slice(0, idx));
        if (!key) continue;
        const dotted = [...path.map(p => p.key), key].join('.');
        const rest = line.slice(idx + 1).trim();

        if (!rest) {
            // A nested map, or a list starting on the next line: the line that
            // follows decides, so open both readings.
            path.push({ indent, key });
            open = { key: dotted, indent, items: [], block: false };
        } else if (/^[|>][-+0-9]*$/.test(rest)) {
            open = { key: dotted, indent, items: [], block: true };
        } else {
            fields.push([dotted, yamlScalar(rest)]);
        }
    }
    flush();

    // A container key opened as a possible list but then held a map instead:
    // its children have their own rows, so drop the empty one it left behind.
    return { fields: fields.filter(([, value]) => value !== ''), body: text.slice(match[0].length) };
}

/** How one of the open skill's files was listed, or null if it is not in the tree. */
function skillFileEntry(path) {
    return _skillFiles.find(file => file.path === path) || null;
}

/**
 * Render one of a skill's files into the viewer.
 *
 * A markdown file - the SKILL.md above all - is rendered as prose, with its
 * frontmatter lifted out into a header: fed to the markdown renderer as-is the
 * `---` block turns into a giant bold heading and a horizontal rule. Anything
 * else is a script or a data file, and reads as code.
 */
function skillRenderBody(doc) {
    const el = document.getElementById('skill-viewer-content');
    if (!el) return;

    const entry = skillFileEntry(doc.path);
    // A bundled asset belongs in the tree - it is part of the skill - but
    // showing it here would only print mojibake. A text file that merely lost a
    // byte to the decoder is still shown, with the read-only badge saying why:
    // partial content beats no content, as it does in the workspace preview.
    if (entry && !entry.text) {
        el.innerHTML = `
            <div class="py-12 flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                <i class="fas fa-file-circle-question text-xl"></i>
                <span class="text-sm">${escapeHtml(t('skill_file_not_text'))}</span>
            </div>`;
        return;
    }

    const isMarkdown = entry ? entry.kind === 'markdown'
                             : /\.(md|markdown)$/i.test(doc.path || '');
    if (!isMarkdown) {
        // Only a real extension names a language: left unguarded a `LICENSE`
        // would be labelled one, and the highlighter asked to find it.
        const filename = (doc.path || '').split('/').pop();
        const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
        el.innerHTML = '<div class="msg-content"><pre><code'
            + (ext ? ` class="language-${escapeHtml(ext)}"` : '') + '>'
            + `${escapeHtml(doc.content || '')}</code></pre></div>`;
        applyHighlighting(el);
        return;
    }

    const { fields, body } = parseSkillFrontmatter(doc.content);
    let headerHtml = '';
    if (fields.length) {
        // A dotted path may wrap, but only at its dots. escapeHtml leaves `"`
        // alone, and a third-party SKILL.md picks these keys.
        const rows = fields.map(([key, value]) => `
            <dt title="${escapeHtml(key).replace(/"/g, '&quot;')}">${key.split('.').map(escapeHtml).join('.<wbr>')}</dt>
            <dd>${escapeHtml(value)}</dd>`).join('');
        headerHtml = `<dl class="skill-frontmatter">${rows}</dl>`;
    }

    el.innerHTML = headerHtml + `<div class="msg-content">${renderMarkdown(body || '')}</div>`;
    applyHighlighting(el);
}

const skillEditor = typeof createDocEditor === 'function' ? createDocEditor({
    body: () => document.getElementById('skill-viewer-content'),
    buttons: () => ({
        edit: document.getElementById('skill-btn-edit'),
        save: document.getElementById('skill-btn-save'),
        cancel: document.getElementById('skill-btn-cancel'),
    }),
    read: (doc) => skillReadContent(doc.name, doc.path),
    write: (doc, content, mtime) => skillWriteContent(doc.name, doc.path, content, mtime),
    render: (doc) => skillRenderBody(doc),
    canEdit: (doc) => !doc.readonlyKey,
    refusal: skillReadonlyReason,
    onState: (state) => docRenderTitle('skill-viewer-title', skillViewerTitle(), state),
}) : null;

/**
 * Say in the header why the file on screen cannot be edited, or say nothing.
 *
 * Per file rather than per skill: the reason a bundled PNG is read-only is not
 * the reason a builtin's SKILL.md is, and the edit button is hidden either way.
 */
function skillShowReadonlyBadge(readonlyKey) {
    const badge = document.getElementById('skill-viewer-readonly');
    if (!badge) return;
    badge.classList.toggle('hidden', !readonlyKey);
    if (!readonlyKey) return;
    // Keep data-i18n in step so a language switch re-translates it.
    badge.dataset.i18n = readonlyKey;
    badge.textContent = t(readonlyKey);
    badge.title = t(readonlyKey);
}

/** What the viewer's header reads: the skill, and which of its files is open. */
function skillViewerTitle() {
    const doc = skillEditor.current();
    if (!doc) return '';
    return doc.path ? `${doc.name}/${doc.path}` : doc.name;
}

/**
 * Open a skill in the viewer: its file tree, and one of its files.
 *
 * @param opts.edit - jump straight into editing, as the pencil on a card does.
 * @param opts.path - which file to show; the skill's SKILL.md by default.
 */
function openSkillFile(name, opts) {
    const startEditing = !!(opts && opts.edit);
    const path = (opts && opts.path) || '';
    const mine = ++_skillReadSeq;
    // The tree is fetched alongside the file rather than after it, so opening a
    // skill is one round trip either way.
    Promise.all([skillReadContent(name, path), skillListFiles(name)]).then(([data, files]) => {
        if (mine !== _skillReadSeq) return;
        const readonlyKey = skillReadonlyReason(data);
        skillShowReadonlyBadge(readonlyKey);
        document.getElementById('skills-panel-list').classList.add('hidden');
        document.getElementById('skills-panel-viewer').classList.remove('hidden');
        _skillFiles = files;
        // Another skill's tree: the folds belonged to the previous one.
        _skillFoldedDirs = new Set();
        skillEditor.open({
            name: data.name || name,
            // As the server resolved it, so the tree's highlight matches the
            // file on screen even when the caller passed no path at all.
            path: data.filename || path,
            content: data.content || '',
            readonlyKey: readonlyKey,
        });
        renderSkillFilesTree();
        // The pencil on a card jumps straight into editing, skipping the
        // read-only view - but only where the skill is actually editable.
        if (startEditing && !readonlyKey) skillEditor.start();
    }).catch(e => {
        if (mine === _skillReadSeq) _wsToast(`${t('skill_load_failed')}: ${e.message}`);
    });
}

/**
 * Draw the open skill's files, indented by the depth the server listed them at.
 *
 * Shown even for a skill that is only its SKILL.md: the panel is what says what
 * a skill is made of, and "one file, this big" is an answer to that. It only
 * goes away when the listing could not be fetched at all, where an empty tree
 * beside the file on screen would just look broken.
 */
function renderSkillFilesTree() {
    const panel = document.getElementById('skill-files-panel');
    const tree = document.getElementById('skill-files-tree');
    if (!panel || !tree) return;

    // One switch for both states, riding the border the list would sit
    // against: the divider while the list is out, the card's own edge once it
    // is folded away. Gone where there is no listing - with nothing to show, a
    // switch that folds nothing away is just a dead button.
    const listed = _skillFiles.length > 0;
    const show = listed && _skillFilesPanelOpen;
    const toggle = document.getElementById('skill-files-toggle');
    if (toggle) {
        toggle.classList.toggle('hidden', !listed);
        toggle.classList.toggle('is-open', show);
        toggle.setAttribute('aria-expanded', String(show));
        // Keep the data-i18n keys in step so a language switch re-translates
        // the tip for the state on screen, not the one the markup started in.
        const tipKey = show ? 'skill_files_collapse' : 'skill_files_expand';
        toggle.dataset.i18nTitle = tipKey;
        toggle.dataset.i18nAriaLabel = tipKey;
        toggle.title = t(tipKey);
        toggle.setAttribute('aria-label', t(tipKey));
        const icon = toggle.querySelector('i');
        if (icon) icon.className = `fas fa-chevron-${show ? 'left' : 'right'}`;
    }
    panel.classList.toggle('hidden', !show);
    if (!show) {
        tree.innerHTML = '';
        return;
    }

    const current = skillEditor.current()?.path;
    tree.innerHTML = '';
    _skillFiles.forEach(file => {
        if (skillPathIsFolded(file.path)) return;
        const folded = _skillFoldedDirs.has(file.path);
        const row = document.createElement('button');
        row.className = 'skill-file-row' + (file.path === current ? ' active' : '')
            + (file.is_dir ? ' skill-file-dir' : '');
        // 6 + the row's 6px inset puts depth 0 under the panel title.
        row.style.paddingLeft = `${6 + file.depth * 13}px`;
        row.title = file.path;
        // A caret only where there is something to fold; the others keep its
        // width so every name in one directory still starts at one column.
        row.innerHTML = (file.is_dir
            ? `<i class="fas fa-chevron-${folded ? 'right' : 'down'} skill-file-caret"></i>`
            : '<span class="skill-file-caret"></span>')
            + `<i class="fas ${file.is_dir ? (folded ? 'fa-folder' : 'fa-folder-open') : 'fa-file-lines'} skill-file-icon"></i>`
            + `<span class="flex-1 min-w-0 truncate">${escapeHtml(file.name)}</span>`
            // Only for files: a directory's own size says nothing about what
            // the tree shows inside it.
            + (file.is_dir ? ''
                : `<span class="skill-file-size">${formatSkillFileSize(file.size)}</span>`);
        // Bound rather than written into an onclick attribute: these names come
        // off disk and may hold a quote.
        row.onclick = file.is_dir
            ? () => toggleSkillDir(file.path)
            : () => selectSkillFile(file.path);
        tree.appendChild(row);
    });
}

/** Whether a folded directory somewhere above this path hides it. */
function skillPathIsFolded(path) {
    for (const dir of _skillFoldedDirs) {
        if (path.startsWith(`${dir}/`)) return true;
    }
    return false;
}

/** Fold a directory away, or open it again. */
function toggleSkillDir(path) {
    if (!_skillFoldedDirs.delete(path)) _skillFoldedDirs.add(path);
    renderSkillFilesTree();
}

/** Show or hide the file list, giving the document the full width. */
function toggleSkillFilesPanel() {
    _skillFilesPanelOpen = !_skillFilesPanelOpen;
    localStorage.setItem(SKILL_FILES_PANEL_KEY, _skillFilesPanelOpen ? '1' : '0');
    renderSkillFilesTree();
}

/** Show another of the open skill's files. */
function selectSkillFile(path) {
    const doc = skillEditor.current();
    if (!doc || doc.path === path) return;
    // The text area is about to be replaced by another file's contents.
    if (!skillEditor.guard(() => selectSkillFile(path))) return;

    const mine = ++_skillReadSeq;
    skillReadContent(doc.name, path).then(data => {
        if (mine !== _skillReadSeq) return;
        const readonlyKey = skillReadonlyReason(data);
        skillShowReadonlyBadge(readonlyKey);
        skillEditor.open({
            name: doc.name,
            path: data.filename || path,
            content: data.content || '',
            readonlyKey: readonlyKey,
        });
        renderSkillFilesTree();
    }).catch(e => {
        if (mine === _skillReadSeq) _wsToast(`${t('skill_load_failed')}: ${e.message}`);
    });
}

function closeSkillViewer() {
    if (!skillEditor.guard(closeSkillViewer)) return;
    resetSkillViewer();
    // A saved edit can change the name and description in the frontmatter, so
    // the cards behind this panel may be out of date.
    loadSkillsSection();
}

/** Drop the viewer and show the list, without asking about unsaved edits. */
function resetSkillViewer() {
    skillEditor.forget();
    _skillFiles = [];
    _skillFoldedDirs = new Set();
    document.getElementById('skill-files-panel')?.classList.add('hidden');
    document.getElementById('skill-files-toggle')?.classList.add('hidden');
    document.getElementById('skills-panel-viewer')?.classList.add('hidden');
    document.getElementById('skills-panel-list')?.classList.remove('hidden');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        matchesCapabilityQuery,
        filterCapabilityItems,
        formatMcpToolsPreview,
    };
}

