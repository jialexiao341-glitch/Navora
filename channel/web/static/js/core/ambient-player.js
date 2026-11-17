function createAmbientQueue(urls) {
    const items = [];
    let index = -1;
    const revokeItem = item => {
        if (item && !item.builtin && item.url) {
            urls.revokeObjectURL(item.url);
            if (item.localPath) item.url = '';
        }
    };
    return {
        items, current: () => items[index] || null, index: () => index,
        addBuiltins(tracks) { items.push(...tracks.map(track => ({...track, builtin: true}))); if (index < 0 && items.length) index = 0; },
        add(files, getPath) {
            for (const file of files) {
                const localPath = typeof getPath === 'function' ? (getPath(file) || '') : (file.path || '');
                items.push({ name: file.name, url: urls.createObjectURL(file), localPath });
            }
            if (index < 0 && items.length) index = 0;
        },
        addLocalEntries(entries) {
            for (const entry of entries || []) {
                if (!entry || !entry.path) continue;
                if (items.some(i => i.localPath === entry.path)) continue;
                items.push({ name: entry.name || entry.path.split(/[\\/]/).pop() || 'Audio', url: '', localPath: entry.path });
            }
            if (index < 0 && items.length) index = 0;
        },
        select(i) { if (i >= 0 && i < items.length) index = i; return items[index] || null; },
        next(loop = false) { if (!items.length || (index === items.length - 1 && !loop)) return null; index = (index + 1) % items.length; return items[index]; },
        previous(loop = false) { if (!items.length || (index === 0 && !loop)) return null; index = (index - 1 + items.length) % items.length; return items[index]; },
        remove(i) { if (i < 0 || i >= items.length) return; revokeItem(items[i]); items.splice(i, 1); if (i < index) index--; else if (index >= items.length) index = items.length - 1; },
        clear() { for (const item of items) revokeItem(item); items.length = 0; index = -1; }
    };
}
function serializePersistedTracks(items) {
    return (items || []).filter(i => i && !i.builtin && i.localPath).map(i => ({ name: i.name, path: i.localPath }));
}
function parsePersistedTracks(raw) {
    try {
        const list = JSON.parse(raw || '[]');
        if (!Array.isArray(list)) return [];
        return list.filter(i => i && typeof i.path === 'string' && i.path.trim()).map(i => ({ name: typeof i.name === 'string' ? i.name : '', path: i.path }));
    } catch (_) {
        return [];
    }
}
function clampAmbientPosition(x, y, width, height, size) {
    return {x: Math.max(8, Math.min(x, Math.max(8, width - size - 8))), y: Math.max(8, Math.min(y, Math.max(8, height - size - 8)))};
}
function ambientLoopEnabled(settings) { return settings.loopPreferenceVersion === 1 ? settings.loop !== false : true; }
if (typeof module !== 'undefined' && module.exports) module.exports = { createAmbientQueue, clampAmbientPosition, ambientLoopEnabled, serializePersistedTracks, parsePersistedTracks };

if (typeof document !== 'undefined') {
    (() => {
        const root = document.getElementById('ambient-player');
        if (!root) return;
        const $ = id => document.getElementById('ambient-' + id);
        const audio = $('audio'), queue = createAmbientQueue(URL);
        const text = key => t('ambient_' + key);
        const playlistKey = 'navora_ambient_playlist_v1';
        const electronApi = typeof window !== 'undefined' ? window.electronAPI : null;
        const savePlaylist = () => {
            if (!electronApi) return;
            try { localStorage.setItem(playlistKey, JSON.stringify(serializePersistedTracks(queue.items))); } catch (_) {}
        };
        queue.addBuiltins(['still-water', 'night-sky', 'soft-morning'].map((id, i) => ({ name: text('track_' + (i + 1)), duration: 24, url: '/assets/audio/ambient/' + id + '.wav' })));
        if (electronApi && typeof electronApi.readAudioFile === 'function') {
            try { queue.addLocalEntries(parsePersistedTracks(localStorage.getItem(playlistKey))); } catch (_) {}
        }
        let settings = {};
        try { settings = JSON.parse(localStorage.getItem('navora_ambient') || '{}') || {}; } catch (_) {}
        audio.volume = typeof settings.volume === 'number' && settings.volume >= 0 && settings.volume <= 1 ? settings.volume : .6;
        $('volume').value = audio.volume;
        $('loop').checked = ambientLoopEnabled(settings);
        let position = null, loadToken = 0;
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
                select.addEventListener('click', () => { queue.select(i); void load(true); });
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ambient-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', text('remove') + ': ' + item.name);
                remove.addEventListener('click', () => { const currentRemoved = i === queue.index(); queue.remove(i); savePlaylist(); if (currentRemoved) void load(false); else render(); });
                li.append(select, remove); $('list').appendChild(li);
            });
        }
        async function ensureTrackUrl(item) {
            if (!item) return '';
            if (item.url) return item.url;
            if (item.localPath && electronApi && typeof electronApi.readAudioFile === 'function') {
                const res = await electronApi.readAudioFile(item.localPath);
                if (!res || !res.ok || !res.data) return '';
                const blob = new Blob([res.data], { type: res.mime || 'audio/mpeg' });
                item.url = URL.createObjectURL(blob);
                return item.url;
            }
            return '';
        }
        async function load(autoplay) {
            const token = ++loadToken;
            audio.pause(); const item = queue.current();
            $('progress').value = 0; $('time').textContent = '0:00 / 0:00'; status(''); render();
            if (!item) { audio.removeAttribute('src'); audio.load(); return; }
            let url = item.url;
            if (!url) {
                url = await ensureTrackUrl(item);
                if (token !== loadToken) return;
                if (!url) {
                    audio.removeAttribute('src'); audio.load();
                    status(text('track_missing'));
                    render();
                    return;
                }
            }
            audio.src = url;
            if (autoplay) play();
        }
        function play() { audio.play().catch(() => { status(text('error')); render(); }); }
        function move(direction) { const item = direction > 0 ? queue.next($('loop').checked) : queue.previous($('loop').checked); if (item) void load(true); }
        let suppressClick = false;
        $('toggle').addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } root.classList.toggle('is-collapsed'); $('toggle').setAttribute('aria-expanded', String(!root.classList.contains('is-collapsed'))); save(); });
        $('close').addEventListener('click', () => $('toggle').click());
        document.addEventListener('click', e => { if (!root.contains(e.target) && !root.classList.contains('is-collapsed')) { root.classList.add('is-collapsed'); $('toggle').setAttribute('aria-expanded', 'false'); save(); } }, true);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.classList.contains('is-collapsed')) { root.classList.add('is-collapsed'); $('toggle').setAttribute('aria-expanded', 'false'); save(); $('toggle').focus(); } });
        $('add').addEventListener('click', async () => {
            if (electronApi && typeof electronApi.selectAudioFiles === 'function') {
                const picked = await electronApi.selectAudioFiles();
                if (Array.isArray(picked) && picked.length) {
                    const wasEmpty = !queue.current();
                    queue.addLocalEntries(picked);
                    savePlaylist();
                    if (wasEmpty && queue.current()) void load(false); else render();
                }
                return;
            }
            $('files').click();
        });
        $('files').addEventListener('change', e => {
            const wasEmpty = !queue.current();
            const getPath = electronApi && typeof electronApi.getPathForFile === 'function' ? electronApi.getPathForFile : null;
            queue.add(Array.from(e.target.files), getPath);
            savePlaylist();
            e.target.value = '';
            if (wasEmpty && queue.current()) void load(false); else render();
        });
        $('play').addEventListener('click', () => { if (audio.paused) play(); else audio.pause(); });
        $('previous').addEventListener('click', () => move(-1)); $('next').addEventListener('click', () => move(1));
        $('loop').addEventListener('change', save);
        $('volume').addEventListener('input', e => { audio.volume = Number(e.target.value); save(); });
        const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (queue.current()?.duration || 0);
        $('progress').addEventListener('input', e => { if (duration()) audio.currentTime = duration() * Number(e.target.value) / 1000; });
        audio.addEventListener('timeupdate', () => { $('progress').value = duration() ? audio.currentTime / duration() * 1000 : 0; $('time').textContent = `${fmt(audio.currentTime)} / ${fmt(duration())}`; });
        audio.addEventListener('loadedmetadata', () => { $('time').textContent = `${fmt(audio.currentTime)} / ${fmt(duration())}`; });
        const emitAudio = () => document.dispatchEvent(new CustomEvent('navora:ambient-audio', { detail: { source: 'music', playing: !audio.paused && !audio.ended } }));
        audio.addEventListener('play', () => { render(); emitAudio(); });
        audio.addEventListener('pause', () => { render(); emitAudio(); });
        audio.addEventListener('ended', () => { const next = queue.next($('loop').checked); if (next) load(true); else { render(); emitAudio(); } });
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
