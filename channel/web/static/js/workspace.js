/* =====================================================================
 * Workspace panel: file preview + file manager + @ file references.
 * Loaded after console.js and reuses its globals (t, escapeHtml,
 * renderMarkdown, applyHighlighting, pendingAttachments, ...).
 * ===================================================================== */

const WS_WIDTH_KEY = 'cow_workspace_width';
const WS_MIN_WIDTH = 280;

// Panel state
let wsPanelOpen = false;
let wsActiveTab = 'preview';
let wsCurrentFile = null;
// Preview editor state. `wsEditBaseline` is the text area's own value as loaded,
// so comparing against it tells whether anything actually changed;
// `wsEditBaseMtime` is the timestamp the server checks to detect that the agent
// rewrote the file mid-edit.
let wsEditing = false;
let wsEditBaseline = '';
let wsEditBaseMtime = null;
let wsSaving = false;
// Set once the user closes the panel by hand: from then on we stop
// auto-opening artifacts for the rest of the page session.
let wsAutoOpenSuppressed = false;
// Artifacts produced by the turn currently streaming.
let wsTurnArtifacts = [];

// File manager state
let wsCurrentDir = '';
let wsCurrentRoot = '';   // absolute path of the workspace/project root
let wsSearchMode = false;
let wsSearchTimer = null;

// =====================================================================
// Metadata helpers
// =====================================================================
const WS_KIND_ICONS = {
    directory: 'fa-folder',
    html: 'fa-file-code',
    markdown: 'fa-file-lines',
    image: 'fa-file-image',
    video: 'fa-file-video',
    audio: 'fa-file-audio',
    pdf: 'fa-file-pdf',
    csv: 'fa-file-csv',
    code: 'fa-file-code',
    office: 'fa-file-word',
    text: 'fa-file-lines',
    file: 'fa-file',
};

const WS_KIND_BY_EXT = {
    html: ['html', 'htm'],
    markdown: ['md', 'markdown'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'],
    video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
    pdf: ['pdf'],
    csv: ['csv', 'tsv'],
    code: ['py', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'h', 'go', 'rs',
           'rb', 'php', 'sh', 'sql', 'css', 'scss', 'json', 'yaml', 'yml',
           'xml', 'toml', 'ini'],
    text: ['txt', 'log'],
    office: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
};

const WS_EXT_KIND = (() => {
    const map = {};
    for (const [kind, exts] of Object.entries(WS_KIND_BY_EXT)) {
        exts.forEach(e => { map[e] = kind; });
    }
    return map;
})();

const WS_PREVIEWABLE = new Set(
    ['html', 'markdown', 'image', 'video', 'audio', 'pdf', 'csv', 'code', 'text']
);

// Kinds the panel offers an editor for. Mirrors EDITABLE_KINDS in
// agent/protocol/artifact.py; the server rejects anything else on save.
const WS_EDITABLE = new Set(['html', 'markdown', 'csv', 'code', 'text']);

function wsKindOf(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return WS_EXT_KIND[ext] || 'file';
}

function wsIconClass(kind) {
    return `fas ${WS_KIND_ICONS[kind] || WS_KIND_ICONS.file} ws-icon-${kind}`;
}

function wsFormatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes;
    for (const u of units) {
        if (n < 1024) return `${u === 'B' ? Math.round(n) : n.toFixed(1)}${u}`;
        n /= 1024;
    }
    return `${n.toFixed(1)}TB`;
}

async function wsApi(path) {
    // Scope workspace reads to the current session so the file panel / @ picker /
    // preview follow the session's opened project directory. `sessionId` and
    // `activeAgentId` are globals from console.js on the same page.
    try {
        if (path.startsWith('/api/workspace/')) {
            const sid = (typeof sessionId !== 'undefined') ? sessionId : '';
            if (sid) path += (path.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(sid);
            // Without an opened project the root falls back to the Agent's own
            // workspace, so the file panel must say which Agent is active — else
            // it always shows the default Agent's directory.
            const aid = (typeof activeAgentId !== 'undefined') ? activeAgentId : '';
            if (aid) path += (path.includes('?') ? '&' : '?') + 'agent=' + encodeURIComponent(aid);
        }
    } catch (e) { /* globals not available yet */ }
    const res = await fetch(path);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Request failed');
    return data;
}

// =====================================================================
// Panel open / close / resize
// =====================================================================
function openWorkspacePanel(tab) {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    wsPanelOpen = true;
    const width = parseInt(localStorage.getItem(WS_WIDTH_KEY), 10);
    if (width >= WS_MIN_WIDTH) panel.style.width = `${width}px`;
    if (tab) switchWorkspaceTab(tab);
}

/**
 * @param {boolean} byUser - true when triggered by the close button, which
 *   also disables auto-open for the rest of the session.
 */
function closeWorkspacePanel(byUser) {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    wsPanelOpen = false;
    if (byUser) wsAutoOpenSuppressed = true;
}

function toggleWorkspacePanel() {
    if (wsPanelOpen) {
        closeWorkspacePanel(true);
        return;
    }
    wsAutoOpenSuppressed = false;
    openWorkspacePanel(wsCurrentFile ? 'preview' : 'files');
}

function switchWorkspaceTab(tab) {
    wsActiveTab = tab;
    document.querySelectorAll('.workspace-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.wsTab === tab);
    });
    document.querySelectorAll('.workspace-body').forEach(el => {
        el.classList.toggle('active', el.id === `ws-body-${tab}`);
    });
    wsUpdateHeaderActions();
    if (tab === 'files' && !document.getElementById('ws-file-list').childElementCount) {
        loadWorkspaceDir(wsCurrentDir);
    }
}

function wsUpdateHeaderActions() {
    const onFile = wsActiveTab === 'preview' && !!wsCurrentFile;
    // While editing, the viewer actions would act on the saved file rather than
    // on what is in the text area, which reads as a bug. Hide them instead.
    ['ws-btn-external', 'ws-btn-download'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !onFile || wsEditing);
    });
    document.getElementById('ws-btn-reveal')?.classList.toggle('hidden',
        !onFile || wsEditing || !wsCanReveal() || !wsCurrentFile.abs_path);
    // Only files a conversation produced have a place in the artifacts view.
    document.getElementById('ws-btn-artifacts')
        ?.classList.toggle('hidden', !onFile || wsEditing || !wsCurrentFile.artifact);
    document.getElementById('ws-btn-edit')
        ?.classList.toggle('hidden', !onFile || wsEditing || !wsIsEditable(wsCurrentFile));
    ['ws-btn-save', 'ws-btn-edit-cancel'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !onFile || !wsEditing);
    });
}

/**
 * Let a right-hand panel be widened by dragging the handle on its left edge.
 * The width is remembered under `opts.key`; `opts.content` is the part that
 * may hold an iframe, which would otherwise swallow the drag.
 */
function wsBindResizer(resizer, panel, opts) {
    if (!resizer || !panel) return;

    let startX = 0;
    let startWidth = 0;

    function onMove(e) {
        const delta = startX - e.clientX;
        const next = Math.max(opts.min, Math.min(opts.max(), startWidth + delta));
        panel.style.width = `${next}px`;
    }

    function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.userSelect = '';
        opts.content?.style.removeProperty('pointer-events');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const width = parseInt(panel.style.width, 10);
        if (width) localStorage.setItem(opts.key, String(width));
    }

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.userSelect = 'none';
        opts.content?.style.setProperty('pointer-events', 'none');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function initWorkspaceResizer() {
    wsBindResizer(document.getElementById('ws-resizer'), document.getElementById('workspace-panel'), {
        key: WS_WIDTH_KEY,
        min: WS_MIN_WIDTH,
        max: () => window.innerWidth * 0.7,
        content: document.getElementById('ws-preview-content'),
    });
}

// =====================================================================
// Preview
// =====================================================================
function wsSetPreviewEmpty(message, icon) {
    const body = document.getElementById('ws-preview-content');
    const title = document.getElementById('ws-preview-title');
    if (!body) return;
    title?.classList.add('hidden');
    body.innerHTML = `<div class="workspace-empty">
        <i class="fas ${icon || 'fa-eye'}"></i>
        <span>${escapeHtml(message)}</span>
    </div>`;
}

/**
 * Open a file in the preview tab.
 * @param {object|string} target - file metadata, or a path to resolve first.
 */
async function openInPreview(target) {
    // Opening another file replaces the editor, so settle unsaved edits first.
    if (!wsGuardUnsaved(() => openInPreview(target))) return;

    let meta = target;
    if (typeof target === 'string') {
        try {
            meta = (await wsApi(`/api/workspace/resolve?path=${encodeURIComponent(target)}`)).file;
        } catch (e) {
            openWorkspacePanel('preview');
            wsSetPreviewEmpty(t('ws_preview_failed') + ': ' + e.message, 'fa-triangle-exclamation');
            return;
        }
    }
    if (!meta) return;
    // Directories have nothing to render; browse into them instead.
    if (meta.is_dir) {
        openWorkspacePanel('files');
        switchWorkspaceTab('files');
        loadWorkspaceDir(meta.path || '');
        return;
    }

    wsCurrentFile = meta;
    wsEditing = false;
    openWorkspacePanel('preview');
    switchWorkspaceTab('preview');
    wsRenderPreviewTitle();
    wsUpdateHeaderActions();
    await wsRenderPreview(meta);
}

/** Show the current file's path, marked with a dot while edits are unsaved. */
function wsRenderPreviewTitle() {
    const title = document.getElementById('ws-preview-title');
    if (!title) return;
    if (!wsCurrentFile) {
        title.classList.add('hidden');
        return;
    }
    const name = wsCurrentFile.path || wsCurrentFile.file_name || wsCurrentFile.name || '';
    title.textContent = wsEditorDirty() ? `${name} •` : name;
    title.classList.remove('hidden');
}

/**
 * Render a file into the preview area.
 * @param {HTMLElement} [target] - render here instead of the panel's preview
 *   tab; the artifacts view reuses the same viewers this way.
 */
async function wsRenderPreview(meta, target) {
    const body = target || document.getElementById('ws-preview-content');
    if (!body) return;
    const kind = meta.kind || wsKindOf(meta.file_name || meta.name || meta.path);
    const name = meta.file_name || meta.name || (meta.path || '').split('/').pop();
    const previewUrl = meta.preview_url;
    const rawUrl = meta.raw_url || previewUrl;

    if (kind === 'html') {
        body.innerHTML = '';
        const frame = document.createElement('iframe');
        // No allow-same-origin: the generated page runs in an opaque origin and
        // cannot reach the console's storage or auth cookie.
        frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
        frame.src = previewUrl;
        body.appendChild(frame);
        return;
    }

    if (kind === 'image') {
        body.innerHTML = `<div class="ws-pad"><img class="ws-media" src="${escapeHtml(rawUrl)}" alt="${escapeHtml(name)}"></div>`;
        return;
    }

    if (kind === 'video') {
        body.innerHTML = `<div class="ws-pad"><video class="ws-media" controls preload="metadata" src="${escapeHtml(rawUrl)}"></video></div>`;
        return;
    }

    if (kind === 'audio') {
        body.innerHTML = `<div class="ws-pad"><audio class="ws-media" controls src="${escapeHtml(rawUrl)}"></audio></div>`;
        return;
    }

    if (kind === 'pdf') {
        body.innerHTML = '';
        const frame = document.createElement('iframe');
        frame.src = previewUrl;
        body.appendChild(frame);
        return;
    }

    if (kind === 'markdown' || kind === 'code' || kind === 'text' || kind === 'csv') {
        body.innerHTML = `<div class="workspace-empty"><i class="fas fa-spinner fa-spin"></i></div>`;
        try {
            const res = await fetch(previewUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (kind === 'markdown') {
                body.innerHTML = `<div class="ws-pad msg-content">${renderMarkdown(text)}</div>`;
            } else if (kind === 'csv') {
                body.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
            } else {
                const lang = (name.split('.').pop() || '').toLowerCase();
                body.innerHTML = `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>`;
            }
            applyHighlighting(body);
        } catch (e) {
            if (target) {
                body.innerHTML = `<div class="workspace-empty">
                    <i class="fas fa-triangle-exclamation"></i>
                    <span>${escapeHtml(t('ws_preview_failed') + ': ' + e.message)}</span>
                </div>`;
            } else {
                wsSetPreviewEmpty(t('ws_preview_failed') + ': ' + e.message, 'fa-triangle-exclamation');
            }
        }
        return;
    }

    // Unsupported type: offer a download instead of a broken viewer.
    body.innerHTML = `<div class="workspace-empty">
        <i class="${wsIconClass(kind)}"></i>
        <span class="ws-empty-name">${escapeHtml(name)}</span>
        <span>${escapeHtml(t('ws_no_inline_preview'))}</span>
        <a href="${escapeHtml(rawUrl)}" download="${escapeHtml(name)}" class="ws-empty-action">
            <i class="fas fa-download"></i><span>${escapeHtml(t('ws_download'))}</span>
        </a>
    </div>`;
}

/** Open a local file in its default desktop app when in Electron; otherwise open the URL in browser. */
function wsOpenNativePath(absPath, fallbackUrl) {
    if (absPath && window.electronAPI && typeof window.electronAPI.openPath === 'function') {
        window.electronAPI.openPath(absPath).then(err => {
            if (err && fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener');
        }).catch(() => {
            if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener');
        });
        return;
    }
    if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener');
}

function openPreviewExternally() {
    if (!wsCurrentFile) return;
    wsOpenNativePath(wsCurrentFile.abs_path, wsCurrentFile.preview_url || wsCurrentFile.raw_url);
}

function downloadPreviewFile() {
    if (!wsCurrentFile) return;
    const a = document.createElement('a');
    a.href = wsCurrentFile.raw_url || wsCurrentFile.preview_url;
    a.download = wsCurrentFile.file_name || wsCurrentFile.name || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/** Whether the server can open this machine's file manager for the user. */
function wsCanReveal() {
    if (window.electronAPI && typeof window.electronAPI.revealPath === 'function') return true;
    return !!(typeof appConfig !== 'undefined' && appConfig && appConfig.can_reveal_files);
}

/** Show a file in the system file manager. Resolves when the OS was asked to. */
function wsRevealPath(path) {
    if (path && window.electronAPI && typeof window.electronAPI.revealPath === 'function') {
        return window.electronAPI.revealPath(path);
    }
    return fetch('/api/file/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') throw new Error(data.message || t('ws_reveal_failed'));
        });
}

function revealPreviewFile() {
    const path = wsCurrentFile && wsCurrentFile.abs_path;
    if (!path) return;
    wsRevealPath(path).catch(err => _wsToast(err.message || t('ws_reveal_failed')));
}

// =====================================================================
// Preview editor
// =====================================================================
function wsIsEditable(meta) {
    if (!meta || meta.is_dir) return false;
    return WS_EDITABLE.has(meta.kind || wsKindOf(meta.file_name || meta.name || meta.path));
}

/**
 * Path to send to the read/write API. The absolute path is unambiguous, which
 * matters for files the panel reaches outside the session's workspace root
 * (memory / knowledge assets while a project is open).
 */
function wsEditTargetPath(meta) {
    return meta.abs_path || meta.path || meta.rel_path || '';
}

function wsEditorTextarea() {
    return document.getElementById('ws-editor');
}

function wsEditorDirty() {
    const ta = wsEditorTextarea();
    return wsEditing && !!ta && ta.value !== wsEditBaseline;
}

/** Forget the editor's state, leaving what is on screen to the caller. */
function wsDiscardEditState() {
    wsEditing = false;
    wsEditBaseline = '';
    wsEditBaseMtime = null;
}

/**
 * Gate an action that would throw away the editor's contents.
 *
 * @param {function} next - run once the user agrees to discard the edits, and
 *   responsible for whatever replaces the editor. It runs with edit mode
 *   already off, so it must not be a function that bails out when not editing.
 * @returns {boolean} true when there is nothing to lose and the caller may
 *   proceed immediately; false once the confirmation has been put on screen.
 */
function wsGuardUnsaved(next) {
    if (!wsEditorDirty()) return true;
    showConfirmDialog({
        title: t('ws_edit_discard_title'),
        message: t('ws_edit_discard_msg'),
        okText: t('ws_edit_discard_ok'),
        onConfirm: () => {
            wsDiscardEditState();
            next();
        },
    });
    return false;
}

/**
 * Why the server refused to make a file editable. Truncation is reported first:
 * a partial read can also split a multi-byte character and so come back lossy,
 * but the size is the reason the user needs to hear.
 */
function wsUneditableReason(data) {
    if (data.truncated) return 'ws_edit_too_large';
    if (data.lossy) return 'ws_edit_encoding';
    return 'ws_edit_unsupported';
}

/** Load the file's current text into an editable text area. */
async function startPreviewEdit() {
    if (wsEditing || !wsIsEditable(wsCurrentFile)) return;
    const target = wsCurrentFile;
    const body = document.getElementById('ws-preview-content');
    if (!body) return;
    body.innerHTML = `<div class="workspace-empty"><i class="fas fa-spinner fa-spin"></i></div>`;

    let data;
    try {
        data = await wsApi(`/api/workspace/read?path=${encodeURIComponent(wsEditTargetPath(target))}`);
    } catch (e) {
        _wsToast(`${t('ws_edit_load_failed')}: ${e.message}`);
        await wsRenderPreview(target);
        return;
    }
    // The user may have navigated away while the request was in flight.
    if (wsCurrentFile !== target) return;
    if (!data.editable) {
        _wsToast(t(wsUneditableReason(data)));
        await wsRenderPreview(target);
        return;
    }

    wsEditing = true;
    wsEditBaseMtime = data.mtime;
    // Read the baseline back out of the text area rather than using the response
    // text: a text area normalizes CRLF to LF in its value, so a CRLF file would
    // compare as modified from the moment it loaded.
    wsEditBaseline = wsMountEditor(body, data.content).value;
    wsRenderPreviewTitle();
    wsUpdateHeaderActions();
}

/** @returns {HTMLTextAreaElement} the text area now holding the file. */
function wsMountEditor(body, content) {
    body.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.id = 'ws-editor';
    ta.className = 'ws-editor';
    ta.spellcheck = false;
    ta.value = content;
    body.appendChild(ta);

    ta.addEventListener('input', wsRenderPreviewTitle);
    ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            // Save in place, the way an editor does. The Save button instead
            // returns to the rendered preview.
            e.preventDefault();
            savePreviewEdit({ keepEditing: true });
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelPreviewEdit();
        } else if (e.key === 'Tab') {
            // Otherwise Tab leaves the text area, which is never what indenting
            // a line of code is meant to do.
            e.preventDefault();
            wsInsertAtCursor(ta, '    ');
        }
    });
    ta.focus();
    return ta;
}

function wsInsertAtCursor(ta, text) {
    const { selectionStart: start, selectionEnd: end } = ta;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    wsRenderPreviewTitle();
}

/**
 * Write the text area back to disk.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.keepEditing] - stay in the editor after saving.
 * @param {boolean} [opts.force] - save even though the file changed on disk.
 */
async function savePreviewEdit(opts) {
    const { keepEditing = false, force = false } = opts || {};
    const ta = wsEditorTextarea();
    if (!wsEditing || !wsCurrentFile || !ta) return;
    // Ctrl+S bypasses the button's disabled state, and a second save sent
    // before the first reply carries a stale mtime - which would come back as a
    // conflict against our own write.
    if (wsSaving) return;
    // Writing an untouched file would bump its mtime for nothing.
    if (!force && !wsEditorDirty()) {
        if (!keepEditing) await wsExitEdit();
        return;
    }

    const target = wsCurrentFile;
    const content = ta.value;
    const btn = document.getElementById('ws-btn-save');
    wsSaving = true;
    btn?.classList.add('ws-btn-busy');
    try {
        const res = await fetch('/api/workspace/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: wsEditTargetPath(target),
                content: content,
                session: (typeof sessionId !== 'undefined') ? sessionId : '',
                expected_mtime: force ? null : wsEditBaseMtime,
            }),
        });
        const data = await res.json();
        if (data.code === 'conflict') {
            showConfirmDialog({
                title: t('ws_edit_conflict_title'),
                message: t('ws_edit_conflict_msg'),
                okText: t('ws_edit_overwrite'),
                onConfirm: () => savePreviewEdit({ keepEditing: keepEditing, force: true }),
            });
            return;
        }
        if (data.status !== 'success') throw new Error(data.message || 'save failed');

        wsEditBaseline = content;
        wsEditBaseMtime = data.mtime;
        target.size = data.size;
        target.mtime = data.mtime;
        _wsToast(t('ws_edit_saved'));
        if (keepEditing) {
            wsRenderPreviewTitle();
        } else {
            await wsExitEdit();
        }
    } catch (e) {
        _wsToast(`${t('ws_edit_save_failed')}: ${e.message}`);
    } finally {
        wsSaving = false;
        btn?.classList.remove('ws-btn-busy');
    }
}

function cancelPreviewEdit() {
    if (!wsEditing) return;
    // Retry through wsExitEdit rather than through this function, which bails
    // out on the very flag the guard clears before retrying.
    if (!wsGuardUnsaved(wsExitEdit)) return;
    wsExitEdit();
}

/** Leave edit mode and show the rendered preview again. */
async function wsExitEdit() {
    wsDiscardEditState();
    wsRenderPreviewTitle();
    wsUpdateHeaderActions();
    if (wsCurrentFile) await wsRenderPreview(wsCurrentFile);
}


// Artifact cards, inline file chips, workspace links, and @/# mention autocomplete
// live in workspace-artifacts.js and workspace-mentions.js.

// =====================================================================
// File manager tab
// =====================================================================
function refreshWorkspaceTree() {
    const input = document.getElementById('ws-search-input');
    if (input) input.value = '';
    wsSearchMode = false;
    loadWorkspaceDir(wsCurrentDir);
}

/** Switching the active Agent moves the file panel's root to that Agent's own
 *  workspace (when no project is open). Drop back to the root and reload, but
 *  only if the panel is already open — never pop it open on a switch. */
function resetWorkspaceToAgentRoot() {
    wsCurrentDir = '';
    if (wsPanelOpen) refreshWorkspaceTree();
}

async function loadWorkspaceDir(relPath) {
    const list = document.getElementById('ws-file-list');
    if (!list) return;
    list.innerHTML = `<div class="workspace-empty"><i class="fas fa-spinner fa-spin"></i></div>`;
    try {
        const data = await wsApi(`/api/workspace/tree?path=${encodeURIComponent(relPath || '')}`);
        wsCurrentDir = data.path || '';
        wsCurrentRoot = data.root || wsCurrentRoot;
        wsSearchMode = false;
        // Browsing leaves search mode; drop the stale query from the box.
        const searchBox = document.getElementById('ws-search-input');
        if (searchBox && searchBox.value) searchBox.value = '';
        renderWorkspaceBreadcrumb(wsCurrentDir);
        renderWorkspaceEntries(data.entries, data.truncated);
    } catch (e) {
        list.innerHTML = `<div class="workspace-empty">
            <i class="fas fa-triangle-exclamation"></i><span>${escapeHtml(e.message)}</span></div>`;
    }
}

function renderWorkspaceBreadcrumb(relPath) {
    const bar = document.getElementById('ws-breadcrumb');
    if (!bar) return;
    const parts = (relPath || '').split('/').filter(Boolean);
    // At the root, show the root's absolute path beside the house so the user
    // knows which directory the panel is anchored to. When navigated inside,
    // the deeper crumbs already convey location, so the house stays icon-only.
    const atRoot = parts.length === 0;
    const rootLabel = atRoot && wsCurrentRoot
        ? ` <span class="crumb-root">${escapeHtml(wsCurrentRoot)}</span>`
        : '';
    const crumbs = [`<span class="crumb" data-ws-dir="" data-tooltip="${escapeHtml(wsCurrentRoot || '')}"><i class="fas fa-house"></i>${rootLabel}</span>`];
    let acc = '';
    parts.forEach((p) => {
        acc = acc ? `${acc}/${p}` : p;
        crumbs.push('<span class="sep">/</span>');
        crumbs.push(`<span class="crumb" data-ws-dir="${escapeHtml(acc)}">${escapeHtml(p)}</span>`);
    });
    bar.innerHTML = crumbs.join('');
}

function renderWorkspaceEntries(entries, truncated) {
    const list = document.getElementById('ws-file-list');
    if (!list) return;
    if (!entries || entries.length === 0) {
        list.innerHTML = `<div class="workspace-empty"><i class="fas fa-folder-open"></i>
            <span>${escapeHtml(t('ws_empty_dir'))}</span></div>`;
        return;
    }
    const rows = entries.map(entry => {
        const meta = entry.is_dir ? '' : wsFormatSize(entry.size);
        return `<div class="ws-file-row" ${wsRowAttrs(entry)}>
            <i class="${wsIconClass(entry.kind)}"></i>
            <span class="ws-file-name">${escapeHtml(entry.name)}</span>
            <span class="ws-file-meta">${escapeHtml(meta)}</span>
        </div>`;
    });
    if (truncated) {
        rows.push(`<div class="workspace-empty" style="height:auto;padding:12px;">
            <span>${escapeHtml(t('ws_truncated'))}</span></div>`);
    }
    list.innerHTML = rows.join('');
}

/**
 * Row attributes for a tree/search entry. Everything is draggable into the
 * composer; `data-ws-dir` additionally makes a click navigate rather than
 * preview, since directories have nothing to render.
 */
function wsRowAttrs(entry) {
    const payload = escapeHtml(JSON.stringify(entry));
    const nav = entry.is_dir ? ` data-ws-dir="${escapeHtml(entry.path)}"` : '';
    return `data-ws-file='${payload}' draggable="true"${nav}`;
}

function renderWorkspaceSearchResults(results) {
    const list = document.getElementById('ws-file-list');
    if (!list) return;
    if (!results.length) {
        list.innerHTML = `<div class="workspace-empty"><i class="fas fa-magnifying-glass"></i>
            <span>${escapeHtml(t('ws_no_results'))}</span></div>`;
        return;
    }
    list.innerHTML = results.map(entry => `
        <div class="ws-file-row" ${wsRowAttrs(entry)}>
            <i class="${wsIconClass(entry.kind)}"></i>
            <span class="ws-file-name">${escapeHtml(entry.name)}</span>
            <span class="ws-file-path">${escapeHtml(entry.path)}</span>
        </div>`).join('');
}

async function runWorkspaceSearch(query) {
    if (!query.trim()) {
        loadWorkspaceDir(wsCurrentDir);
        return;
    }
    try {
        const data = await wsApi(`/api/workspace/search?q=${encodeURIComponent(query)}&limit=60`);
        wsSearchMode = true;
        renderWorkspaceSearchResults(data.results || []);
    } catch (e) {
        const list = document.getElementById('ws-file-list');
        if (list) {
            list.innerHTML = `<div class="workspace-empty">
                <i class="fas fa-triangle-exclamation"></i><span>${escapeHtml(e.message)}</span></div>`;
        }
    }
}

function initWorkspaceFilesTab() {
    const list = document.getElementById('ws-file-list');
    const bar = document.getElementById('ws-breadcrumb');
    const input = document.getElementById('ws-search-input');

    bar?.addEventListener('click', (e) => {
        const crumb = e.target.closest('[data-ws-dir]');
        if (crumb) loadWorkspaceDir(crumb.dataset.wsDir);
    });

    list?.addEventListener('click', (e) => {
        const row = e.target.closest('.ws-file-row');
        if (!row) return;
        if (row.dataset.wsDir !== undefined) {
            loadWorkspaceDir(row.dataset.wsDir);
            return;
        }
        list.querySelectorAll('.ws-file-row.active').forEach(el => el.classList.remove('active'));
        row.classList.add('active');
        try { openInPreview(JSON.parse(row.dataset.wsFile)); } catch (_) {}
    });

    list?.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.ws-file-row[data-ws-file]');
        if (!row) return;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-cow-workspace-file', row.dataset.wsFile);
    });

    input?.addEventListener('input', () => {
        clearTimeout(wsSearchTimer);
        const q = input.value;
        wsSearchTimer = setTimeout(() => runWorkspaceSearch(q), 200);
    });
}

// =====================================================================
// Drag a workspace file into the conversation
// =====================================================================
function addWorkspaceRefAttachment(entry) {
    const relPath = entry.path || entry.rel_path || '';
    if (!relPath) return;
    if (pendingAttachments.some(a => a.file_type === 'workspace_ref' && a.file_path === relPath)) return;
    pendingAttachments.push({
        file_path: relPath,
        file_name: entry.name || entry.file_name || relPath.split('/').pop(),
        // Referenced in place; the backend must not treat it as an upload.
        file_type: 'workspace_ref',
        is_dir: !!entry.is_dir,
    });
    renderAttachmentPreview();
}

function addCitationAttachment(entry) {
    const filePath = entry && entry.file_path ? String(entry.file_path) : '';
    const fileType = entry && entry.file_type === 'memory_ref' ? 'memory_ref' : 'knowledge_ref';
    if (!filePath) return;
    if (pendingAttachments.some(a => a.file_type === fileType && a.file_path === filePath)) return;
    pendingAttachments.push({
        file_path: filePath,
        file_name: entry.file_name || filePath.split('/').pop(),
        file_type: fileType,
        is_dir: false,
    });
    renderAttachmentPreview();
}

function initWorkspaceDropTarget() {
    const target = document.getElementById('chat-main');
    if (!target) return;

    const isWorkspaceDrag = (e) =>
        Array.from(e.dataTransfer?.types || []).includes('application/x-cow-workspace-file');

    target.addEventListener('dragover', (e) => {
        if (!isWorkspaceDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        target.classList.add('ws-drop-active');
    });

    // relatedTarget is the node being entered; moving between descendants of the
    // target still fires dragleave, so only clear when the pointer truly left.
    target.addEventListener('dragleave', (e) => {
        if (!target.contains(e.relatedTarget)) target.classList.remove('ws-drop-active');
    });

    // No stopPropagation: the outer #view-chat drop handler owns resetting the
    // upload overlay state, and it ignores drops that carry no files.
    target.addEventListener('drop', (e) => {
        if (!isWorkspaceDrag(e)) return;
        e.preventDefault();
        target.classList.remove('ws-drop-active');
        try {
            addWorkspaceRefAttachment(JSON.parse(e.dataTransfer.getData('application/x-cow-workspace-file')));
        } catch (_) {}
    });
}

/** Re-render the JS-generated parts of the panel after a language switch. */
function relocalizeWorkspacePanel() {
    if (!wsCurrentFile) wsSetPreviewEmpty(t('ws_preview_empty'));
    if (wsActiveTab === 'files' && !wsSearchMode
        && document.getElementById('ws-file-list')?.childElementCount) {
        loadWorkspaceDir(wsCurrentDir);
    }
}

// Reset the panel when the active session changes. The file tree and preview
// are scoped to a session's working dir (project or default), so stale state
// from the previous session must be dropped and, if open, reloaded against the
// new session's root.
function wsOnSessionSwitch() {
    wsCurrentDir = '';
    wsCurrentRoot = '';
    wsSearchMode = false;
    wsCurrentFile = null;
    wsTurnArtifacts = [];
    wsDiscardEditState();
    wsUpdateHeaderActions();
    if (!wsPanelOpen) return;
    if (wsActiveTab === 'files') {
        loadWorkspaceDir('');
    } else {
        wsSetPreviewEmpty(t('ws_preview_empty'));
    }
}

// =====================================================================
// Init
// =====================================================================
function initWorkspacePanel() {
    initWorkspaceResizer();
    initWorkspaceFilesTab();
    initWorkspaceDropTarget();
    if (typeof initMention === 'function') initMention();
    wsSetPreviewEmpty(t('ws_preview_empty'));

    // Reloading or closing the tab would drop an open editor's changes silently.
    window.addEventListener('beforeunload', (e) => {
        if (!wsEditorDirty()) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // The panel belongs to the chat view only; follow view switches.
    const toggle = document.getElementById('workspace-toggle-btn');
    const chatView = document.getElementById('view-chat');
    if (toggle && chatView) {
        const sync = () => toggle.classList.toggle('hidden', !chatView.classList.contains('active'));
        sync();
        new MutationObserver(sync).observe(chatView, { attributes: true, attributeFilter: ['class'] });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkspacePanel);
} else {
    initWorkspacePanel();
}
