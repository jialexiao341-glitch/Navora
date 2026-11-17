/* Memory file list.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Memory View
// =====================================================================
let memoryPage = 1;
let memoryCategory = 'memory';   // 'memory' | 'evolution'
const memoryPageSize = 10;
let _memorySearchTimer = null;
let _memorySearchSeq = 0;

function _memoryTypeBadge(type) {
    if (type === 'global') {
        return '<span class="px-2 py-0.5 rounded-full text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">Global</span>';
    }
    if (type === 'evolution') {
        return '<span class="px-2 py-0.5 rounded-full text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">Evolution</span>';
    }
    if (type === 'dream') {
        return '<span class="px-2 py-0.5 rounded-full text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">Dream</span>';
    }
    return '<span class="px-2 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">Daily</span>';
}

function citeMemoryToChat(relPath, filename) {
    if (!relPath || typeof addCitationAttachment !== 'function') return;
    addCitationAttachment({
        file_path: relPath,
        file_name: filename || relPath.split('/').pop(),
        file_type: 'memory_ref',
    });
    if (typeof navigateTo === 'function') navigateTo('chat');
    document.getElementById('chat-input')?.focus();
}

function clearMemorySearch() {
    const input = document.getElementById('memory-search-input');
    if (input) input.value = '';
    onMemorySearchInput('');
}

function onMemorySearchInput(rawQuery) {
    const query = String(rawQuery || '').trim();
    const clearBtn = document.getElementById('memory-search-clear');
    const resultsEl = document.getElementById('memory-search-results');
    const listEl = document.getElementById('memory-list');
    const emptyEl = document.getElementById('memory-empty');
    if (clearBtn) clearBtn.classList.toggle('hidden', !query);
    clearTimeout(_memorySearchTimer);
    if (!query) {
        if (resultsEl) {
            resultsEl.innerHTML = '';
            resultsEl.classList.add('hidden');
        }
        loadMemoryView(memoryPage);
        return;
    }
    _memorySearchTimer = setTimeout(() => {
        const seq = ++_memorySearchSeq;
        const agent = viewingMemoryAgentId();
        const cat = memoryCategory === 'evolution' ? 'evolution' : 'all';
        fetch(`/api/memory/search?q=${encodeURIComponent(query)}&category=${cat}&limit=30&agent_id=${encodeURIComponent(agent || '')}`)
            .then(r => r.json())
            .then(data => {
                if (seq !== _memorySearchSeq || data.status !== 'success') return;
                if (listEl) listEl.classList.add('hidden');
                if (emptyEl) emptyEl.classList.add('hidden');
                if (!resultsEl) return;
                const items = data.results || [];
                if (!items.length) {
                    resultsEl.innerHTML = `<div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-8 text-center text-sm text-slate-400 dark:text-slate-500">${escapeHtml(t('memory_search_empty'))}</div>`;
                    resultsEl.classList.remove('hidden');
                    return;
                }
                resultsEl.innerHTML = '';
                items.forEach(item => {
                    const card = document.createElement('div');
                    card.className = 'bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-4 hover:border-primary-300 dark:hover:border-primary-500/40 cursor-pointer transition-colors';
                    const fileCategory = (item.type === 'dream' || item.type === 'evolution') ? item.type : 'memory';
                    card.onclick = () => openMemoryFile(item.filename, fileCategory);
                    const hitsLabel = t('memory_search_hits').replace('{n}', String(item.match_count || 0));
                    const snippetsHtml = (item.snippets || []).map(sn =>
                        `<div class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed truncate"><span class="font-mono text-[10px] text-slate-400 mr-1.5">L${sn.line}</span>${highlightSearchTerms(sn.text, query)}</div>`
                    ).join('');
                    card.innerHTML = `
                        <div class="flex items-center gap-2 mb-1.5">
                            <span class="text-sm font-mono font-medium text-slate-800 dark:text-slate-100 truncate">${highlightSearchTerms(item.filename, query)}</span>
                            ${_memoryTypeBadge(item.type)}
                            <span class="text-xs text-slate-400 dark:text-slate-500 ml-auto">${escapeHtml(hitsLabel)}</span>
                            <button type="button" class="cite-btn px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-500/20 cursor-pointer">
                                <i class="fas fa-at mr-1 text-[10px]"></i>${escapeHtml(t('cite_to_chat'))}
                            </button>
                        </div>
                        ${snippetsHtml ? `<div class="space-y-1 mt-2 pl-2 border-l-2 border-slate-200 dark:border-white/10">${snippetsHtml}</div>` : ''}`;
                    card.querySelector('.cite-btn')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        citeMemoryToChat(item.rel_path || item.filename, item.filename);
                    });
                    resultsEl.appendChild(card);
                });
                resultsEl.classList.remove('hidden');
            })
            .catch(() => {});
    }, 200);
}

function switchMemoryTab(tab) {
    document.querySelectorAll('.memory-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('memory-tab-' + tab).classList.add('active');
    // The "dreams" tab now surfaces self-evolution logs (merged with dream diaries).
    memoryCategory = tab === 'dreams' ? 'evolution' : 'memory';
    const q = document.getElementById('memory-search-input')?.value?.trim() || '';
    if (q) onMemorySearchInput(q);
    else loadMemoryView(1);
    routeNoteTab('memory', tab);
}

function loadMemoryView(page) {
    const activeQuery = document.getElementById('memory-search-input')?.value?.trim() || '';
    if (activeQuery) {
        onMemorySearchInput(activeQuery);
        return;
    }
    page = page || 1;
    memoryPage = page;
    const agent = viewingMemoryAgentId();
    fetch(`/api/memory?page=${page}&page_size=${memoryPageSize}&category=${memoryCategory}&agent_id=${encodeURIComponent(agent || '')}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const emptyEl = document.getElementById('memory-empty');
        const listEl = document.getElementById('memory-list');
        const files = data.list || [];
        const total = data.total || 0;

        if (total === 0) {
            const emptyIcon = emptyEl.querySelector('i');
            const emptyTitle = emptyEl.querySelector('p');
            if (memoryCategory === 'evolution') {
                emptyIcon.className = 'fas fa-seedling text-emerald-400 text-xl';
                emptyTitle.textContent = currentLang === 'zh' ? '暂无进化记录' : 'No evolution records yet';
            } else {
                emptyIcon.className = 'fas fa-brain text-purple-400 text-xl';
                emptyTitle.textContent = currentLang === 'zh' ? '暂无记忆文件' : 'No memory files';
            }
            emptyEl.classList.remove('hidden');
            listEl.classList.add('hidden');
            return;
        }
        emptyEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        const tbody = document.getElementById('memory-table-body');
        tbody.innerHTML = '';
        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors';
            // In the merged evolution tab, resolve each file by its own origin
            // (evolution logs vs dream diaries live in different dirs).
            const fileCategory = (f.type === 'dream' || f.type === 'evolution') ? f.type : memoryCategory;
            tr.onclick = () => openMemoryFile(f.filename, fileCategory);
            const typeLabel = _memoryTypeBadge(f.type);
            const sizeStr = f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB';
            tr.innerHTML = `
                <td class="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-200">${escapeHtml(f.filename)}</td>
                <td class="px-4 py-3 text-sm">${typeLabel}</td>
                <td class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">${sizeStr}</td>
                <td class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">${escapeHtml(f.updated_at)}</td>`;
            tbody.appendChild(tr);
        });

        // Pagination
        const totalPages = Math.ceil(total / memoryPageSize);
        const pagEl = document.getElementById('memory-pagination');
        if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
        let pagHtml = `<span>${page} / ${totalPages}</span><div class="flex gap-2">`;
        if (page > 1) pagHtml += `<button onclick="loadMemoryView(${page - 1})" class="px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-xs">Prev</button>`;
        if (page < totalPages) pagHtml += `<button onclick="loadMemoryView(${page + 1})" class="px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-xs">Next</button>`;
        pagHtml += '</div>';
        pagEl.innerHTML = pagHtml;
    }).catch(() => {});
}

