/* Workspace panel - artifact cards, inline path chips, and markdown workspace links.
   Split out of workspace.js. Loaded immediately after workspace.js. */

// =====================================================================
// Artifact cards in messages
// =====================================================================

/** Build the HTML for a file card. `meta` needs file_name / kind / raw_url. */
function renderFileCard(meta) {
    const name = meta.file_name || meta.name || '';
    const kind = meta.kind || wsKindOf(name);
    const relPath = meta.rel_path || meta.path || '';
    // Skip the path when it adds nothing beyond the file name already shown.
    const sub = [relPath === name ? '' : relPath, wsFormatSize(meta.size)]
        .filter(Boolean).join(' · ');
    const payload = escapeHtml(JSON.stringify({
        file_name: name,
        rel_path: meta.rel_path || meta.path || '',
        abs_path: meta.abs_path || '',
        kind: kind,
        size: meta.size || 0,
        raw_url: meta.raw_url || '',
        preview_url: meta.preview_url || '',
        previewable: meta.previewable !== false && WS_PREVIEWABLE.has(kind),
        artifact: true,
    }));
    const canPreview = meta.previewable !== false && WS_PREVIEWABLE.has(kind);
    const btn = (action, tipKey, icon) =>
        `<div class="file-card-btn" data-action="${action}" data-tip-key="${tipKey}" data-tip-float
              data-tooltip="${escapeHtml(t(tipKey))}"><i class="fas ${icon}"></i></div>`;
    return `<div class="file-card" data-file='${payload}'>
        <i class="file-card-icon ${wsIconClass(kind)}"></i>
        <div class="file-card-info">
            <div class="file-card-name">${escapeHtml(name)}</div>
            ${sub ? `<div class="file-card-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        <div class="file-card-actions">
            ${canPreview ? btn('preview', 'ws_preview', 'fa-eye') : ''}
            ${btn('download', 'ws_download', 'fa-download')}
            ${btn('artifacts', 'artifacts_view_in', 'fa-layer-group')}
        </div>
    </div>`;
}

/** The turn a message element belongs to: seq of the user message opening it. */
function wsTurnSeqOf(el) {
    let node = el && el.closest('.bot-message-group, .user-message-group');
    while (node && !node.classList.contains('user-message-group')) node = node.previousElementSibling;
    const seq = node ? parseInt(node.dataset.seq, 10) : NaN;
    return Number.isNaN(seq) ? null : seq;
}

/** Append an artifact card to a live bot bubble and remember it for auto-open. */
function appendArtifactCard(container, item) {
    if (!container) return;
    const existing = container.querySelector(`[data-artifact-path="${CSS.escape(item.abs_path || '')}"]`);
    if (existing) return;
    const wrap = document.createElement('div');
    wrap.className = 'file-card-list';
    wrap.dataset.artifactPath = item.abs_path || '';
    wrap.innerHTML = renderFileCard(item);
    container.appendChild(wrap);
    wsTurnArtifacts.push(Object.assign({ artifact: true }, item));
}

function resetTurnArtifacts() {
    wsTurnArtifacts = [];
}

/**
 * Auto-open policy: only when the turn produced exactly one previewable
 * artifact, only while the user hasn't dismissed the panel by hand, and never
 * over an open editor - the file cards stay in the message either way.
 */
function maybeAutoOpenArtifact() {
    const items = wsTurnArtifacts.filter(a => a.previewable);
    wsTurnArtifacts = [];
    if (wsAutoOpenSuppressed || wsEditing || items.length !== 1) return;
    openInPreview(items[0]);
}

/**
 * Render the artifact cards of a history message. The list is built by the
 * backend from the persisted write/edit steps, since only it knows the
 * workspace root and which files still exist.
 */
function renderArtifactCards(artifacts) {
    if (!Array.isArray(artifacts) || !artifacts.length) return '';
    return artifacts.map(item =>
        `<div class="file-card-list" data-artifact-path="${escapeHtml(item.abs_path || '')}">
            ${renderFileCard(item)}
        </div>`
    ).join('');
}

async function wsResolveMeta(meta) {
    if (meta.preview_url && meta.raw_url) return meta;
    const path = meta.abs_path || meta.rel_path || meta.path;
    if (!path) return null;
    return (await wsApi(`/api/workspace/resolve?path=${encodeURIComponent(path)}`)).file;
}

function wsTriggerDownload(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Delegate clicks on file cards, inline path chips and workspace links.
// Delegation (rather than per-element listeners) is what keeps this working
// after a streamed message re-renders its innerHTML.
document.addEventListener('click', async (e) => {
    // A closer handler already claimed this click (e.g. the knowledge viewer
    // navigating between its own documents).
    if (e.defaultPrevented) return;

    // Workspace-relative link inside rendered markdown.
    const wsLink = e.target.closest('a[data-ws-path]');
    if (wsLink) {
        e.preventDefault();
        openWorkspaceLink(wsLink.dataset.wsPath);
        return;
    }

    const chip = e.target.closest('.file-chip');
    if (chip && chip.dataset.path) {
        e.preventDefault();
        openInPreview(chip.dataset.path);
        return;
    }

    // Workspace reference chip inside a user message bubble.
    const ref = e.target.closest('[data-ws-open]');
    if (ref) {
        e.preventDefault();
        openInPreview(ref.dataset.wsOpen);
        return;
    }

    const card = e.target.closest('.file-card');
    if (!card) return;
    e.preventDefault();
    let meta;
    try { meta = JSON.parse(card.dataset.file); } catch (_) { return; }
    // Where the card sits, so the artifacts view can attribute the file to
    // this turn if it has to index it again.
    meta.origin = { session_id: sessionId, agent_id: activeAgentId, turn_seq: wsTurnSeqOf(card) };

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'artifacts') {
        openArtifactsFor(meta);
        return;
    }
    if (action === 'download') {
        if (meta.raw_url) {
            wsTriggerDownload(meta.raw_url, meta.file_name);
            return;
        }
        try {
            const full = await wsResolveMeta(meta);
            if (full) wsTriggerDownload(full.raw_url, full.name);
        } catch (_) {}
        return;
    }
    openInPreview(meta.preview_url ? meta : (meta.abs_path || meta.rel_path));
});

// =====================================================================
// Inline path chips: turn local paths mentioned in text into clickable chips
// =====================================================================
const WS_PATH_EXTS = Object.values(WS_KIND_BY_EXT).flat().join('|');
// Absolute (/Users/..., C:\...), home-relative (~/cow/...) or workspace-relative
// (websites/report.html) paths, always anchored on a known file extension and
// containing at least one separator, which keeps prose like "see report.html"
// from turning into chips. Excluding `:` and `/` before the match is what stops
// the tail of an http(s) URL from being picked up. Excluding every path char
// (CJK included) means a match only starts where a path-like run starts; else
// each CJK char is a start and long Chinese paragraphs scan in quadratic time.
const WS_PATH_RE = new RegExp(
    '(^|[^\\w/\\\\.~:\\-\\u4e00-\\u9fa5])((?:~\\/|\\/|[A-Za-z]:\\\\)?(?:[\\w.\\-\\u4e00-\\u9fa5]+[\\/\\\\])+[\\w.\\-\\u4e00-\\u9fa5]+\\.(?:'
    + WS_PATH_EXTS + '))(?=$|[^\\w.\\-\\u4e00-\\u9fa5]|$)',
    'gi'
);

function _buildFileChip(path) {
    const name = path.split(/[\\/]/).pop();
    const kind = wsKindOf(name);
    return `<span class="file-chip" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">` +
        `<i class="${wsIconClass(kind)}"></i>${escapeHtml(name)}</span>`;
}

/**
 * Rewrite bare file paths in already-rendered markdown into chips.
 * Only touches text nodes outside <pre>/<code>/<a> so code samples and
 * existing links stay untouched.
 */
function injectFileChips(html) {
    if (!html || !html.includes('.')) return html;

    // Split on tags; track whether we're inside a region we must not rewrite.
    let depthSkip = 0;
    return html.split(/(<[^>]+>)/).map((chunk) => {
        if (chunk.startsWith('<')) {
            const tag = chunk.match(/^<\/?\s*([a-zA-Z0-9]+)/);
            const name = tag ? tag[1].toLowerCase() : '';
            if (['pre', 'code', 'a', 'img', 'video', 'audio'].includes(name)) {
                if (chunk.startsWith('</')) depthSkip = Math.max(0, depthSkip - 1);
                else if (!chunk.endsWith('/>')) depthSkip += 1;
            }
            return chunk;
        }
        if (depthSkip > 0 || !chunk.trim()) return chunk;
        return chunk.replace(WS_PATH_RE, (match, lead, path) =>
            path.includes('://') ? match : lead + _buildFileChip(path)
        );
    }).join('');
}

// =====================================================================
// Workspace links inside rendered markdown
// =====================================================================
/**
 * Decide whether an href points at a workspace file rather than the web.
 *
 * Agent replies cite their own files with a workspace-relative markdown link
 * (`[title](knowledge/x.md)`). The browser would resolve those against the
 * console URL and open a 404 in a new tab, so they need routing to the
 * preview panel instead.
 *
 * @returns {string|null} the cleaned workspace path, or null if not one.
 */
function wsWorkspaceHref(href) {
    if (!href) return null;
    // A scheme (http, mailto, file, data), a protocol-relative host, an
    // in-page anchor or a site-absolute path is never a workspace file.
    if (/^[a-zA-Z][\w+.-]*:/.test(href)) return null;
    if (href.startsWith('//') || href.startsWith('#') || href.startsWith('/')) return null;

    let path = href.split('#')[0].split('?')[0].trim();
    // markdown-it percent-encodes non-ASCII hrefs; the API wants them raw.
    try { path = decodeURI(path); } catch (_) {}
    if (!path) return null;
    // Require a known extension so prose links stay untouched.
    return WS_EXT_KIND[(path.split('.').pop() || '').toLowerCase()] ? path : null;
}

/**
 * Open a workspace file referenced by a link in a rendered message.
 * Agent links are occasionally relative to the citing document rather than to
 * the workspace root, so fall back to a filename search before giving up.
 */
async function openWorkspaceLink(path) {
    // The panel lives in the chat view, so a link clicked from elsewhere (the
    // knowledge reader, a memory file) would otherwise open out of sight.
    if (typeof navigateTo === 'function' && currentView !== 'chat') navigateTo('chat');

    try {
        const data = await wsApi(`/api/workspace/resolve?path=${encodeURIComponent(path)}`);
        openInPreview(data.file);
        return;
    } catch (_) { /* fall through to the name search */ }

    const name = path.split('/').pop();
    try {
        const data = await wsApi(`/api/workspace/search?q=${encodeURIComponent(name)}&limit=10`);
        const hit = (data.results || []).find(r => !r.is_dir && r.name === name);
        if (hit) {
            openInPreview(hit);
            return;
        }
    } catch (_) {}

    openWorkspacePanel('preview');
    switchWorkspaceTab('preview');
    wsSetPreviewEmpty(`${t('ws_link_not_found')}: ${path}`, 'fa-triangle-exclamation');
}

