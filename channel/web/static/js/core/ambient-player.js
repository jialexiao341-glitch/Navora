function createAmbientQueue(urls) {
    const items = [];
    let index = -1;
    return {
        items, current: () => items[index] || null, index: () => index,
        addBuiltins(tracks) { items.push(...tracks.map(track => ({...track, builtin: true}))); if (index < 0 && items.length) index = 0; },
        add(files) { for (const file of files) items.push({ name: file.name, url: urls.createObjectURL(file) }); if (index < 0 && items.length) index = 0; },
        select(i) { if (i >= 0 && i < items.length) index = i; return items[index] || null; },
        next(loop = false) { if (!items.length || (index === items.length - 1 && !loop)) return null; index = (index + 1) % items.length; return items[index]; },
        previous(loop = false) { if (!items.length || (index === 0 && !loop)) return null; index = (index - 1 + items.length) % items.length; return items[index]; },
        remove(i) { if (i < 0 || i >= items.length) return; if (!items[i].builtin) urls.revokeObjectURL(items[i].url); items.splice(i, 1); if (i < index) index--; else if (index >= items.length) index = items.length - 1; },
        clear() { for (const item of items) if (!item.builtin) urls.revokeObjectURL(item.url); items.length = 0; index = -1; }
    };
}
function clampAmbientPosition(x, y, width, height, size) {
    return {x: Math.max(8, Math.min(x, Math.max(8, width - size - 8))), y: Math.max(8, Math.min(y, Math.max(8, height - size - 8)))};
}
function ambientLoopEnabled(settings) { return settings.loopPreferenceVersion === 1 ? settings.loop !== false : true; }
if (typeof module !== 'undefined' && module.exports) module.exports = { createAmbientQueue, clampAmbientPosition, ambientLoopEnabled };

if (typeof document !== 'undefined') {
    (() => {
        const root = document.getElementById('ambient-player');
        if (!root) return;
        const $ = id => document.getElementById('ambient-' + id);
        const audio = $('audio'), queue = createAmbientQueue(URL);
        const text = key => t('ambient_' + key);
        queue.addBuiltins(['still-water', 'night-sky', 'soft-morning'].map((id, i) => ({ name: text('track_' + (i + 1)), duration: 24, url: '/assets/audio/ambient/' + id + '.wav' })));
        let settings = {};
        try { settings = JSON.parse(localStorage.getItem('navora_ambient') || '{}') || {}; } catch (_) {}
        audio.volume = typeof settings.volume === 'number' && settings.volume >= 0 && settings.volume <= 1 ? settings.volume : .6;
        $('volume').value = audio.volume;
        $('loop').checked = ambientLoopEnabled(settings);
        let position = null;
        const save = () => { try { localStorage.setItem('navora_ambient', JSON.stringify({volume: audio.volume, loop: $('loop').checked, loopPreferenceVersion: 1, open: !root.classList.contains('is-collapsed'), position: position})); } catch (_) {} };
        const fmt = n => Number.isFinite(n) && n >= 0 ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` : '0:00';
        const status = value => { $('status').textContent = value; };
        function render() {
            const current = queue.current();
            $('title').textContent = current ? current.name : text('empty');
            $('play').disabled = !current;
            $('previous').disabled = queue.items.length < 2;
            $('next').disabled = queue.items.length < 2;
            $('play-icon').className = audio.paused ? 'fas fa-play' : 'fas fa-pause';
            $('play').setAttribute('aria-label', text(audio.paused ? 'play' : 'pause'));
            $('list').replaceChildren();
            queue.items.forEach((item, i) => {
                const li = document.createElement('li');
                const select = document.createElement('button'); select.type = 'button'; select.className = 'ambient-track' + (i === queue.index() ? ' active' : ''); select.textContent = item.name; select.title = item.name;
                select.addEventListener('click', () => { queue.select(i); load(true); });
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ambient-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', text('remove') + ': ' + item.name);
                remove.addEventListener('click', () => { const currentRemoved = i === queue.index(); queue.remove(i); if (currentRemoved) load(false); else render(); });
                li.append(select, remove); $('list').appendChild(li);
            });
        }
        function load(autoplay) {
            audio.pause(); const item = queue.current();
            if (item) audio.src = item.url; else { audio.removeAttribute('src'); audio.load(); }
            $('progress').value = 0; $('time').textContent = '0:00 / 0:00'; status(''); render();
            if (item && autoplay) play();
        }
        function play() { audio.play().catch(() => { status(text('error')); render(); }); }
        function move(direction) { const item = direction > 0 ? queue.next($('loop').checked) : queue.previous($('loop').checked); if (item) load(true); }
        let suppressClick = false;
        $('toggle').addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } root.classList.toggle('is-collapsed'); $('toggle').setAttribute('aria-expanded', String(!root.classList.contains('is-collapsed'))); save(); });
        $('close').addEventListener('click', () => $('toggle').click());
        document.addEventListener('click', e => { if (!root.contains(e.target) && !root.classList.contains('is-collapsed')) { root.classList.add('is-collapsed'); $('toggle').setAttribute('aria-expanded', 'false'); save(); } }, true);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.classList.contains('is-collapsed')) { root.classList.add('is-collapsed'); $('toggle').setAttribute('aria-expanded', 'false'); save(); $('toggle').focus(); } });
        $('add').addEventListener('click', () => $('files').click());
        $('files').addEventListener('change', e => { const wasEmpty = !queue.current(); queue.add(Array.from(e.target.files)); e.target.value = ''; if (wasEmpty && queue.current()) load(false); else render(); });
        $('play').addEventListener('click', () => { if (audio.paused) play(); else audio.pause(); });
        $('previous').addEventListener('click', () => move(-1)); $('next').addEventListener('click', () => move(1));
        $('loop').addEventListener('change', save);
        $('volume').addEventListener('input', e => { audio.volume = Number(e.target.value); save(); });
        const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (queue.current()?.duration || 0);
        $('progress').addEventListener('input', e => { if (duration()) audio.currentTime = duration() * Number(e.target.value) / 1000; });
        audio.addEventListener('timeupdate', () => { $('progress').value = duration() ? audio.currentTime / duration() * 1000 : 0; $('time').textContent = `${fmt(audio.currentTime)} / ${fmt(duration())}`; });
        audio.addEventListener('loadedmetadata', () => { $('time').textContent = `${fmt(audio.currentTime)} / ${fmt(duration())}`; });
        audio.addEventListener('play', render); audio.addEventListener('pause', render);
        audio.addEventListener('ended', () => { const next = queue.next($('loop').checked); if (next) load(true); else render(); });
        audio.addEventListener('error', () => { if (queue.current()) status(text('error')); });
        window.addEventListener('beforeunload', () => queue.clear());
        const toggle = $('toggle');
        function place(x, y) {
            position = clampAmbientPosition(x, y, innerWidth, innerHeight, toggle.offsetWidth);
            const right = position.x > innerWidth / 2;
            const down = position.y < innerHeight / 2;
            root.style.left = right ? 'auto' : position.x + 'px';
            root.style.right = right ? (innerWidth - position.x - toggle.offsetWidth) + 'px' : 'auto';
            root.style.top = down ? position.y + 'px' : 'auto';
            root.style.bottom = down ? 'auto' : (innerHeight - position.y - toggle.offsetHeight) + 'px';
            root.classList.toggle('opens-down', down);
            root.classList.toggle('align-right', right);
            $('panel').style.maxHeight = Math.max(80, (down ? innerHeight - position.y - toggle.offsetHeight : position.y) - 18) + 'px';
        }
        if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) place(settings.position.x, settings.position.y);
        window.addEventListener('resize', () => { if (position) place(position.x, position.y); });
        let drag = null;
        toggle.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const rect = toggle.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
            toggle.setPointerCapture(e.pointerId);
        });
        toggle.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) > 5) {
                drag.moved = true; root.classList.add('is-dragging');
                if (navigator.vibrate) navigator.vibrate(12);
            }
            if (drag.moved) place(drag.left + dx, drag.top + dy);
        });
        function finishDrag(e) {
            if (!drag) return;
            if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); save(); if (navigator.vibrate) navigator.vibrate(8); }
            root.classList.remove('is-dragging'); drag = null;
            if (toggle.hasPointerCapture(e.pointerId)) toggle.releasePointerCapture(e.pointerId);
        }
        toggle.addEventListener('pointerup', finishDrag);
        toggle.addEventListener('pointercancel', finishDrag);
        if (settings.open === true) { root.classList.remove('is-collapsed'); $('toggle').setAttribute('aria-expanded', 'true'); }
        load(false);
    })();
}
