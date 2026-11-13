function focusRemaining(state, now) {
    return Math.max(0, state.deadline == null ? state.remaining : state.deadline - now);
}
function normalizeFocusMinutes(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 180 ? n : null;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { focusRemaining, normalizeFocusMinutes };
if (typeof document !== 'undefined') (() => {
    const el = id => document.getElementById(id);
    if (!el('ambient-focus-tab')) return;
    const storageKey = 'navora_focus_timer';
    const defaults = { mode: 'work', work: 25, break: 5, remaining: 25 * 60000, deadline: null, started: false };
    let state = {...defaults};
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (saved && ['work', 'break'].includes(saved.mode) && normalizeFocusMinutes(saved.work) && normalizeFocusMinutes(saved.break) && Number.isFinite(saved.remaining) && saved.remaining >= 0 && (saved.deadline === null || Number.isFinite(saved.deadline))) state = {...defaults, ...saved};
    } catch (_) {}
    const tr = key => t('focus_' + key);
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {} };
    const clock = ms => { const sec = Math.ceil(ms / 1000); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
    function render() {
        const running = state.deadline != null;
        const remaining = focusRemaining(state, Date.now());
        el('focus-clock').textContent = clock(remaining);
        el('focus-minutes').value = state[state.mode];
        el('focus-minutes').disabled = running || state.started;
        el('focus-start').textContent = tr(running ? 'pause' : state.started ? 'resume' : 'start');
        el('focus-work').setAttribute('aria-pressed', String(state.mode === 'work'));
        el('focus-break').setAttribute('aria-pressed', String(state.mode === 'break'));
        const badge = el('focus-badge'); badge.hidden = !running; badge.textContent = running ? clock(remaining) : '';
    }
    function reset() { state.deadline = null; state.started = false; state.remaining = state[state.mode] * 60000; el('focus-status').textContent = ''; save(); render(); }
    function tick() {
        if (state.deadline != null && focusRemaining(state, Date.now()) === 0) {
            state.deadline = null; state.started = false; state.remaining = state[state.mode] * 60000;
            const message = tr(state.mode === 'work' ? 'work_done' : 'break_done');
            el('focus-status').textContent = message;
            const notice = el('focus-notice'); notice.textContent = message; notice.hidden = false;
            clearTimeout(tick.noticeTimer); tick.noticeTimer = setTimeout(() => { notice.hidden = true; }, 10000);
            if (typeof playNotifyBeep === 'function') playNotifyBeep();
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) new Notification(tr('tab'), {body: message});
            save();
        }
        render();
    }
    function switchView(focus) {
        el('ambient-focus-view').hidden = !focus; el('ambient-music-view').hidden = focus;
        el('ambient-focus-tab').setAttribute('aria-selected', String(focus)); el('ambient-music-tab').setAttribute('aria-selected', String(!focus));
    }
    el('ambient-focus-tab').addEventListener('click', () => switchView(true));
    el('ambient-music-tab').addEventListener('click', () => switchView(false));
    for (const mode of ['work', 'break']) el('focus-' + mode).addEventListener('click', () => { if (state.mode !== mode) { state.mode = mode; reset(); } });
    el('focus-minutes').addEventListener('change', e => {
        const n = normalizeFocusMinutes(e.target.value);
        if (n === null) { el('focus-status').textContent = tr('invalid'); return; }
        state[state.mode] = n; reset();
    });
    el('focus-start').addEventListener('click', () => {
        if (state.deadline != null) { state.remaining = focusRemaining(state, Date.now()); state.deadline = null; }
        else {
            if (!state.started) { const n = normalizeFocusMinutes(el('focus-minutes').value); if (n === null) { el('focus-status').textContent = tr('invalid'); return; } state[state.mode] = n; state.remaining = n * 60000; }
            state.deadline = Date.now() + state.remaining; state.started = true; el('focus-status').textContent = '';
        }
        save(); render();
    });
    el('focus-reset').addEventListener('click', reset);
    document.addEventListener('visibilitychange', tick);
    setInterval(tick, 1000); tick();
})();
