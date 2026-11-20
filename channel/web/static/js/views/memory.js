/* Memory file list, vector index status, and self-evolution snapshot rollback.
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
let _memoryIndexPollTimer = null;
let _memoryIndexWasRebuilding = false;
let _activeDiffBackupId = '';

function _memoryTr(key, fallback) {
    if (typeof t === 'function') {
        const val = t(key);
        if (val && val !== key) return val;
    }
    return fallback || key;
}

function _memoryEsc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(str);
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatMemoryIndexWarnings(data, tr = _memoryTr) {
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    const lines = [];
    for (const code of warnings) {
        if (code === 'no_provider') {
            lines.push({
                tone: 'info',
                text: tr('memory_index_warn_no_provider', '未配置可用的向量模型（可在「设置 → 模型」配置），当前仅使用关键词检索。'),
            });
        } else if (code === 'missing_vectors') {
            lines.push({
                tone: 'warn',
                text: tr('memory_index_warn_missing', '{n} 个片段尚未生成向量，建议重建索引以启用完整语义检索。')
                    .replace('{n}', String(data?.missing_chunks || 0)),
            });
        } else if (code === 'dim_mismatch') {
            lines.push({
                tone: 'warn',
                text: tr('memory_index_warn_dim', '存量向量为 {index_dim} 维，与当前配置 {cfg_dim} 维不一致；请重建索引使向量检索生效。')
                    .replace('{index_dim}', String(data?.index_dim ?? '?'))
                    .replace('{cfg_dim}', String(data?.embedding_dim ?? '?')),
            });
        } else if (code === 'chunker_outdated') {
            lines.push({
                tone: 'muted',
                text: tr('memory_index_warn_chunker', '索引由旧版切分算法生成，可按需重建索引以同步最新分片规则。'),
            });
        }
    }
    return lines;
}

function renderUnifiedDiffHtml(diffText) {
    const raw = String(diffText || '');
    if (!raw.trim()) return '';
    return raw.split('\n').map(line => {
        const safe = _memoryEsc(line);
        if (line.startsWith('+++') || line.startsWith('---')) {
            return `<div class="px-3 py-0.5 text-[11px] font-mono text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-white/[0.03]">${safe}</div>`;
        }
        if (line.startsWith('@@')) {
            return `<div class="px-3 py-0.5 text-[11px] font-mono text-sky-600 dark:text-sky-400 bg-sky-50/70 dark:bg-sky-950/30">${safe}</div>`;
        }
        if (line.startsWith('+')) {
            return `<div class="px-3 py-0.5 text-xs font-mono whitespace-pre-wrap break-all text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/30">${safe}</div>`;
        }
        if (line.startsWith('-')) {
            return `<div class="px-3 py-0.5 text-xs font-mono whitespace-pre-wrap break-all text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/30">${safe}</div>`;
        }
        return `<div class="px-3 py-0.5 text-xs font-mono whitespace-pre-wrap break-all text-slate-600 dark:text-slate-300">${safe || '&nbsp;'}</div>`;
    }).join('');
}

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
                    resultsEl.innerHTML = `<div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-8 text-center text-sm text-slate-400 dark:text-slate-500">${_memoryEsc(t('memory_search_empty'))}</div>`;
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
                            <span class="text-xs text-slate-400 dark:text-slate-500 ml-auto">${_memoryEsc(hitsLabel)}</span>
                            <button type="button" class="cite-btn px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-500/20 cursor-pointer">
                                <i class="fas fa-at mr-1 text-[10px]"></i>${_memoryEsc(t('cite_to_chat'))}
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

function _renderMemoryIndexCard(data) {
    const card = document.getElementById('memory-index-card');
    if (!card || !data) return;
    card.classList.toggle('hidden', memoryCategory !== 'memory');

    const modeEl = document.getElementById('memory-index-mode');
    const modelEl = document.getElementById('memory-index-model');
    const statsEl = document.getElementById('memory-index-stats');
    const warnEl = document.getElementById('memory-index-warnings');
    const btn = document.getElementById('memory-rebuild-btn');
    const icon = document.getElementById('memory-rebuild-icon');
    const label = document.getElementById('memory-rebuild-label');

    if (modeEl) {
        if (data.search_mode === 'hybrid') {
            modeEl.textContent = _memoryTr('memory_index_mode_hybrid', '混合检索 (向量 + 关键词)');
            modeEl.className = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400';
        } else if (data.search_mode === 'hybrid_pending') {
            modeEl.textContent = _memoryTr('memory_index_mode_pending', '混合检索 (待构建向量)');
            modeEl.className = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400';
        } else {
            modeEl.textContent = _memoryTr('memory_index_mode_keyword', '仅关键词检索 (FTS5)');
            modeEl.className = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300';
        }
    }

    if (modelEl) {
        if (data.embedding_configured && data.embedding_provider) {
            const dimLabel = data.embedding_dim ? ` · ${data.embedding_dim}d` : '';
            const rerankLabel = data.rerank_enabled ? ` · ${_memoryTr('memory_index_rerank', '已启用重排')}` : '';
            modelEl.textContent = `${data.embedding_provider}${data.embedding_model ? ' / ' + data.embedding_model : ''}${dimLabel}${rerankLabel}`;
        } else {
            modelEl.textContent = '';
        }
    }

    if (statsEl) {
        statsEl.textContent = _memoryTr('memory_index_stats_tpl', '{files} 个文件 · {chunks} 个片段 · {embedded} 个已向量化')
            .replace('{files}', String(data.files ?? 0))
            .replace('{chunks}', String(data.chunks ?? 0))
            .replace('{embedded}', String(data.embedded ?? 0));
    }

    if (warnEl) {
        const items = formatMemoryIndexWarnings(data, _memoryTr);
        if (!items.length) {
            warnEl.innerHTML = '';
            warnEl.classList.add('hidden');
        } else {
            warnEl.innerHTML = items.map(item => {
                const cls = item.tone === 'warn'
                    ? 'text-amber-600 dark:text-amber-400'
                    : item.tone === 'info'
                        ? 'text-slate-500 dark:text-slate-400'
                        : 'text-slate-400 dark:text-slate-500';
                const iconCls = item.tone === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info';
                return `<div class="text-xs flex items-start gap-1.5 ${cls}"><i class="fas ${iconCls} text-[11px] mt-0.5 shrink-0"></i><span>${_memoryEsc(item.text)}</span></div>`;
            }).join('');
            warnEl.classList.remove('hidden');
        }
    }

    const rebuilding = Boolean(data.rebuilding);
    if (btn) {
        btn.disabled = rebuilding || !data.embedding_configured;
    }
    if (icon) {
        icon.className = rebuilding ? 'fas fa-spinner fa-spin text-[11px]' : 'fas fa-rotate text-[11px]';
    }
    if (label) {
        label.textContent = rebuilding
            ? _memoryTr('memory_index_rebuilding', '重建中…')
            : _memoryTr('memory_index_rebuild', '重建索引');
    }
}

function loadMemoryIndexStatus() {
    if (memoryCategory !== 'memory') {
        document.getElementById('memory-index-card')?.classList.add('hidden');
        return;
    }
    const agent = typeof viewingMemoryAgentId === 'function' ? viewingMemoryAgentId() : '';
    fetch(`/api/memory/index?agent_id=${encodeURIComponent(agent || '')}`)
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') return;
            _renderMemoryIndexCard(data);
            const rebuilding = Boolean(data.rebuilding);
            if (_memoryIndexWasRebuilding && !rebuilding && data.last_rebuild) {
                if (typeof _wsToast === 'function') {
                    if (data.last_rebuild.ok) {
                        _wsToast(_memoryTr('memory_index_rebuild_done', '索引重建完成：{files} 个文件，{chunks} 个片段已向量化')
                            .replace('{files}', String(data.last_rebuild.files ?? 0))
                            .replace('{chunks}', String(data.last_rebuild.chunks ?? 0)));
                    } else {
                        _wsToast(_memoryTr('memory_index_rebuild_failed', '索引重建失败：{error}')
                            .replace('{error}', data.last_rebuild.error || 'unknown error'));
                    }
                }
            }
            _memoryIndexWasRebuilding = rebuilding;
            clearTimeout(_memoryIndexPollTimer);
            if (rebuilding) {
                _memoryIndexPollTimer = setTimeout(loadMemoryIndexStatus, 1500);
            }
        })
        .catch(() => {});
}

function triggerMemoryIndexRebuild() {
    const startRebuild = () => {
        const agent = typeof viewingMemoryAgentId === 'function' ? viewingMemoryAgentId() : '';
        const btn = document.getElementById('memory-rebuild-btn');
        const icon = document.getElementById('memory-rebuild-icon');
        const label = document.getElementById('memory-rebuild-label');
        if (btn) btn.disabled = true;
        if (icon) icon.className = 'fas fa-spinner fa-spin text-[11px]';
        if (label) label.textContent = _memoryTr('memory_index_rebuilding', '重建中…');

        fetch('/api/memory/index/rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agent || '' }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') {
                    if (typeof _wsToast === 'function') {
                        _wsToast(_memoryTr('memory_index_rebuild_failed', '索引重建失败：{error}')
                            .replace('{error}', data.message || 'error'));
                    }
                    loadMemoryIndexStatus();
                    return;
                }
                _memoryIndexWasRebuilding = true;
                if (typeof _wsToast === 'function') {
                    _wsToast(_memoryTr('memory_index_rebuild_started', '向量索引正在后台重建…'));
                }
                clearTimeout(_memoryIndexPollTimer);
                _memoryIndexPollTimer = setTimeout(loadMemoryIndexStatus, 1000);
            })
            .catch(err => {
                if (typeof _wsToast === 'function') {
                    _wsToast(_memoryTr('memory_index_rebuild_failed', '索引重建失败：{error}')
                        .replace('{error}', err?.message || 'network error'));
                }
                loadMemoryIndexStatus();
            });
    };

    if (typeof showConfirmDialog === 'function') {
        showConfirmDialog({
            title: _memoryTr('memory_index_rebuild_confirm_title', '重建记忆向量索引'),
            message: _memoryTr('memory_index_rebuild_confirm_msg', '将清空并重新向量化当前工作区的所有记忆与知识片段，过程需要调用 Embedding 模型接口。确定继续吗？'),
            okText: _memoryTr('memory_index_rebuild', '重建索引'),
            tone: 'primary',
            onConfirm: startRebuild,
        });
    } else {
        startRebuild();
    }
}

function loadEvolutionBackups() {
    const section = document.getElementById('evolution-backups-section');
    const listEl = document.getElementById('evolution-backups-list');
    const countEl = document.getElementById('evolution-backups-count');
    if (!section || !listEl) return;
    if (memoryCategory !== 'evolution') {
        section.classList.add('hidden');
        return;
    }
    const agent = typeof viewingMemoryAgentId === 'function' ? viewingMemoryAgentId() : '';
    fetch(`/api/memory/evolution/backups?agent_id=${encodeURIComponent(agent || '')}`)
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                section.classList.add('hidden');
                return;
            }
            const backups = data.backups || [];
            if (!backups.length) {
                section.classList.add('hidden');
                listEl.innerHTML = '';
                return;
            }
            if (countEl) {
                countEl.textContent = _memoryTr('evo_backups_count_tpl', '共 {n} 个快照').replace('{n}', String(backups.length));
            }
            listEl.innerHTML = '';
            backups.forEach(item => {
                const row = document.createElement('div');
                row.className = 'px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors';
                const changedCount = Number(item.changed_count || 0);
                const badge = changedCount > 0
                    ? `<span class="px-2 py-0.5 rounded-full text-[11px] bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">${_memoryEsc(_memoryTr('evo_backup_changed_tpl', '{n} 个文件有变更').replace('{n}', String(changedCount)))}</span>`
                    : `<span class="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400">${_memoryEsc(_memoryTr('evo_backup_unchanged', '与当前一致'))}</span>`;
                const fileNames = (item.files || []).filter(f => f.changed).map(f => f.rel).slice(0, 3);
                const filesHint = fileNames.length
                    ? `<div class="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate mt-1">${_memoryEsc(fileNames.join(' · '))}${changedCount > 3 ? ' …' : ''}</div>`
                    : '';

                row.innerHTML = `
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-xs font-mono font-medium text-slate-700 dark:text-slate-200">${_memoryEsc(item.created_at || item.backup_id)}</span>
                            <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">${_memoryEsc(item.backup_id)}</span>
                            ${badge}
                        </div>
                        ${filesHint}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" class="evo-diff-btn px-2.5 py-1 rounded-lg text-xs border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer transition-colors">
                            <i class="fas fa-code-compare mr-1 text-[11px]"></i>${_memoryEsc(_memoryTr('evo_view_diff', '查看变更'))}
                        </button>
                        <button type="button" class="evo-restore-btn px-2.5 py-1 rounded-lg text-xs bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors" ${changedCount === 0 ? 'disabled' : ''}>
                            <i class="fas fa-rotate-left mr-1 text-[11px]"></i>${_memoryEsc(_memoryTr('evo_restore_short', '回滚'))}
                        </button>
                    </div>`;
                row.querySelector('.evo-diff-btn')?.addEventListener('click', () => openEvolutionDiff(item.backup_id));
                row.querySelector('.evo-restore-btn')?.addEventListener('click', () => confirmRestoreEvolutionBackup(item.backup_id, changedCount));
                listEl.appendChild(row);
            });
            section.classList.remove('hidden');
        })
        .catch(() => {
            section.classList.add('hidden');
        });
}

function openEvolutionDiff(backupId) {
    if (!backupId) return;
    _activeDiffBackupId = backupId;
    const agent = typeof viewingMemoryAgentId === 'function' ? viewingMemoryAgentId() : '';
    fetch(`/api/memory/evolution/diff?backup_id=${encodeURIComponent(backupId)}&agent_id=${encodeURIComponent(agent || '')}`)
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                if (typeof _wsToast === 'function') _wsToast(data.message || 'Failed to load snapshot diff');
                return;
            }
            document.getElementById('memory-panel-list')?.classList.add('hidden');
            document.getElementById('memory-panel-viewer')?.classList.add('hidden');
            document.getElementById('memory-panel-diff')?.classList.remove('hidden');

            const titleEl = document.getElementById('evolution-diff-title');
            const subEl = document.getElementById('evolution-diff-subtitle');
            const restoreBtn = document.getElementById('evolution-diff-restore-btn');
            const filesEl = document.getElementById('evolution-diff-files');

            if (titleEl) titleEl.textContent = data.backup_id || backupId;
            if (subEl) {
                subEl.textContent = _memoryTr('evo_diff_subtitle_tpl', '快照时间 {time} · {n} 个文件与当前存在差异（红色为快照旧内容，绿色为当前新增内容）')
                    .replace('{time}', data.created_at || '')
                    .replace('{n}', String(data.changed_count ?? 0));
            }
            if (restoreBtn) {
                restoreBtn.disabled = Number(data.changed_count || 0) === 0;
                restoreBtn.onclick = () => confirmRestoreEvolutionBackup(backupId, Number(data.changed_count || 0));
            }

            if (filesEl) {
                const changedFiles = (data.files || []).filter(f => f.changed);
                if (!changedFiles.length) {
                    filesEl.innerHTML = `<div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10 p-8 text-center text-sm text-slate-400 dark:text-slate-500">${_memoryEsc(_memoryTr('evo_diff_no_changes', '此快照与当前文件内容完全一致，无需回滚。'))}</div>`;
                } else {
                    filesEl.innerHTML = changedFiles.map(f => {
                        const meta = [];
                        if (f.added_lines) meta.push(`<span class="text-emerald-600 dark:text-emerald-400">+${f.added_lines}</span>`);
                        if (f.removed_lines) meta.push(`<span class="text-rose-600 dark:text-rose-400">-${f.removed_lines}</span>`);
                        if (!f.current_exists) meta.push(`<span class="text-rose-500">${_memoryEsc(_memoryTr('evo_diff_missing_current', '当前文件已被删除'))}</span>`);
                        if (f.truncated) meta.push(`<span class="text-amber-500">${_memoryEsc(_memoryTr('evo_diff_truncated', 'Diff 内容过长，已截断部分展示'))}</span>`);
                        return `
                            <div class="bg-panel rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                                <div class="px-4 py-2.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
                                    <span class="text-xs font-mono font-medium text-slate-700 dark:text-slate-200">${_memoryEsc(f.rel)}</span>
                                    <span class="text-xs font-mono flex items-center gap-2">${meta.join(' ')}</span>
                                </div>
                                <div class="overflow-x-auto max-h-96 overflow-y-auto">${renderUnifiedDiffHtml(f.diff)}</div>
                            </div>`;
                    }).join('');
                }
            }
        })
        .catch(() => {});
}

function closeEvolutionDiff() {
    _activeDiffBackupId = '';
    document.getElementById('memory-panel-diff')?.classList.add('hidden');
    document.getElementById('memory-panel-viewer')?.classList.add('hidden');
    document.getElementById('memory-panel-list')?.classList.remove('hidden');
    loadMemoryView(memoryPage);
}

function confirmRestoreEvolutionBackup(backupId, changedCount) {
    if (!backupId) return;
    const runRestore = () => {
        const agent = typeof viewingMemoryAgentId === 'function' ? viewingMemoryAgentId() : '';
        fetch('/api/memory/evolution/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backup_id: backupId, agent_id: agent || '' }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') {
                    if (typeof _wsToast === 'function') {
                        _wsToast(_memoryTr('evo_restore_failed', '快照回滚失败：{error}').replace('{error}', data.message || 'error'));
                    }
                    return;
                }
                if (typeof _wsToast === 'function') {
                    _wsToast(_memoryTr('evo_restore_done', '已回滚到快照 {id}').replace('{id}', backupId));
                }
                if (_activeDiffBackupId === backupId) {
                    closeEvolutionDiff();
                } else {
                    loadMemoryView(memoryPage);
                }
            })
            .catch(err => {
                if (typeof _wsToast === 'function') {
                    _wsToast(_memoryTr('evo_restore_failed', '快照回滚失败：{error}').replace('{error}', err?.message || 'network error'));
                }
            });
    };

    if (typeof showConfirmDialog === 'function') {
        showConfirmDialog({
            title: _memoryTr('evo_restore_confirm_title', '回滚到进化前快照？'),
            message: _memoryTr('evo_restore_confirm_msg', '确定将工作区中发生变更的 {n} 个文件恢复到快照 {id} 时的状态吗？当前自进化后的修改将被覆盖。')
                .replace('{n}', String(changedCount || 0))
                .replace('{id}', backupId),
            okText: _memoryTr('evo_restore_short', '回滚'),
            tone: 'danger',
            onConfirm: runRestore,
        });
    } else {
        runRestore();
    }
}

function switchMemoryTab(tab) {
    document.querySelectorAll('.memory-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('memory-tab-' + tab).classList.add('active');
    document.getElementById('memory-panel-diff')?.classList.add('hidden');
    document.getElementById('memory-panel-viewer')?.classList.add('hidden');
    document.getElementById('memory-panel-list')?.classList.remove('hidden');
    // The "dreams" tab now surfaces self-evolution logs (merged with dream diaries).
    memoryCategory = tab === 'dreams' ? 'evolution' : 'memory';
    const q = document.getElementById('memory-search-input')?.value?.trim() || '';
    if (q) {
        loadMemoryIndexStatus();
        loadEvolutionBackups();
        onMemorySearchInput(q);
    } else {
        loadMemoryView(1);
    }
    routeNoteTab('memory', tab);
}

function loadMemoryView(page) {
    loadMemoryIndexStatus();
    loadEvolutionBackups();
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
                <td class="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-200">${_memoryEsc(f.filename)}</td>
                <td class="px-4 py-3 text-sm">${typeLabel}</td>
                <td class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">${sizeStr}</td>
                <td class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">${_memoryEsc(f.updated_at)}</td>`;
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

if (typeof module !== 'undefined') {
    module.exports = { formatMemoryIndexWarnings, renderUnifiedDiffHtml };
}
