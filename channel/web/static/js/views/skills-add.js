/* Capabilities view - Skill market install, upload preview, and authoring form.
   Split out of views/skills.js. Loaded immediately after views/skills-mcp.js
   in the classic global script scope; see channel/web/README.md. */

// ---------------------------------------------------------------------
// Add skill: fetch from a market or upload, preview, then install
// ---------------------------------------------------------------------

const SKILL_SOURCES = {
    hub: { labelKey: 'skill_value_hub', placeholder: 'skill-name', hintKey: 'skill_hint_hub', link: 'https://skills.cowagent.ai/' },
    github: { labelKey: 'skill_value_github', placeholder: 'https://github.com/owner/repo/tree/main/skills/my-skill', hintKey: 'skill_hint_github' },
    clawhub: { labelKey: 'skill_value_clawhub', placeholder: 'skill-name', hintKey: 'skill_hint_clawhub', link: 'https://clawhub.ai/skills' },
};

const SKILL_SOURCE_LABELS = {
    cowhub: 'Cow Skill Hub', github: 'GitHub', clawhub: 'ClawHub', url: 'URL',
};

const SKILL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const skillAdd = {
    tab: 'market',
    source: 'hub',
    step: 'input',
    token: null,
    skills: [],
    selected: new Set(),
    busy: false,
    // Bumped when a fetch or upload is abandoned, so its late reply is ignored.
    req: 0,
};

function bindSkillAddUi() {
    const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);
    on('skill-add-btn', 'click', openSkillAdd);
    on('skill-add-close', 'click', closeSkillAdd);
    on('skill-add-cancel', 'click', closeSkillAdd);
    on('skill-add-back', 'click', backToSkillInput);
    on('skill-add-primary', 'click', onSkillAddPrimary);
    on('skill-add-overlay', 'click', (e) => { if (e.target.id === 'skill-add-overlay') closeSkillAdd(); });
    document.querySelectorAll('[data-skill-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchSkillTab(btn.dataset.skillTab));
    });
    document.querySelectorAll('.skill-source-opt').forEach(btn => {
        btn.addEventListener('click', () => setSkillSource(btn.dataset.source));
    });
    on('skill-value-input', 'input', () => { hideSkillInputError(); syncSkillAddFooter(); });
    ['skill-create-name', 'skill-create-desc'].forEach(id => on(id, 'input', hideSkillInputError));
    on('skill-value-input', 'keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); fetchSkillPreview(); }
    });
    on('skill-preview-all', 'change', (e) => {
        skillAdd.selected = e.target.checked ? new Set(skillAdd.skills.map(s => s.name)) : new Set();
        renderSkillPreviewList();
    });

    on('skill-pick-file', 'click', () => document.getElementById('skill-file-input').click());
    on('skill-pick-folder', 'click', () => document.getElementById('skill-folder-input').click());
    on('skill-file-input', 'change', (e) => {
        const files = Array.from(e.target.files || []).map(f => ({ file: f, path: f.name }));
        e.target.value = '';
        uploadSkillFiles(files);
    });
    on('skill-folder-input', 'change', (e) => {
        const files = Array.from(e.target.files || []).map(f => ({ file: f, path: f.webkitRelativePath || f.name }));
        e.target.value = '';
        uploadSkillFiles(files);
    });

    const zone = document.getElementById('skill-dropzone');
    if (zone) {
        ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (!skillAdd.busy) zone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
        }));
        zone.addEventListener('drop', async (e) => {
            if (skillAdd.busy) return;
            const files = await collectDroppedFiles(e.dataTransfer);
            uploadSkillFiles(files);
        });
    }
}

function openSkillAdd() {
    skillAdd.tab = 'market';
    skillAdd.step = 'input';
    skillAdd.token = null;
    skillAdd.skills = [];
    skillAdd.selected = new Set();
    skillAdd.busy = false;
    document.getElementById('skill-value-input').value = '';
    resetSkillCreateForm();
    initSkillAttachMenu();
    switchSkillTab('market');
    setSkillSource('hub');
    showSkillStep('input');
    document.getElementById('skill-add-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('skill-value-input')?.focus(), 30);
}

function closeSkillAdd() {
    if (skillAdd.busy) {
        // Installing is quick and not safely interruptible; fetching can hang on the network.
        // Creating writes the skill like installing does, so it cannot be walked away from either.
        if (skillAdd.step !== 'input' || skillAdd.tab === 'create') return;
        skillAdd.req++;
        setSkillAddBusy(false);
    }
    discardSkillPreview();
    document.getElementById('skill-add-overlay').classList.add('hidden');
}

function discardSkillPreview() {
    if (!skillAdd.token) return;
    const token = skillAdd.token;
    skillAdd.token = null;
    postJson('/api/skills', { action: 'discard', token }).catch(() => {});
}

function switchSkillTab(tab) {
    if (skillAdd.busy) return;
    skillAdd.tab = tab;
    document.querySelectorAll('[data-skill-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.skillTab === tab);
    });
    document.getElementById('skill-pane-market').classList.toggle('hidden', tab !== 'market');
    document.getElementById('skill-pane-upload').classList.toggle('hidden', tab !== 'upload');
    document.getElementById('skill-pane-create').classList.toggle('hidden', tab !== 'create');
    hideSkillAttachMenu();
    hideSkillInputError();
    syncSkillAddFooter();
    if (tab === 'create') document.getElementById('skill-create-name')?.focus();
}

function setSkillSource(source) {
    const meta = SKILL_SOURCES[source];
    if (!meta) return;
    skillAdd.source = source;
    document.querySelectorAll('.skill-source-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.source === source);
    });
    const label = document.getElementById('skill-value-label');
    label.dataset.i18n = meta.labelKey;
    label.textContent = t(meta.labelKey);
    const input = document.getElementById('skill-value-input');
    input.placeholder = meta.placeholder;
    const hint = document.getElementById('skill-source-hint');
    const link = meta.link
        ? ` <a href="${meta.link}" target="_blank" rel="noopener noreferrer" class="text-primary-500 hover:text-primary-600">${escapeHtml(meta.link.replace(/^https:\/\/|\/$/g, ''))}</a>`
        : '';
    hint.innerHTML = escapeHtml(t(meta.hintKey)) + link;
    hideSkillInputError();
    input.focus();
}

function showSkillInputError(msg) {
    const el = document.getElementById('skill-input-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideSkillInputError() {
    document.getElementById('skill-input-error')?.classList.add('hidden');
}

function showSkillStep(step) {
    skillAdd.step = step;
    ['input', 'preview', 'done'].forEach(name => {
        document.getElementById(`skill-step-${name}`).classList.toggle('hidden', name !== step);
    });
    const subtitle = document.getElementById('skill-add-subtitle');
    if (step === 'preview') {
        subtitle.textContent = t('skill_preview_title');
        subtitle.classList.remove('hidden');
    } else {
        subtitle.classList.add('hidden');
    }
    syncSkillAddFooter();
}

function setSkillAddBusy(busy) {
    skillAdd.busy = busy;
    document.getElementById('skill-add-primary-spin').classList.toggle('hidden', !busy);
    const zoneIcon = document.getElementById('skill-dropzone-icon');
    if (zoneIcon) {
        zoneIcon.className = busy && skillAdd.tab === 'upload' && skillAdd.step === 'input'
            ? 'fas fa-spinner fa-spin text-primary-500'
            : 'fas fa-file-arrow-up text-slate-400';
    }
    syncSkillAddFooter();
}

function syncSkillAddFooter() {
    const primary = document.getElementById('skill-add-primary');
    const label = document.getElementById('skill-add-primary-label');
    const cancel = document.getElementById('skill-add-cancel');
    const back = document.getElementById('skill-add-back');
    back.classList.toggle('hidden', skillAdd.step !== 'preview');
    back.disabled = skillAdd.busy;
    cancel.classList.toggle('hidden', skillAdd.step === 'done');
    cancel.disabled = skillAdd.busy && (skillAdd.step !== 'input' || skillAdd.tab === 'create');

    let text = '';
    let show = true;
    let enabled = !skillAdd.busy;
    if (skillAdd.step === 'input') {
        if (skillAdd.tab === 'upload') {
            show = skillAdd.busy;
            text = t('skill_uploading');
        } else if (skillAdd.tab === 'create') {
            text = t('skill_new_submit');
        } else {
            text = t(skillAdd.busy ? 'skill_fetching' : 'skill_fetch');
            enabled = enabled && !!document.getElementById('skill-value-input').value.trim();
        }
    } else if (skillAdd.step === 'preview') {
        const n = skillAdd.selected.size;
        text = skillAdd.busy ? t('skill_installing') : t('skill_confirm_install_n').replace('{n}', n);
        enabled = enabled && n > 0;
    } else {
        text = t('skill_done');
    }
    primary.classList.toggle('hidden', !show);
    primary.disabled = !enabled;
    label.textContent = text;
}

function onSkillAddPrimary() {
    if (skillAdd.step === 'input' && skillAdd.tab === 'create') submitSkillCreate();
    else if (skillAdd.step === 'input') fetchSkillPreview();
    else if (skillAdd.step === 'preview') confirmSkillInstall();
    else finishSkillAdd();
}

async function fetchSkillPreview() {
    if (skillAdd.busy || skillAdd.tab !== 'market') return;
    const value = document.getElementById('skill-value-input').value.trim();
    if (!value) return;
    await stageSkillPreview(() => postJson('/api/skills', { action: 'preview', source: skillAdd.source, value }));
}

async function stageSkillPreview(request) {
    const req = ++skillAdd.req;
    hideSkillInputError();
    setSkillAddBusy(true);
    try {
        const data = await request();
        if (req !== skillAdd.req) {
            if (data && data.token) postJson('/api/skills', { action: 'discard', token: data.token }).catch(() => {});
            return;
        }
        if (data.status !== 'success') throw new Error(data.message || t('skill_install_error'));
        showSkillPreview(data);
    } catch (err) {
        if (req === skillAdd.req) showSkillInputError(err.message || t('skill_install_error'));
    } finally {
        if (req === skillAdd.req) setSkillAddBusy(false);
    }
}

/** Walk a drop: plain files, or folders read through the entries API. */
async function collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer?.items || []);
    const entries = items.map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) {
        return Array.from(dataTransfer?.files || []).map(f => ({ file: f, path: f.name }));
    }
    const out = [];
    const readAll = (reader) => new Promise((resolve) => {
        const acc = [];
        const next = () => reader.readEntries((batch) => {
            if (!batch.length) { resolve(acc); return; }
            acc.push(...batch);
            next();
        }, () => resolve(acc));
        next();
    });
    const walk = async (entry, prefix) => {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
            if (file) out.push({ file, path: prefix + file.name });
        } else if (entry.isDirectory) {
            const children = await readAll(entry.createReader());
            for (const child of children) await walk(child, `${prefix}${entry.name}/`);
        }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
}

async function uploadSkillFiles(files) {
    if (skillAdd.busy || !files.length) return;
    hideSkillInputError();
    const total = files.reduce((sum, f) => sum + (f.file.size || 0), 0);
    if (total > SKILL_UPLOAD_MAX_BYTES) {
        showSkillInputError(t('skill_upload_too_large'));
        return;
    }
    const form = new FormData();
    files.forEach(({ file, path }) => {
        form.append('files', file, file.name);
        form.append('paths', path);
    });
    await stageSkillPreview(async () => {
        const res = await fetch('/api/skills/upload', { method: 'POST', body: form });
        return res.json();
    });
}

function showSkillPreview(data) {
    discardSkillPreview();
    skillAdd.token = data.token;
    skillAdd.skills = data.skills || [];
    skillAdd.selected = new Set(skillAdd.skills.map(s => s.name));
    const multi = skillAdd.skills.length > 1;
    document.getElementById('skill-preview-count').textContent =
        t('skill_preview_found').replace('{n}', skillAdd.skills.length);
    const allWrap = document.getElementById('skill-preview-all-wrap');
    allWrap.classList.toggle('hidden', !multi);
    allWrap.classList.toggle('flex', multi);
    document.getElementById('skill-preview-error').classList.add('hidden');
    renderSkillPreviewList();
    showSkillStep('preview');
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function skillSourceLabel(source) {
    if (!source) return '';
    if (source === 'local') return t('skill_source_local');
    return SKILL_SOURCE_LABELS[source] || source;
}

function renderSkillPreviewMd(sk) {
    if (!sk.has_skill_md) {
        return `<p class="text-xs text-slate-400">${escapeHtml(t('skill_preview_no_md'))}</p>`;
    }
    const { fields, body } = parseSkillFrontmatter(sk.skill_md);
    const rows = fields.map(([key, value]) => `
        <div class="flex gap-3 text-xs">
            <span class="flex-shrink-0 w-20 font-medium text-slate-400 dark:text-slate-500">${escapeHtml(key)}</span>
            <span class="flex-1 min-w-0 text-slate-600 dark:text-slate-300 break-words">${escapeHtml(value)}</span>
        </div>`).join('');
    const header = rows ? `<div class="mb-3 pb-3 border-b border-slate-200/70 dark:border-white/10 space-y-1">${rows}</div>` : '';
    const truncated = sk.skill_md_truncated
        ? `<p class="mt-3 text-xs text-slate-400">${escapeHtml(t('skill_preview_truncated'))}</p>` : '';
    return `${header}<div class="msg-content">${renderMarkdown(body || '')}</div>${truncated}`;
}

function renderSkillPreviewList() {
    const listEl = document.getElementById('skill-preview-list');
    const multi = skillAdd.skills.length > 1;
    listEl.innerHTML = '';
    skillAdd.skills.forEach(sk => {
        const selected = skillAdd.selected.has(sk.name);
        const card = document.createElement('div');
        card.className = 'skill-preview-card' + (selected ? '' : ' unselected');
        const title = sk.display_name || sk.name;
        const extra = [
            `<span><i class="far fa-file mr-1"></i>${escapeHtml(t('skill_preview_files').replace('{n}', sk.file_count))}</span>`,
            `<span>${escapeHtml(formatBytes(sk.size))}</span>`,
        ];
        const source = skillSourceLabel(sk.source);
        if (source) extra.push(`<span>${escapeHtml(source)}</span>`);
        card.innerHTML = `
            <div class="flex items-start gap-3 p-4">
                ${multi ? `<input type="checkbox" data-select class="mt-2.5 rounded accent-primary-500 cursor-pointer" ${selected ? 'checked' : ''}>` : ''}
                <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-bolt text-primary-500 text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-sm text-slate-800 dark:text-slate-100">${escapeHtml(title)}</span>
                        ${title !== sk.name ? `<span class="text-xs font-mono text-slate-400">${escapeHtml(sk.name)}</span>` : ''}
                        ${sk.exists ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">${escapeHtml(t('skill_preview_exists'))}</span>` : ''}
                    </div>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3">${escapeHtml(sk.description || '--')}</p>
                    <div class="flex items-center gap-2.5 mt-2 text-[11px] text-slate-400 dark:text-slate-500">${extra.join('<span class="opacity-40">·</span>')}</div>
                    <div class="flex items-center gap-1 mt-2 -ml-2">
                        <button type="button" data-toggle="md" class="cap-link-btn">
                            <i class="fas fa-chevron-right text-[9px] transition-transform"></i><span>SKILL.md</span>
                        </button>
                        <button type="button" data-toggle="files" class="cap-link-btn">
                            <i class="fas fa-chevron-right text-[9px] transition-transform"></i><span>${escapeHtml(t('skill_preview_show_files'))}</span>
                        </button>
                    </div>
                </div>
            </div>
            <div data-pane="md" class="skill-preview-md hidden"></div>
            <div data-pane="files" class="skill-preview-files hidden"></div>`;

        const panes = {
            md: card.querySelector('[data-pane="md"]'),
            files: card.querySelector('[data-pane="files"]'),
        };
        const toggle = (which, open) => {
            const pane = panes[which];
            const isOpen = open !== undefined ? open : pane.classList.contains('hidden');
            if (isOpen && !pane.dataset.rendered) {
                if (which === 'md') {
                    pane.innerHTML = renderSkillPreviewMd(sk);
                    applyHighlighting(pane);
                } else {
                    const more = sk.file_count > sk.files.length
                        ? `<div class="opacity-60">… +${sk.file_count - sk.files.length}</div>` : '';
                    pane.innerHTML = sk.files.map(f => `<div class="truncate">${escapeHtml(f)}</div>`).join('') + more;
                }
                pane.dataset.rendered = '1';
            }
            pane.classList.toggle('hidden', !isOpen);
            const icon = card.querySelector(`[data-toggle="${which}"] i`);
            if (icon) icon.style.transform = isOpen ? 'rotate(90deg)' : '';
        };
        card.querySelectorAll('[data-toggle]').forEach(btn => {
            btn.addEventListener('click', () => toggle(btn.dataset.toggle));
        });
        const checkbox = card.querySelector('[data-select]');
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) skillAdd.selected.add(sk.name);
                else skillAdd.selected.delete(sk.name);
                card.classList.toggle('unselected', !checkbox.checked);
                document.getElementById('skill-preview-all').checked =
                    skillAdd.selected.size === skillAdd.skills.length;
                syncSkillAddFooter();
            });
        }
        if (!multi) toggle('md', true);
        listEl.appendChild(card);
    });
    document.getElementById('skill-preview-all').checked = skillAdd.selected.size === skillAdd.skills.length;
    syncSkillAddFooter();
}

function backToSkillInput() {
    if (skillAdd.busy) return;
    discardSkillPreview();
    skillAdd.skills = [];
    skillAdd.selected = new Set();
    showSkillStep('input');
}

async function confirmSkillInstall() {
    if (skillAdd.busy || !skillAdd.token || !skillAdd.selected.size) return;
    const errorEl = document.getElementById('skill-preview-error');
    errorEl.classList.add('hidden');
    setSkillAddBusy(true);
    try {
        const data = await postJson('/api/skills', {
            action: 'confirm',
            token: skillAdd.token,
            names: Array.from(skillAdd.selected),
        });
        if (data.status !== 'success') throw new Error(data.message || t('skill_install_error'));
        skillAdd.token = null;
        showSkillDone(data.installed || []);
    } catch (err) {
        errorEl.textContent = err.message || t('skill_install_error');
        errorEl.classList.remove('hidden');
    } finally {
        setSkillAddBusy(false);
    }
}

function showSkillDone(installed) {
    skillAdd.installed = installed;
    const byName = Object.fromEntries(skillAdd.skills.map(s => [s.name, s]));
    document.getElementById('skill-done-desc').textContent =
        t('skill_installed_desc').replace('{n}', installed.length);
    document.getElementById('skill-done-names').innerHTML = installed.map(name => {
        const sk = byName[name] || {};
        return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
            <i class="fas fa-bolt text-primary-500 text-[10px]"></i>${escapeHtml(sk.display_name || name)}</span>`;
    }).join('');
    showSkillStep('done');
    loadSkillsSection(installed);
}

function finishSkillAdd() {
    document.getElementById('skill-add-overlay').classList.add('hidden');
    const first = (skillAdd.installed || [])[0];
    const card = first && document.querySelector(`#skills-list [data-skill-name="${CSS.escape(first)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------
// Create a skill in the workspace from the "Create" tab of the add modal
// ---------------------------------------------------------------------

// Client-side upload cap checks, so an oversized file or a virtualenv-heavy
// folder is refused here rather than after being uploaded. See
// SkillService.MAX_UPLOAD_*.
const SKILL_UPLOAD_MAX_FILES = 500;
const SKILL_UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024;
const SKILL_UPLOAD_MAX_TOTAL_SIZE = 50 * 1024 * 1024;

let _skillCreateFiles = [];
let _skillAttachMenuReady = false;

function resetSkillCreateForm() {
    ['skill-create-name', 'skill-create-desc', 'skill-create-body'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    _skillCreateFiles = [];
    renderSkillCreateFiles();
    renderSkillNamePreview();
    hideSkillAttachMenu();
}

/**
 * The directory name a title reduces to. Mirrors `normalize_skill_name` on the
 * server, so the preview under the field is what actually gets created.
 */
function skillNameSlug(raw) {
    return (raw || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '');
}

function renderSkillNamePreview() {
    const el = document.getElementById('skill-create-name-preview');
    if (!el) return;
    const typed = (document.getElementById('skill-create-name')?.value || '').trim();
    const slug = skillNameSlug(typed);

    const hint = (key) => {
        el.dataset.i18n = key;
        el.textContent = t(key);
        el.classList.remove('text-red-500');
    };
    if (!typed) return hint('skill_new_name_hint');
    if (!slug) {
        hint('skill_new_name_invalid');
        el.classList.add('text-red-500');
        return;
    }
    if (slug === typed) return hint('skill_new_name_hint');
    // A composed line, so it must not be re-translated over on a language switch.
    el.removeAttribute('data-i18n');
    el.classList.remove('text-red-500');
    el.textContent = `${t('skill_new_name_dir')}: ${slug}`;
}

/**
 * Where an attachment lands inside the skill directory.
 *
 * A folder pick carries the path the file sat at under the chosen folder, so
 * `scripts/` picked as a folder installs as `scripts/`. A loose file has only
 * its own name, and lands beside SKILL.md.
 */
function skillAttachmentPath(file) {
    return file.webkitRelativePath || file.name;
}

/**
 * The files of a picked folder that are worth installing.
 *
 * A directory on disk carries more than what someone wrote: caches, a virtualenv,
 * an editor's dotfiles. Bundling those would install megabytes the skill never
 * uses, and the console's file tree hides them anyway - so the tree would not
 * even show what had been added.
 */
function skillUploadCandidates(files) {
    const noise = ['__pycache__', 'node_modules', 'venv'];
    return files.filter(file => skillAttachmentPath(file).split('/')
        .every(part => !part.startsWith('.') && !noise.includes(part)));
}

/**
 * Open or close the menu behind the attachments button.
 *
 * Two picks behind one button: a native file dialog browses for files or for a
 * directory, never both, so the choice is made before it opens.
 */
function toggleSkillAttachMenu(event) {
    // Or the click would reach the document listener that closes it again.
    event?.stopPropagation();
    document.getElementById('skill-create-attach-menu')?.classList.toggle('hidden');
}

function hideSkillAttachMenu() {
    document.getElementById('skill-create-attach-menu')?.classList.add('hidden');
}

/** Close the attach menu on a click anywhere else. Bound once. */
function initSkillAttachMenu() {
    if (_skillAttachMenuReady) return;
    const menu = document.getElementById('skill-create-attach-menu');
    const btn = document.getElementById('skill-create-attach-btn');
    if (!menu || !btn) return;
    _skillAttachMenuReady = true;
    // A folder picker is Chromium/WebKit only; without it the menu would offer
    // an entry that does nothing.
    const folderInput = document.getElementById('skill-create-folder');
    document.getElementById('skill-create-folder-option')
        ?.classList.toggle('hidden', !(folderInput && 'webkitdirectory' in folderInput));
    document.addEventListener('click', event => {
        if (menu.classList.contains('hidden')) return;
        if (menu.contains(event.target) || btn.contains(event.target)) return;
        hideSkillAttachMenu();
    });
}

function selectSkillCreateFiles() {
    pickSkillCreateAttachments('skill-create-files', false);
}

function selectSkillCreateFolder() {
    pickSkillCreateAttachments('skill-create-folder', true);
}

/**
 * Add what one of the attachment inputs picked to the list under the field.
 *
 * @param asFolder - a folder pick, whose noise is left out and whose paths are
 *   kept; a loose pick is taken as chosen, dotfile or not.
 */
function pickSkillCreateAttachments(inputId, asFolder) {
    hideSkillAttachMenu();
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = '';
    input.onchange = () => {
        const picked = Array.from(input.files || []);
        (asFolder ? skillUploadCandidates(picked) : picked).forEach(file => {
            // One path is one attachment: the same file picked twice does not
            // become two, and two files of that name in different folders stay
            // two.
            const path = skillAttachmentPath(file);
            if (!_skillCreateFiles.some(f => skillAttachmentPath(f) === path)) {
                _skillCreateFiles.push(file);
            }
        });
        renderSkillCreateFiles();
    };
    input.click();
}

function removeSkillCreateFile(index) {
    _skillCreateFiles.splice(index, 1);
    renderSkillCreateFiles();
}

function renderSkillCreateFiles() {
    const list = document.getElementById('skill-create-files-list');
    const empty = document.getElementById('skill-create-files-empty');
    if (!list) return;
    empty?.classList.toggle('hidden', _skillCreateFiles.length > 0);
    list.innerHTML = _skillCreateFiles.map((file, index) => `
        <div class="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1.5">
            <i class="fas fa-file text-slate-400 text-[10px]"></i>
            <span class="flex-1 min-w-0 text-xs font-mono text-slate-700 dark:text-slate-200 truncate"
                  title="${escapeHtml(skillAttachmentPath(file))}">${escapeHtml(skillAttachmentPath(file))}</span>
            <span class="text-[11px] text-slate-400">${formatSkillFileSize(file.size)}</span>
            <button type="button" onclick="removeSkillCreateFile(${index})"
                    class="text-slate-400 hover:text-red-500 cursor-pointer">
                <i class="fas fa-xmark text-[10px]"></i>
            </button>
        </div>`).join('');
}

function formatSkillFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Check a batch of picked files against the server's caps. '' when they pass. */
function validateSkillUploadFiles(files) {
    if (files.length > SKILL_UPLOAD_MAX_FILES) {
        return t('skill_upload_too_many').replace('{max}', SKILL_UPLOAD_MAX_FILES);
    }
    let total = 0;
    for (const file of files) {
        total += file.size || 0;
        if ((file.size || 0) > SKILL_UPLOAD_MAX_FILE_SIZE) {
            return t('skill_upload_file_too_large')
                .replace('{name}', file.name)
                .replace('{max}', SKILL_UPLOAD_MAX_FILE_SIZE / 1024 / 1024);
        }
    }
    if (total > SKILL_UPLOAD_MAX_TOTAL_SIZE) {
        return t('skill_upload_total_too_large')
            .replace('{max}', SKILL_UPLOAD_MAX_TOTAL_SIZE / 1024 / 1024);
    }
    return '';
}

function submitSkillCreate() {
    if (skillAdd.busy) return;
    const name = (document.getElementById('skill-create-name')?.value || '').trim();
    const description = (document.getElementById('skill-create-desc')?.value || '').trim();
    const body = document.getElementById('skill-create-body')?.value || '';
    if (!skillNameSlug(name)) return showSkillInputError(t('skill_new_name_invalid'));
    // The loader drops a skill with no description, so it is required here too.
    if (!description) return showSkillInputError(t('skill_new_desc_required'));
    if (_skillCreateFiles.length) {
        const error = validateSkillUploadFiles(_skillCreateFiles);
        if (error) return showSkillInputError(error);
    }

    const form = new FormData();
    form.append('name', name);
    form.append('description', description);
    form.append('body', body);
    // Paired field by field, the way a picked folder is uploaded: an attachment
    // that came from a folder keeps the path it sat at, and a file's own name
    // says nothing about that.
    _skillCreateFiles.forEach(file => {
        form.append('files', file);
        form.append('relative_paths', skillAttachmentPath(file));
    });
    return postSkillCreate(form);
}

async function postSkillCreate(formData) {
    setSkillAddBusy(true);
    hideSkillInputError();
    let data = null;
    try {
        const res = await fetch('/api/skills/create', { method: 'POST', body: formData });
        data = await res.json();
    } catch (e) {
        data = null;
    } finally {
        setSkillAddBusy(false);
    }

    if (!data) return showSkillInputError(t('skill_new_failed'));
    if (data.status !== 'success') return showSkillInputError(data.message || t('skill_new_failed'));

    closeSkillAdd();
    _wsToast(`${t('skill_new_created')}: ${data.name}`);
    loadSkillsSection([data.name]);
}
