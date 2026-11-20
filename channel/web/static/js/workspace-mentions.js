/* Workspace panel - @ file/agent & # knowledge/memory mention autocomplete.
   Split out of workspace.js. Loaded immediately after workspace-artifacts.js. */

// =====================================================================
// @ file/agent & # knowledge/memory references in the chat input
// =====================================================================
let mentionActive = false;
let mentionMode = 'at'; // 'at' | 'hash'
let mentionStart = -1;
let mentionItems = [];
let mentionIndex = 0;
let mentionTimer = null;

function hideMentionMenu() {
    mentionActive = false;
    mentionMode = 'at';
    mentionStart = -1;
    mentionItems = [];
    document.getElementById('mention-menu')?.classList.add('hidden');
}

function _memoryBadgeLabel(type) {
    if (type === 'dream') return t('cite_kind_dream') || 'Dream';
    if (type === 'evolution') return t('cite_kind_evolution') || 'Evolution';
    return t('cite_kind_memory') || 'Memory';
}

function renderMentionMenu() {
    const menu = document.getElementById('mention-menu');
    if (!menu) return;
    if (!mentionItems.length) {
        menu.innerHTML = `<div class="mention-empty">${escapeHtml(t('ws_no_results'))}</div>`;
        menu.classList.remove('hidden');
        return;
    }
    menu.innerHTML = mentionItems.map((item, i) => {
        if (item.kind === 'agent') {
            const face = typeof agentAvatarHTML === 'function'
                ? agentAvatarHTML(item, 20)
                : `<i class="fas fa-user"></i>`;
            return `<div class="mention-item ${i === mentionIndex ? 'active' : ''}" data-idx="${i}">
                ${face}
                <span class="m-name">${escapeHtml(item.name)}</span>
                <span class="m-path">${escapeHtml(item.id)}</span>
            </div>`;
        }
        if (item.kind === 'knowledge_ref') {
            return `<div class="mention-item ${i === mentionIndex ? 'active' : ''}" data-idx="${i}">
                <i class="fas fa-book text-emerald-500"></i>
                <span class="m-name">${escapeHtml(item.title || item.path)}</span>
                <span class="m-path">${escapeHtml((t('cite_kind_knowledge') || 'Knowledge') + ' · ' + item.path)}</span>
            </div>`;
        }
        if (item.kind === 'memory_ref') {
            const mIcon = item.memType === 'dream' ? 'fa-moon text-violet-500'
                : (item.memType === 'evolution' ? 'fa-seedling text-emerald-500' : 'fa-brain text-purple-500');
            return `<div class="mention-item ${i === mentionIndex ? 'active' : ''}" data-idx="${i}">
                <i class="fas ${mIcon}"></i>
                <span class="m-name">${escapeHtml(item.filename)}</span>
                <span class="m-path">${escapeHtml(_memoryBadgeLabel(item.memType))}</span>
            </div>`;
        }
        return `<div class="mention-item ${i === mentionIndex ? 'active' : ''}" data-idx="${i}">
            <i class="${wsIconClass(item.kind)}"></i>
            <span class="m-name">${escapeHtml(item.name)}</span>
            <span class="m-path">${escapeHtml(item.path)}</span>
        </div>`;
    }).join('');
    menu.classList.remove('hidden');
}

function matchingAgentMentions(query) {
    // @ addresses one Agent in particular, which only means something once a
    // conversation has more than its owner. A solo chat keeps @ as the file
    // picker it always was.
    if (typeof sharedConversation !== 'function' || !sharedConversation()) return [];
    const q = String(query || '').toLowerCase();
    // The owner is offered alongside its teammates: in a group chat it is one
    // voice among several, and @ is how the user picks it back out after a
    // teammate has been speaking. sessionRoster() already lists it first.
    const roster = typeof sessionRoster === 'function' ? sessionRoster() : [];
    return roster
        .filter(agent => !q || agent.id.toLowerCase().includes(q) || String(agent.name).toLowerCase().includes(q))
        .slice(0, 6)
        .map(agent => ({ kind: 'agent', id: agent.id, name: agent.name, avatar: agent.avatar || '' }));
}

async function updateHashMentionQuery(query) {
    const q = String(query || '').trim();
    const agent = typeof activeAgentId !== 'undefined' ? activeAgentId : '';
    const [kbRes, memRes] = await Promise.all([
        fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}&limit=8&agent_id=${encodeURIComponent(agent || '')}`)
            .then(r => r.json()).catch(() => ({ results: [] })),
        fetch(`/api/memory/search?q=${encodeURIComponent(q)}&category=all&limit=8&agent_id=${encodeURIComponent(agent || '')}`)
            .then(r => r.json()).catch(() => ({ results: [] })),
    ]);
    if (!mentionActive || mentionMode !== 'hash') return;
    const kbItems = (kbRes.results || []).map(item => ({
        kind: 'knowledge_ref',
        path: item.path,
        title: item.title || item.path,
    }));
    const memItems = (memRes.results || []).map(item => ({
        kind: 'memory_ref',
        path: item.rel_path || item.filename,
        filename: item.filename,
        memType: item.type || 'daily',
    }));
    mentionItems = kbItems.concat(memItems);
    mentionIndex = 0;
    renderMentionMenu();
}

async function updateMentionQuery(query) {
    if (mentionMode === 'hash') {
        await updateHashMentionQuery(query);
        return;
    }
    const agents = matchingAgentMentions(query);
    try {
        const data = await wsApi(`/api/workspace/search?q=${encodeURIComponent(query)}&limit=12`);
        if (!mentionActive || mentionMode !== 'at') return;
        mentionItems = agents.concat(data.results || []);
        mentionIndex = 0;
        renderMentionMenu();
    } catch (_) {
        if (!mentionActive || mentionMode !== 'at') return;
        mentionItems = agents;
        mentionIndex = 0;
        if (agents.length) renderMentionMenu();
        else hideMentionMenu();
    }
}

function acceptMention(idx) {
    const item = mentionItems[idx];
    const input = document.getElementById('chat-input');
    if (!item || !input) return;
    const before = input.value.slice(0, mentionStart);
    const after = input.value.slice(input.selectionStart);
    if (item.kind === 'agent') {
        // Write the name, not the id: the mention is addressed to a colleague
        // and should read like one. The server resolves either form.
        const inserted = `@${item.name || item.id} `;
        input.value = before + inserted + after;
        input.selectionStart = input.selectionEnd = before.length + inserted.length;
        if (typeof addTeamMember === 'function') addTeamMember(item.id);
    } else if (item.kind === 'knowledge_ref' || item.kind === 'memory_ref') {
        addCitationAttachment({
            file_path: item.path,
            file_name: item.title || item.filename || item.path.split('/').pop(),
            file_type: item.kind,
        });
        input.value = before + after;
        input.selectionStart = input.selectionEnd = before.length;
    } else {
        addWorkspaceRefAttachment(item);
        // Drop the "@query" fragment: the file travels as an attachment, not as text.
        input.value = before + after;
        input.selectionStart = input.selectionEnd = before.length;
    }
    hideMentionMenu();
    input.focus();
    input.dispatchEvent(new Event('input'));
}

let mentionInitialized = false;
function initMention() {
    if (mentionInitialized) return;
    const input = document.getElementById('chat-input');
    const menu = document.getElementById('mention-menu');
    if (!input || !menu) return;
    mentionInitialized = true;

    input.addEventListener('input', () => {
        const pos = input.selectionStart;
        const before = input.value.slice(0, pos);
        // Trigger on "@" or "#" at the start of the input or after whitespace.
        const atMatch = before.match(/(?:^|\s)@([^\s@]*)$/);
        const hashMatch = atMatch ? null : before.match(/(?:^|\s)#([^\s#]*)$/);
        if (!atMatch && !hashMatch) {
            if (mentionActive) hideMentionMenu();
            return;
        }
        mentionActive = true;
        if (atMatch) {
            mentionMode = 'at';
            mentionStart = pos - atMatch[1].length - 1;
        } else {
            mentionMode = 'hash';
            mentionStart = pos - hashMatch[1].length - 1;
        }
        clearTimeout(mentionTimer);
        const q = atMatch ? atMatch[1] : hashMatch[1];
        mentionTimer = setTimeout(() => updateMentionQuery(q), 150);
    });

    // Capture phase so Enter/arrows are consumed before the send handler.
    input.addEventListener('keydown', (e) => {
        if (!mentionActive || !mentionItems.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopImmediatePropagation();
            mentionIndex = (mentionIndex + 1) % mentionItems.length;
            renderMentionMenu();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopImmediatePropagation();
            mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
            renderMentionMenu();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation();
            acceptMention(mentionIndex);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            hideMentionMenu();
        }
    }, true);

    menu.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.mention-item');
        if (!item) return;
        e.preventDefault();
        acceptMention(parseInt(item.dataset.idx, 10));
    });

    document.addEventListener('click', (e) => {
        if (mentionActive && !menu.contains(e.target) && e.target !== input) hideMentionMenu();
    });
}


if (document.readyState !== 'loading') {
    initMention();
}
