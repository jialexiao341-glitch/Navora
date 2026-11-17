/* Live multi-agent & subagent collaboration state tracker and composer strip UI.
   Classic script shared across the chat console; exports pure helpers for Node tests. */

(function (globalScope) {
    'use strict';

    const DEFAULT_LABEL_MAX = 26;

    function _esc(text) {
        if (typeof escapeHtml === 'function') return escapeHtml(text);
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _tr(key, fallback, vars) {
        let str = (typeof t === 'function') ? t(key) : '';
        if (!str || str === key) str = fallback;
        if (vars && typeof vars === 'object') {
            for (const [k, v] of Object.entries(vars)) {
                str = str.replace(`{${k}}`, String(v ?? ''));
            }
        }
        return str;
    }

    function _truncateLabel(raw, maxLen = DEFAULT_LABEL_MAX) {
        const clean = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
    }

    function resolveSubagentLabel(item) {
        const args = (item && item.arguments && typeof item.arguments === 'object')
            ? item.arguments
            : {};
        const preferred = args.role || args.name || args.agent_name || args.agent_id
            || args.title || args.description || args.task || args.prompt || '';
        const text = _truncateLabel(preferred);
        if (text) return text;
        const toolName = item && item.tool ? String(item.tool) : '';
        if (toolName && toolName !== 'subagent') return toolName;
        return _tr('collab_subagent', '子任务');
    }

    function _isSubagentTool(toolName) {
        return /(?:^|_)subagent(?:s|_spawn)?$/i.test(String(toolName || '').trim());
    }

    /**
     * Pure state machine tracking team handoffs (`peer_start` / `peer_end`) and
     * spawned `subagent` / `subagent_step` executions within a single turn.
     */
    function createTeamCollabTracker() {
        const participants = new Map();
        const targets = new Map();
        const speakerKeyStack = [];
        let hasCollaboration = false;
        let settled = false;
        let outcome = '';
        let dismissed = false;

        function _ensureEntry(key, defaults) {
            if (!participants.has(key)) {
                participants.set(key, Object.assign({
                    key,
                    kind: 'agent',
                    id: '',
                    agentId: '',
                    name: '',
                    status: 'running',
                    currentTool: '',
                    stepCount: 0,
                    failedSteps: 0,
                    executionTime: undefined,
                }, defaults || {}));
            }
            return participants.get(key);
        }

        function _activeAgentKey() {
            return speakerKeyStack.length ? speakerKeyStack[speakerKeyStack.length - 1] : '';
        }

        function _bindTarget(key, el) {
            if (key && el) targets.set(key, el);
        }

        function startTurn(speaker, targetEl) {
            participants.clear();
            targets.clear();
            speakerKeyStack.length = 0;
            hasCollaboration = false;
            settled = false;
            outcome = '';
            dismissed = false;

            const agentId = (speaker && speaker.id) ? String(speaker.id) : '';
            const name = (speaker && (speaker.name || speaker.id)) ? String(speaker.name || speaker.id) : 'Agent';
            const key = `agent:${agentId || name}`;
            _ensureEntry(key, { kind: 'agent', id: agentId || name, agentId, name, status: 'running' });
            speakerKeyStack.push(key);
            if (targetEl) _bindTarget(key, targetEl);
        }

        function _ensureActiveAgent(ctx) {
            let key = _activeAgentKey();
            if (!key) {
                const sp = (ctx && ctx.speaker) || null;
                const agentId = (sp && sp.id) ? String(sp.id) : '';
                const name = (sp && (sp.name || sp.id)) ? String(sp.name || sp.id) : 'Agent';
                key = `agent:${agentId || name}`;
                _ensureEntry(key, { kind: 'agent', id: agentId || name, agentId, name, status: 'running' });
                speakerKeyStack.push(key);
            }
            if (ctx && ctx.targetEl && !targets.has(key)) {
                _bindTarget(key, ctx.targetEl);
            }
            return participants.get(key);
        }

        function applyEvent(item, ctx = {}) {
            if (!item || !item.type) return;
            const type = item.type;

            if (type === 'peer_start') {
                hasCollaboration = true;
                dismissed = false;
                const prevKey = _activeAgentKey();
                if (prevKey && participants.has(prevKey)) {
                    const prev = participants.get(prevKey);
                    if (prev.status === 'running') prev.status = 'waiting';
                    prev.currentTool = '';
                }
                const peerId = String(item.agent_id || '');
                const peerName = String(item.agent_name || item.agent_id || 'Peer');
                const key = `agent:${peerId || peerName}`;
                const entry = _ensureEntry(key, {
                    kind: 'agent',
                    id: peerId || peerName,
                    agentId: peerId,
                    name: peerName,
                });
                entry.name = peerName;
                entry.status = 'running';
                entry.currentTool = '';
                speakerKeyStack.push(key);
                if (ctx && ctx.targetEl) _bindTarget(key, ctx.targetEl);
                return;
            }

            if (type === 'peer_end') {
                const poppedKey = speakerKeyStack.length > 1 ? speakerKeyStack.pop() : _activeAgentKey();
                if (poppedKey && participants.has(poppedKey)) {
                    const popped = participants.get(poppedKey);
                    if (popped.status !== 'error') popped.status = 'done';
                    popped.currentTool = '';
                }
                const resumeKey = _activeAgentKey();
                if (resumeKey && participants.has(resumeKey)) {
                    const resumed = participants.get(resumeKey);
                    if (resumed.status !== 'error') resumed.status = 'running';
                }
                return;
            }

            if (type === 'tool_start') {
                const toolName = String(item.tool || '');
                const active = _ensureActiveAgent(ctx);
                if (_isSubagentTool(toolName)) {
                    hasCollaboration = true;
                    dismissed = false;
                    const callId = String(item.tool_call_id || `sub_${participants.size + 1}`);
                    const key = `subagent:${callId}`;
                    const entry = _ensureEntry(key, {
                        kind: 'subagent',
                        id: callId,
                        name: resolveSubagentLabel(item),
                        status: 'running',
                        stepCount: 0,
                    });
                    entry.name = resolveSubagentLabel(item);
                    entry.status = 'running';
                    if (ctx && ctx.toolEl) _bindTarget(key, ctx.toolEl);
                } else {
                    if (toolName === 'agent_delegate') {
                        hasCollaboration = true;
                        dismissed = false;
                    }
                    if (active) {
                        active.currentTool = toolName;
                        active.stepCount += 1;
                    }
                }
                return;
            }

            if (type === 'subagent_step') {
                hasCollaboration = true;
                dismissed = false;
                const callId = String(item.card_id || '');
                if (!callId) return;
                const key = `subagent:${callId}`;
                const entry = _ensureEntry(key, {
                    kind: 'subagent',
                    id: callId,
                    name: item.tool ? String(item.tool) : _tr('collab_subagent', '子任务'),
                    status: 'running',
                    stepCount: 0,
                });
                if (ctx && ctx.toolEl && !targets.has(key)) _bindTarget(key, ctx.toolEl);
                if (item.phase === 'start') {
                    entry.stepCount += 1;
                    entry.currentTool = item.tool ? String(item.tool) : '';
                    entry.status = 'running';
                } else if (item.phase === 'end') {
                    if (item.status && item.status !== 'success') {
                        entry.failedSteps = (entry.failedSteps || 0) + 1;
                    }
                    if (entry.currentTool === item.tool) {
                        entry.currentTool = '';
                    }
                }
                return;
            }

            if (type === 'tool_end') {
                const subKey = item.tool_call_id ? `subagent:${item.tool_call_id}` : '';
                if (subKey && participants.has(subKey)) {
                    const entry = participants.get(subKey);
                    entry.status = item.status === 'success' ? 'done' : 'error';
                    entry.currentTool = '';
                    if (item.execution_time !== undefined) entry.executionTime = item.execution_time;
                } else {
                    const active = _activeAgentKey() ? participants.get(_activeAgentKey()) : null;
                    if (active) active.currentTool = '';
                }
                return;
            }

            if (type === 'delta' || type === 'reasoning') {
                const active = _ensureActiveAgent(ctx);
                if (type === 'delta' && active) active.currentTool = '';
                return;
            }

            if (type === 'done' || type === 'cancelled' || type === 'error') {
                settled = true;
                outcome = type;
                for (const entry of participants.values()) {
                    entry.currentTool = '';
                    if (entry.status === 'running' || entry.status === 'waiting') {
                        entry.status = type === 'error' ? 'error' : 'done';
                    }
                }
            }
        }

        function setTarget(key, el) {
            _bindTarget(key, el);
        }

        function getTarget(key) {
            return targets.get(key) || null;
        }

        function dismiss() {
            dismissed = true;
        }

        function reset() {
            participants.clear();
            targets.clear();
            speakerKeyStack.length = 0;
            hasCollaboration = false;
            settled = false;
            outcome = '';
            dismissed = false;
        }

        function snapshot() {
            const list = Array.from(participants.values()).map(p => Object.assign({}, p));
            let runningCount = 0;
            let doneCount = 0;
            let errorCount = 0;
            let totalSteps = 0;
            for (const p of list) {
                if (p.status === 'running' || p.status === 'waiting') runningCount += 1;
                else if (p.status === 'error') errorCount += 1;
                else doneCount += 1;
                totalSteps += p.stepCount || 0;
            }
            return {
                visible: hasCollaboration && !dismissed && list.length > 0,
                settled,
                outcome,
                totalSteps,
                runningCount,
                doneCount,
                errorCount,
                participants: list,
            };
        }

        return {
            startTurn,
            applyEvent,
            setTarget,
            getTarget,
            dismiss,
            reset,
            snapshot,
        };
    }

    // Active browser tracker instance bound to the foreground chat view
    let _activeTracker = null;
    let _activeOwnerKey = '';

    function _renderChipStatusText(p) {
        if (p.currentTool) return p.currentTool;
        if (p.status === 'waiting') return _tr('collab_waiting', '等待回传');
        if (p.status === 'running') return _tr('collab_running', '执行中');
        if (p.status === 'error') return _tr('collab_failed', '执行失败');
        if (p.stepCount > 0) return _tr('collab_steps', '{n} 步', { n: p.stepCount });
        return _tr('collab_done', '已完成');
    }

    function renderTeamCollabStrip(snap, tracker) {
        if (typeof document === 'undefined') return;
        const strip = document.getElementById('team-collab-strip');
        if (!strip) return;
        if (!snap || !snap.visible) {
            if (!strip.classList.contains('hidden')) {
                strip.classList.add('hidden');
                strip.innerHTML = '';
            }
            strip.dataset.collabSig = '';
            return;
        }
        const sig = JSON.stringify([
            snap.settled,
            snap.outcome,
            snap.participants.map(p => [p.key, p.name, p.status, p.currentTool, p.stepCount, p.failedSteps]),
        ]);
        if (strip.dataset.collabSig === sig && !strip.classList.contains('hidden')) return;
        strip.dataset.collabSig = sig;

        const completed = snap.doneCount + snap.errorCount;
        const total = snap.participants.length;
        const headerIcon = snap.runningCount > 0
            ? 'fas fa-circle-notch fa-spin text-primary-400'
            : (snap.errorCount > 0 ? 'fas fa-triangle-exclamation text-amber-400' : 'fas fa-users text-primary-400');

        const chipsHtml = snap.participants.map(p => {
            let avatarHtml = '';
            if (p.kind === 'subagent') {
                avatarHtml = '<span class="collab-chip-subicon"><i class="fas fa-diagram-project" aria-hidden="true"></i></span>';
            } else {
                const agent = (typeof findAgent === 'function')
                    ? (findAgent(p.agentId) || { id: p.agentId || '', name: p.name })
                    : { id: p.agentId || '', name: p.name };
                avatarHtml = (typeof agentAvatarHTML === 'function')
                    ? agentAvatarHTML(agent, 18)
                    : '<span class="collab-chip-subicon"><i class="fas fa-robot" aria-hidden="true"></i></span>';
            }

            let stateIcon = '';
            if (p.status === 'running') {
                stateIcon = '<i class="fas fa-circle-notch fa-spin collab-chip-state" aria-hidden="true"></i>';
            } else if (p.status === 'waiting') {
                stateIcon = '<i class="fas fa-clock collab-chip-state" aria-hidden="true"></i>';
            } else if (p.status === 'error') {
                stateIcon = '<i class="fas fa-times collab-chip-state" aria-hidden="true"></i>';
            } else {
                stateIcon = '<i class="fas fa-check collab-chip-state" aria-hidden="true"></i>';
            }

            const statusText = _renderChipStatusText(p);
            const titleHint = _tr('collab_jump_hint', '点击定位到对应消息或过程卡片');
            return `<button type="button" class="collab-chip status-${_esc(p.status)} kind-${_esc(p.kind)}" data-collab-key="${_esc(p.key)}" title="${_esc(p.name + ' · ' + statusText + ' · ' + titleHint)}">`
                + avatarHtml
                + `<span class="collab-chip-name">${_esc(p.name)}</span>`
                + `<span class="collab-chip-meta">${stateIcon}<span>${_esc(statusText)}</span></span>`
                + `</button>`;
        }).join('');

        strip.classList.remove('hidden');
        strip.innerHTML = `
            <div class="collab-strip-head">
                <span class="collab-strip-title">
                    <i class="${headerIcon}" aria-hidden="true"></i>
                    <span>${_esc(_tr('collab_title', '团队协作'))}</span>
                    <span class="collab-strip-counter">${completed}/${total}</span>
                </span>
                <button type="button" class="collab-strip-close" title="${_esc(_tr('collab_dismiss', '收起协作状态条'))}" aria-label="${_esc(_tr('collab_dismiss', '收起协作状态条'))}">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>
            <div class="collab-strip-chips">${chipsHtml}</div>`;

        const closeBtn = strip.querySelector('.collab-strip-close');
        if (closeBtn) {
            closeBtn.onclick = () => {
                if (tracker) tracker.dismiss();
                strip.classList.add('hidden');
                strip.innerHTML = '';
            };
        }

        strip.querySelectorAll('.collab-chip[data-collab-key]').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.collabKey || '';
                let target = tracker ? tracker.getTarget(key) : null;
                if ((!target || !target.isConnected) && key.startsWith('agent:')) {
                    const agentId = key.slice(6);
                    const matches = document.querySelectorAll(`.bot-message-group[data-speaker-agent="${CSS.escape(agentId)}"]`);
                    if (matches.length) target = matches[matches.length - 1];
                }
                if (target && typeof target.scrollIntoView === 'function') {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.remove('collab-focus-ring');
                    void target.offsetWidth;
                    target.classList.add('collab-focus-ring');
                    setTimeout(() => target.classList.remove('collab-focus-ring'), 1400);
                }
            };
        });
    }

    function setActiveTeamCollab(tracker, ownerKey) {
        _activeTracker = tracker || null;
        _activeOwnerKey = ownerKey || '';
        renderTeamCollabStrip(_activeTracker ? _activeTracker.snapshot() : null, _activeTracker);
    }

    function clearTeamCollabStrip(ownerKey) {
        if (ownerKey && _activeOwnerKey && ownerKey !== _activeOwnerKey) return;
        _activeTracker = null;
        _activeOwnerKey = '';
        renderTeamCollabStrip(null, null);
    }

    function syncActiveTeamCollab(tracker, ownerKey) {
        if (!_activeTracker || (_activeOwnerKey && ownerKey && _activeOwnerKey !== ownerKey)) {
            _activeTracker = tracker;
            _activeOwnerKey = ownerKey || '';
        }
        if (tracker !== _activeTracker) return;
        renderTeamCollabStrip(tracker.snapshot(), tracker);
    }

    globalScope.createTeamCollabTracker = createTeamCollabTracker;
    globalScope.renderTeamCollabStrip = renderTeamCollabStrip;
    globalScope.setActiveTeamCollab = setActiveTeamCollab;
    globalScope.syncActiveTeamCollab = syncActiveTeamCollab;
    globalScope.clearTeamCollabStrip = clearTeamCollabStrip;
    globalScope.resolveSubagentLabel = resolveSubagentLabel;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            createTeamCollabTracker,
            resolveSubagentLabel,
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
