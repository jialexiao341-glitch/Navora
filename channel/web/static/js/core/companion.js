function clampCompanionPosition(x, y, width, height, w, h) {
    return {x: Math.max(8, Math.min(x, Math.max(8, width - w - 8))), y: Math.max(8, Math.min(y, Math.max(8, height - h - 8)))};
}
function companionPhaseForEvent(type, tool) {
    if (type === 'reasoning' || type === 'tool_end') return 'thinking';
    if (type === 'delta') return 'answering';
    if (type === 'tool_start') return /^(web_search|web_fetch|browser)$/i.test(tool || '') ? 'search' : 'tool';
    return null;
}
const COMPANION_WALK = {tuantuan:{step:75, delay:16000}, tiaotiao:{step:145, delay:9000}, momo:{step:42, delay:25000}, xiaoya:{step:100, delay:13000}};
function nextCompanionWalk(pos, rect, w, h, persona, random = Math.random) {
    const step = (COMPANION_WALK[persona] || COMPANION_WALK.tuantuan).step;
    const minX = rect.left + 8, minY = rect.top + 8;
    const maxX = Math.max(minX, rect.right - w - 8), maxY = Math.max(minY, rect.bottom - h - 8);
    return {x:Math.max(minX, Math.min(maxX, pos.x + (random() * 2 - 1) * step)), y:Math.max(minY, Math.min(maxY, pos.y + (random() * 2 - 1) * step * .35))};
}
if (typeof module !== 'undefined' && module.exports) module.exports = {clampCompanionPosition, companionPhaseForEvent, nextCompanionWalk};
if (typeof document !== 'undefined') (() => {
    const companion = document.getElementById('companion');
    const enabled = document.getElementById('companion-enabled');
    const character = document.getElementById('companion-character');
    const message = document.getElementById('companion-message');
    const send = document.getElementById('send-btn');
    const panel = document.getElementById('companion-panel');
    if (!companion || !enabled || !send) return;
    let working = send.classList.contains('send-btn-cancel'), phase = 'thinking', messageTimer, reminderTimer, position = null, drag = null, suppressClick = false;
    const style = document.getElementById('companion-style');
    const styles = ['tuantuan', 'tiaotiao', 'momo', 'xiaoya'];
    let walkTimer, walkEndTimer, idleTimer, idleCount = 0, manualUntil = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let persona = 'tuantuan';
    try { const saved = localStorage.getItem('navora_companion_style'); if (styles.includes(saved)) persona = saved; } catch (_) {}
    const portraits = {tuantuan:'lanlan', tiaotiao:'paopao', momo:'momo', xiaoya:'xiaoya'};
    function renderPortrait() { companion.dataset.persona = persona; document.getElementById('companion-art').style.backgroundImage = 'url(/assets/images/companions/' + portraits[persona] + '-motion.png)'; }
    style.value = persona; renderPortrait();
    try { enabled.checked = localStorage.getItem('navora_companion_enabled') === '1'; position = JSON.parse(localStorage.getItem('navora_companion_position')); } catch (_) {}
    function line(kind) { return t('companion_' + persona + '_' + kind); }
    function showState() { companion.dataset.state = working ? (phase === 'search' ? 'search' : 'working') : 'idle'; const text = line(working ? phase : 'idle'); character.setAttribute('title', text); document.getElementById('companion-state').textContent = text; }
    function setEnabled(value) { enabled.checked = value; companion.hidden = !value; try { localStorage.setItem('navora_companion_enabled', value ? '1' : '0'); } catch (_) {} if (!value) { stopIdle(); clearTimeout(reminderTimer); companion.classList.remove('show-message'); panel.hidden = true; character.setAttribute('aria-expanded', 'false'); } else { if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) place(position.x, position.y); if (working) { say(phase); scheduleReminder(); } else { scheduleIdle(); } } }
    function say(kind) { clearTimeout(messageTimer); message.textContent = line(kind); companion.classList.add('show-message'); messageTimer = setTimeout(() => companion.classList.remove('show-message'), 5000); }
    function scheduleReminder() { clearTimeout(reminderTimer); if (!working || companion.hidden) return; reminderTimer = setTimeout(() => { if (working && !companion.hidden) { say(phase === 'search' ? 'search_wait' : 'wait'); scheduleReminder(); } }, 22000); }
    style.addEventListener('change', () => { if (!styles.includes(style.value)) return; persona = style.value; renderPortrait(); try { localStorage.setItem('navora_companion_style', persona); } catch (_) {} showState(); say(working ? phase : 'idle'); if (!working) scheduleIdle(); });
    function place(x, y) {
        position = clampCompanionPosition(x, y, innerWidth, innerHeight, companion.offsetWidth, companion.offsetHeight);
        companion.style.left = position.x + 'px'; companion.style.top = position.y + 'px'; companion.style.right = 'auto'; companion.style.bottom = 'auto';
        companion.classList.toggle('panel-right', position.x < innerWidth / 2);
        companion.classList.toggle('panel-down', position.y < 150);
    }
    function stopIdle() { clearTimeout(walkTimer); clearTimeout(walkEndTimer); clearTimeout(idleTimer); companion.classList.remove('is-walking', 'is-idle-acting'); }
    function canIdle() {
        const input = document.getElementById('chat-input');
        return !companion.hidden && !working && !drag && panel.hidden && !document.hidden && currentView === 'chat' && Date.now() >= manualUntil && !(document.activeElement === input && input.value.trim());
    }
    function scheduleWalk() {
        clearTimeout(walkTimer);
        if (companion.hidden || working || reducedMotion.matches) return;
        const cfg = COMPANION_WALK[persona];
        walkTimer = setTimeout(() => {
            if (canIdle()) {
                const area = document.getElementById('chat-messages');
                const rect = area && area.getBoundingClientRect();
                if (rect && rect.width > companion.offsetWidth + 20 && rect.height > companion.offsetHeight + 20) {
                    const current = companion.getBoundingClientRect();
                    const next = nextCompanionWalk({x:current.left, y:current.top}, rect, companion.offsetWidth, companion.offsetHeight, persona);
                    place(current.left, current.top);
                    companion.classList.toggle('faces-left', next.x < current.left);
                    companion.classList.add('is-walking');
                    requestAnimationFrame(() => { if (!drag && !working && !companion.hidden) place(next.x, next.y); });
                    walkEndTimer = setTimeout(() => companion.classList.remove('is-walking'), 2800);
                }
            }
            scheduleWalk();
        }, cfg.delay + Math.random() * cfg.delay * .5);
    }
    function scheduleChatter() {
        clearTimeout(idleTimer);
        if (companion.hidden || working) return;
        const delay = {tuantuan:60000, tiaotiao:40000, momo:80000, xiaoya:50000}[persona];
        idleTimer = setTimeout(() => { if (canIdle()) { idleCount++; say('idle_' + (idleCount % 2 + 1)); if (!reducedMotion.matches) { companion.classList.add('is-idle-acting'); setTimeout(() => companion.classList.remove('is-idle-acting'), 2000); } } scheduleChatter(); }, delay);
    }
    function scheduleIdle() { stopIdle(); scheduleWalk(); scheduleChatter(); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopIdle(); else if (!companion.hidden && !working) scheduleIdle(); });
    reducedMotion.addEventListener?.('change', () => { if (!companion.hidden && !working) scheduleIdle(); });
    enabled.addEventListener('change', () => setEnabled(enabled.checked));
    document.getElementById('companion-close').addEventListener('click', () => setEnabled(false));
    character.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } panel.hidden = !panel.hidden; character.setAttribute('aria-expanded', String(!panel.hidden)); showState(); });
    document.getElementById('companion-open-chat').addEventListener('click', () => { if (currentView !== 'chat' && navigateTo('chat') === false) return; panel.hidden = true; character.setAttribute('aria-expanded', 'false'); document.getElementById('chat-input')?.focus(); });
    document.addEventListener('click', e => { if (!companion.contains(e.target)) { panel.hidden = true; character.setAttribute('aria-expanded', 'false'); } }, true);
    character.addEventListener('pointerdown', e => { if (e.button !== 0) return; stopIdle(); companion.classList.remove('is-walking'); const rect = companion.getBoundingClientRect(); drag = {x:e.clientX, y:e.clientY, left:rect.left, top:rect.top, moved:false}; character.setPointerCapture(e.pointerId); });
    character.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; companion.classList.add('is-dragging'); panel.hidden = true; character.setAttribute('aria-expanded', 'false'); if (navigator.vibrate) navigator.vibrate(12); } if (drag.moved) place(drag.left + dx, drag.top + dy); });
    function finish(e) { if (!drag) return; if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); try { localStorage.setItem('navora_companion_position', JSON.stringify(position)); } catch (_) {} if (navigator.vibrate) navigator.vibrate(8); } drag = null; manualUntil = Date.now() + 15000; companion.classList.remove('is-dragging'); if (!working && !companion.hidden) scheduleIdle(); if (character.hasPointerCapture(e.pointerId)) character.releasePointerCapture(e.pointerId); }
    character.addEventListener('pointerup', finish); character.addEventListener('pointercancel', finish);
    window.addEventListener('resize', () => { if (!companion.hidden && position) place(position.x, position.y); });
    new MutationObserver(() => { const next = send.classList.contains('send-btn-cancel'); if (working === next) return; working = next; phase = 'thinking'; showState(); if (working && !companion.hidden) { stopIdle(); companion.classList.remove('is-walking'); say('thinking'); scheduleReminder(); } else { clearTimeout(reminderTimer); if (!companion.hidden) scheduleIdle(); } }).observe(send, {attributes:true, attributeFilter:['class']});
    document.addEventListener('navora:companion-phase', e => { const next = companionPhaseForEvent(e.detail?.type, e.detail?.tool); if (!next || !working || next === phase) return; phase = next; showState(); if (!companion.hidden) { say(phase); scheduleReminder(); } });
    document.addEventListener('navora:reply-complete', () => { clearTimeout(reminderTimer); queueMicrotask(() => { if (!companion.hidden && !working) { companion.dataset.state = 'done'; say('done'); setTimeout(showState, 2500); } }); });
    setEnabled(enabled.checked); showState();
})();
