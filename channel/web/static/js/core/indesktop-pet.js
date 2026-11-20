/* Browser port of MerZlin/dsh-pet-indesktop v4.3.4. See vendor/dsh-pet/NOTICE.md.
   Pure placement, shortcut, and reaction helpers live in core/indesktop-pet-helpers.js. */
if (typeof module !== 'undefined') {
    module.exports = require('./indesktop-pet-helpers.js');
}
if (typeof document !== 'undefined') (async () => {
    const root = document.getElementById('indesktop-pet');
    if (!root) return;
    const status = document.getElementById('pet-status');
    const sidePanel = document.getElementById('pet-side-panel');
    const sideClose = document.getElementById('pet-side-close');
    const bubble = document.getElementById('pet-task-bubble');
    const quickChat = document.getElementById('pet-quick-chat');
    const quickInput = document.getElementById('pet-quick-input');
    const quickOpenChat = document.getElementById('pet-quick-open-chat');
    const quickClose = document.getElementById('pet-quick-close');
    const restoreWrap = document.getElementById('ambient-pet-restore');
    const restoreBtn = document.getElementById('ambient-pet-restore-btn');
    const videos = [...root.querySelectorAll('video')];
    const canvas = root.querySelector('canvas'), context = canvas.getContext('2d');
    const characterSelect = document.getElementById('pet-character');
    const passthroughEl = document.getElementById('pet-passthrough'), soundEl = document.getElementById('pet-sound');
    const desktopWinWrap = document.getElementById('pet-desktop-window-wrap');
    const desktopWinEl = document.getElementById('pet-desktop-window');
    const displayWrap = document.getElementById('pet-display-wrap');
    const displaySelect = document.getElementById('pet-display');
    const shortcutBtn = document.getElementById('pet-shortcut-btn');
    const shortcutResetBtn = document.getElementById('pet-shortcut-reset');
    const shortcutErrorEl = document.getElementById('pet-shortcut-error');
    const isPetOverlayWindow = document.documentElement.classList.contains('pet-window-mode');
    const electronApi = typeof window !== 'undefined' ? window.electronAPI : null;
    const hasDesktopPetShell = Boolean(electronApi && typeof electronApi.petSetDesktopMode === 'function');
    const desktopPlatform = (electronApi && electronApi.platform) || (typeof navigator !== 'undefined' ? navigator.platform : '');
    const frameCache = new Map(), videoBlobCache = new Map();
    const MAX_FRAME_CACHE = 12, MAX_VIDEO_CACHE = 10;
    let moveStrides = {};
    let activeFrames = null, frameStarted = 0, frameLoop = false, frameToken = 0, switchToken = 0, manifestFrameMs = 42;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const tr = (key, fallback = '') => {
        if (typeof t === 'function') {
            const val = t(key);
            if (val && val !== key) return val;
        }
        return fallback;
    };
    const STORAGE_KEY = 'navora_indesktop_pet_v1';
    let config = {
        enabled: true, size: 320, roam: true, locked: false, passthrough: false, sound: true,
        character: 'shenshen', desktopWindow: hasDesktopPetShell, displayId: 'primary', shortcut: PET_DEFAULT_SHORTCUT,
        x: null, y: null,
    };
    let availableDisplays = [];
    let recordingShortcut = false;
    let shortcutErrorMsg = '';
    function readStoredConfig() {
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) {}
        const nextSize = [240, 320, 400, 480].includes(stored.size) ? stored.size : 320;
        const nextChar = stored.character === 'doro' ? 'doro' : 'shenshen';
        config.enabled = stored.enabled !== false;
        config.size = nextSize;
        config.roam = stored.roam !== false;
        config.locked = Boolean(stored.locked);
        config.passthrough = Boolean(stored.passthrough);
        config.sound = stored.sound !== false;
        config.character = nextChar;
        config.desktopWindow = hasDesktopPetShell ? (stored.desktopWindow !== false) : false;
        config.displayId = typeof stored.displayId === 'string' && stored.displayId.trim() ? stored.displayId.trim() : 'primary';
        const storedShortcut = petNormalizeShortcut(stored.shortcut);
        config.shortcut = storedShortcut !== null ? storedShortcut : PET_DEFAULT_SHORTCUT;
        if (isPetOverlayWindow) {
            config.x = Number.isFinite(stored.desktopX) ? stored.desktopX : null;
            config.y = Number.isFinite(stored.desktopY) ? stored.desktopY : null;
        } else {
            config.x = Number.isFinite(stored.x) ? stored.x : null;
            config.y = Number.isFinite(stored.y) ? stored.y : null;
        }
    }
    readStoredConfig();

    let manifest, pools, current = 0, generation = 0, drag = null, velocity = null, last = 0;
    let activeMove = null, gapTimer = null, lastActionGroup = 'idle', sleeping = false, manualSleep = false, working = false;
    let focusState = { running: false, mode: 'work' }, audioState = { musicPlaying: false, soundKind: '' };
    let phase = 'thinking', typing = false, typingTimer = null, bubbleTimer = null, stickyBubble = false, pendingVisibilityBubble = false;
    let hoverCloseTimer = null, clickTimer = null, inactivityTimer = null, lastTapAt = 0, sfxCtx = null;
    let lastIgnoreMouse = null;
    const INACTIVITY_SLEEP_MS = 90000;

    const save = () => {
        try {
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) {}
            const payload = {
                ...stored,
                enabled: config.enabled,
                size: config.size,
                roam: config.roam,
                locked: config.locked,
                passthrough: config.passthrough,
                sound: config.sound,
                character: config.character,
                desktopWindow: config.desktopWindow,
                displayId: config.displayId,
                shortcut: config.shortcut,
            };
            if (isPetOverlayWindow) {
                payload.desktopX = config.x;
                payload.desktopY = config.y;
            } else {
                payload.x = config.x;
                payload.y = config.y;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {}
    };
    const isLocalPetVisible = () => config.enabled && (!hasDesktopPetShell || !config.desktopWindow || isPetOverlayWindow);
    const syncOverlayMouse = (clientX = null, clientY = null) => {
        if (!isPetOverlayWindow || !electronApi || typeof electronApi.petSetIgnoreMouse !== 'function') return;
        let hitPet = false, hitPanel = false, hitQuickChat = false, hitBubble = false;
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const el = document.elementFromPoint(clientX, clientY);
            if (el) {
                hitPet = Boolean(root && root.contains(el));
                hitPanel = Boolean(sidePanel && !sidePanel.hidden && sidePanel.contains(el));
                hitQuickChat = Boolean(quickChat && !quickChat.hidden && quickChat.contains(el));
                hitBubble = Boolean(bubble && !bubble.hidden && bubble.contains(el));
            }
        }
        const ignore = petOverlayShouldIgnoreMouse({
            enabled: config.enabled,
            passthrough: config.passthrough,
            dragging: Boolean(drag),
            hitPet,
            hitPanel,
            hitQuickChat,
            hitBubble,
        });
        if (ignore !== lastIgnoreMouse) {
            lastIgnoreMouse = ignore;
            electronApi.petSetIgnoreMouse(ignore);
        }
    };
    const syncDesktopModeToShell = () => {
        if (hasDesktopPetShell) {
            void electronApi.petSetDesktopMode({
                desktopWindow: Boolean(config.desktopWindow),
                enabled: Boolean(config.enabled),
            });
        }
    };
    const broadcastConfigSync = (patch = {}) => {
        if (hasDesktopPetShell && typeof electronApi.petNotifyConfigChanged === 'function') {
            electronApi.petNotifyConfigChanged(patch);
        }
    };
    const pick = list => list && list.length ? list[Math.floor(Math.random() * list.length)] : null;

    function playPetSfx(kind) {
        if (!config.sound || !isLocalPetVisible() || document.hidden || reduce.matches) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!sfxCtx) sfxCtx = new Ctx();
            if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
            const t0 = sfxCtx.currentTime;
            const playTone = (startFreq, endFreq, dur, peakGain, offset = 0) => {
                const osc = sfxCtx.createOscillator(), gain = sfxCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(startFreq, t0 + offset);
                osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + offset + dur);
                gain.gain.setValueAtTime(0.001, t0 + offset);
                gain.gain.exponentialRampToValueAtTime(peakGain, t0 + offset + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.001, t0 + offset + dur);
                osc.connect(gain).connect(sfxCtx.destination);
                osc.start(t0 + offset);
                osc.stop(t0 + offset + dur + 0.01);
            };
            if (kind === 'click') playTone(540, 780, 0.075, 0.055);
            else if (kind === 'land') playTone(185, 88, 0.085, 0.045);
            else if (kind === 'done') { playTone(659, 659, 0.09, 0.05, 0); playTone(880, 880, 0.14, 0.055, 0.095); }
        } catch (_) {}
    }

    function getObstacles() {
        if (isPetOverlayWindow) return [];
        const list = [];
        const addEl = el => {
            if (!el || el.hidden) return;
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) list.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        };
        addEl(document.getElementById('composer-card'));
        const welcome = document.getElementById('welcome-screen');
        if (welcome && !welcome.hidden && welcome.offsetParent !== null) addEl(welcome.querySelector('.grid'));
        const ambientPlayer = document.getElementById('ambient-player');
        if (ambientPlayer && !ambientPlayer.classList.contains('is-collapsed')) addEl(document.getElementById('ambient-panel'));
        document.querySelectorAll('.modal-backdrop:not(.hidden), #team-chat-modal:not(.hidden), [role="dialog"]:not([hidden]):not(#ambient-panel)').forEach(addEl);
        return list;
    }

    function setSleepState(nextSleeping, { manual = false } = {}) {
        sleeping = Boolean(nextSleeping);
        manualSleep = sleeping ? manual : false;
        const sleepBtn = document.getElementById('pet-sleep');
        if (sleepBtn) sleepBtn.textContent = sleeping ? tr('pet_wake', '叫醒') : tr('pet_sleep', '睡觉');
        if (sleeping) bubble.hidden = true;
    }

    function wakeUp({ forceManual = false } = {}) {
        scheduleInactivitySleep();
        if (!sleeping) return false;
        if (manualSleep && !forceManual) return false;
        setSleepState(false);
        next();
        return true;
    }

    function scheduleInactivitySleep() {
        clearTimeout(inactivityTimer);
        if (!config.enabled || !config.roam || config.locked) return;
        inactivityTimer = setTimeout(() => {
            if (!config.enabled || !config.roam || config.locked || sleeping || working || focusState.running || drag || typing) return;
            if ((quickChat && !quickChat.hidden) || (sidePanel && !sidePanel.hidden)) return scheduleInactivitySleep();
            setSleepState(true, { manual: false });
            next();
        }, INACTIVITY_SLEEP_MS);
    }

    function getDockSurface() {
        if (isPetOverlayWindow) return null;
        const composer = document.getElementById('composer-card');
        if (!composer) return null;
        const rect = composer.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    }

    function updateAirborneState() {
        const h = root.offsetHeight || Math.round(config.size * 0.49);
        const floorY = Math.max(0, innerHeight - h - 6);
        root.classList.toggle('is-airborne', Boolean(drag || velocity || (Number.isFinite(config.y) && config.y < floorY)));
    }

    function positionFloatingOverlays(px, py) {
        const w = root.offsetWidth || Math.round(config.size * 0.46);
        const h = root.offsetHeight || Math.round(config.size * 0.49);
        bubble.style.left = Math.max(8, Math.min(px, innerWidth - 228)) + 'px';
        bubble.style.top = (py > 80 ? py - 64 : py + h + 8) + 'px';

        if (sidePanel && !sidePanel.hidden) {
            const pw = sidePanel.offsetWidth || 272;
            const ph = sidePanel.offsetHeight || 360;
            const leftCandidate = px - pw - 12;
            const rightCandidate = px + w + 12;
            const left = leftCandidate >= 8 ? leftCandidate : Math.min(innerWidth - pw - 8, rightCandidate);
            const top = Math.max(8, Math.min(py + h - ph, innerHeight - ph - 8));
            sidePanel.style.left = Math.max(8, left) + 'px';
            sidePanel.style.top = top + 'px';
        }
        if (quickChat && !quickChat.hidden) {
            const qw = quickChat.offsetWidth || 280;
            const qh = quickChat.offsetHeight || 100;
            const qLeft = Math.max(8, Math.min(px + w / 2 - qw / 2, innerWidth - qw - 8));
            const qTop = py > qh + 18 ? py - qh - 10 : Math.min(innerHeight - qh - 8, py + h + 10);
            quickChat.style.left = qLeft + 'px';
            quickChat.style.top = qTop + 'px';
        }
    }

    function showBubble(text, { sticky = false, duration = 4500 } = {}) {
        clearTimeout(bubbleTimer);
        if (!text || !isLocalPetVisible() || sleeping) {
            bubble.hidden = true;
            stickyBubble = false;
            syncOverlayMouse();
            return;
        }
        bubble.textContent = text;
        bubble.hidden = false;
        stickyBubble = sticky;
        positionFloatingOverlays(config.x ?? 0, config.y ?? 0);
        syncOverlayMouse();
        if (!sticky && duration > 0) {
            bubbleTimer = setTimeout(() => {
                if (!stickyBubble && !working && !focusState.running) {
                    bubble.hidden = true;
                    syncOverlayMouse();
                }
            }, duration);
        }
    }

    function place(x, y, { avoid = false } = {}) {
        const w = root.offsetWidth || Math.round(config.size * 0.46);
        const h = root.offsetHeight || Math.round(config.size * 0.49);
        const p = avoid
            ? petSafePlace(x, y, innerWidth, innerHeight, w, h, getObstacles(), 8)
            : petBounds(x, y, innerWidth, innerHeight, w, h);
        config.x = p.x; config.y = p.y;
        root.style.left = p.x + 'px'; root.style.top = p.y + 'px';
        positionFloatingOverlays(p.x, p.y);
        updateAirborneState();
        return p;
    }

    function refreshQuietAndRestore() {
        const quiet = typing && !drag;
        root.classList.toggle('is-quiet', quiet);
        root.classList.toggle('is-passthrough', config.passthrough && !drag);
        if (restoreWrap && restoreBtn) {
            if (!config.enabled) {
                restoreWrap.hidden = false;
                restoreBtn.textContent = tr('pet_restore', '桌宠已隐藏，点击召唤');
            } else if (hasDesktopPetShell && config.desktopWindow && !isPetOverlayWindow) {
                restoreWrap.hidden = false;
                restoreBtn.textContent = tr('pet_restore_desktop', '桌宠正在桌面独立悬浮，点击切回窗口内');
            } else if (config.passthrough) {
                restoreWrap.hidden = false;
                restoreBtn.textContent = tr('pet_restore_passthrough', '桌宠已开启鼠标穿透，点击关闭');
            } else {
                restoreWrap.hidden = true;
            }
        }
    }

    function refreshStatusHint() {
        if (!status) return;
        status.textContent = petFormatHint(config.shortcut, desktopPlatform, tr);
    }

    function renderDisplayOptions() {
        if (!displayWrap || !displaySelect) return;
        const show = hasDesktopPetShell && Array.isArray(availableDisplays) && availableDisplays.length > 0;
        displayWrap.hidden = !show;
        if (!show) return;
        const opts = [new Option(tr('pet_display_primary_auto', '主屏幕 (自动)'), 'primary')];
        for (const d of availableDisplays) {
            let label = tr('pet_display_item', '屏幕 {n} ({w}×{h})')
                .replace('{n}', String(d.index))
                .replace('{w}', String(d.width || 0))
                .replace('{h}', String(d.height || 0));
            if (d.label) label += ` · ${d.label}`;
            if (d.isPrimary) label += ` · ${tr('pet_display_primary_tag', '主屏')}`;
            opts.push(new Option(label, String(d.id)));
        }
        displaySelect.replaceChildren(...opts);
        const hasMatch = opts.some(o => o.value === config.displayId);
        if (!hasMatch) config.displayId = 'primary';
        displaySelect.value = config.displayId;
    }

    function renderShortcutControls() {
        if (shortcutBtn) {
            shortcutBtn.classList.toggle('is-recording', recordingShortcut);
            shortcutBtn.textContent = recordingShortcut
                ? tr('pet_shortcut_recording', '请按快捷键 (Esc 取消)')
                : petFormatShortcut(config.shortcut, desktopPlatform, tr);
        }
        if (shortcutResetBtn) {
            shortcutResetBtn.hidden = recordingShortcut || config.shortcut === PET_DEFAULT_SHORTCUT;
            shortcutResetBtn.title = tr('pet_shortcut_reset', '恢复默认 Alt+P');
        }
        if (shortcutErrorEl) {
            shortcutErrorEl.textContent = shortcutErrorMsg;
            shortcutErrorEl.hidden = !shortcutErrorMsg;
        }
        refreshStatusHint();
    }

    function apply({ avoid = true, persist = true } = {}) {
        const visible = isLocalPetVisible();
        root.style.setProperty('--pet-size', Math.min(config.size, innerWidth * 1.5) + 'px');
        root.hidden = !visible;
        if (!visible) {
            clearTimeout(gapTimer);
            generation++;
            activeMove = null;
            videos.forEach(v => v.pause());
        }
        if (!visible || sleeping) bubble.hidden = true;
        if (!visible && sidePanel) showSidePanel(false);
        if (!visible && quickChat) quickChat.hidden = true;
        document.getElementById('pet-size').value = config.size;
        document.getElementById('pet-roam').checked = config.roam;
        document.getElementById('pet-lock').checked = config.locked;
        if (passthroughEl) passthroughEl.checked = config.passthrough;
        if (soundEl) soundEl.checked = config.sound;
        if (desktopWinWrap && desktopWinEl) {
            desktopWinWrap.hidden = !hasDesktopPetShell;
            desktopWinEl.checked = Boolean(config.desktopWindow);
        }
        renderDisplayOptions();
        renderShortcutControls();
        const w = root.offsetWidth || Math.round(config.size * 0.46);
        const h = root.offsetHeight || Math.round(config.size * 0.49);
        const defaultX = innerWidth - w - 30, defaultY = innerHeight - h - 30;
        place(Number.isFinite(config.x) ? config.x : defaultX, Number.isFinite(config.y) ? config.y : defaultY, { avoid });
        refreshQuietAndRestore();
        syncOverlayMouse();
        if (persist) save();
    }

    function paths(group) {
        if (config.character === 'doro' && group === 'click') return (manifest || []).filter(a => ['orange', 'tongue'].includes(a.path));
        const matched = (manifest || []).filter(a => a.group === group);
        if (matched.length) return matched;
        if (group === 'click') return (manifest || []).filter(a => ['random', 'idle'].includes(a.group));
        if (group === 'drag') return (manifest || []).filter(a => ['move', 'idle'].includes(a.group));
        return [];
    }

    function planMove(clip, token) {
        activeMove = null;
        if (clip.group !== 'move' || !config.roam || reduce.matches || config.locked || typing || sleeping || working || (quickChat && !quickChat.hidden)) {
            root.classList.remove('flipped');
            return true;
        }
        const w = root.offsetWidth || Math.round(config.size * 0.46);
        const dir = petChooseMoveDirection(config.x, innerWidth, w, 80);
        const strideEntry = moveStrides[clip.name] || null;
        const baseStride = strideEntry ? Number(strideEntry.stride) : (config.character === 'doro' ? 140 : 120);
        const distance = petPlannedMoveDistance(baseStride, config.size, config.x, dir, innerWidth, w, 16);
        if (distance < 20) {
            root.classList.remove('flipped');
            return false;
        }
        // Keep away from composer if moving horizontally near it
        const targetPos = petSafePlace(config.x + dir * distance, config.y, innerWidth, innerHeight, w, root.offsetHeight || 156, getObstacles(), 8);
        const actualDist = Math.abs(targetPos.x - config.x);
        if (targetPos.avoided && actualDist < 20) {
            root.classList.remove('flipped');
            return false;
        }
        root.classList.toggle('flipped', petShouldFlip(clip, dir, config.character));
        activeMove = {
            token,
            startX: config.x,
            dir: targetPos.x >= config.x ? (actualDist > 0 ? 1 : dir) : -1,
            distance: actualDist || distance,
            curve: strideEntry?.curve || null,
            clip,
        };
        return true;
    }

    async function loadFrames(clip) {
        const key = clip.path;
        if (frameCache.has(key)) {
            const cached = frameCache.get(key);
            frameCache.delete(key);
            frameCache.set(key, cached);
            return cached;
        }
        const frames = await Promise.all(clip.frames.map(rawPath => new Promise((resolve, reject) => {
            const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
            image.src = rawPath.startsWith('/') ? rawPath : '/assets/vendor/doro/' + rawPath.split('/').map(encodeURIComponent).join('/');
        })));
        if (frameCache.size >= MAX_FRAME_CACHE) frameCache.delete(frameCache.keys().next().value);
        frameCache.set(key, frames);
        return frames;
    }

    async function resolveVideoUrl(clip) {
        const rawUrl = '/assets/vendor/dsh-pet/' + clip.path.split('/').map(encodeURIComponent).join('/');
        if (videoBlobCache.has(clip.path)) {
            const cached = videoBlobCache.get(clip.path);
            videoBlobCache.delete(clip.path);
            videoBlobCache.set(clip.path, cached);
            return cached;
        }
        try {
            const res = await fetch(rawUrl);
            if (!res.ok) return rawUrl;
            const blobUrl = URL.createObjectURL(await res.blob());
            if (videoBlobCache.size >= MAX_VIDEO_CACHE) {
                const oldestKey = videoBlobCache.keys().next().value;
                const oldestUrl = videoBlobCache.get(oldestKey);
                videoBlobCache.delete(oldestKey);
                URL.revokeObjectURL(oldestUrl);
            }
            videoBlobCache.set(clip.path, blobUrl);
            return blobUrl;
        } catch (_) {
            return rawUrl;
        }
    }

    function schedulePreload(clips) {
        const run = () => {
            if (!isLocalPetVisible() || document.hidden || !clips) return;
            for (const clip of clips) {
                if (!['idle', 'move', 'work', 'work-success', 'work-fail', 'click'].includes(clip.group)
                    && !clip.name?.includes('思考冒泡') && !clip.name?.includes('忙碌点按')) continue;
                if (clip.frames && !frameCache.has(clip.path)) loadFrames(clip).catch(() => {});
                else if (!clip.frames && !videoBlobCache.has(clip.path)) resolveVideoUrl(clip).catch(() => {});
            }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
        else setTimeout(run, 600);
    }

    async function play(clip, loop = false) {
        if (!clip || !isLocalPetVisible() || document.hidden) return;
        clearTimeout(gapTimer);
        const token = ++generation, index = 1 - current, video = videos[index];
        activeFrames = null; activeMove = null;
        if (clip.group === 'move' && !planMove(clip, token)) {
            const fallback = pick(pools?.turn) || pick(pools?.idle);
            if (fallback && fallback !== clip) return play(fallback, false);
        }
        if (clip.frames) {
            try {
                const frames = await loadFrames(clip);
                if (token !== generation) return;
                videos.forEach(v => { v.pause(); v.classList.remove('active'); });
                canvas.width = frames[0].naturalWidth; canvas.height = frames[0].naturalHeight;
                canvas.hidden = false; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(frames[0], 0, 0);
                manifestFrameMs = Number(clip.frameMs) || 42;
                activeFrames = reduce.matches ? null : frames; frameStarted = performance.now(); frameLoop = loop; frameToken = token;
                if (clip.group === 'move') planMove(clip, token);
                lastActionGroup = clip.group;
            } catch (_) { if (token === generation) status.textContent = tr('pet_load_doro_err', 'Doro 动画加载失败，请刷新重试。'); }
            return;
        }
        video.loop = loop; video.pause();
        const url = await resolveVideoUrl(clip);
        if (token !== generation) return;
        video.src = url;
        const loaded = new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
        video.load();
        try {
            await loaded; if (token !== generation) return;
            await video.play();
            if (token !== generation) { video.pause(); return; }
            videos[current].classList.remove('active'); videos[current].pause();
            current = index; video.classList.add('active');
            canvas.hidden = true;
            if (clip.group === 'move') planMove(clip, token);
            else root.classList.remove('flipped');
            lastActionGroup = clip.group;
            video.onended = () => {
                if (activeMove && activeMove.token === token) {
                    place(activeMove.startX + activeMove.dir * activeMove.distance, config.y);
                }
                activeMove = null;
                scheduleNextAfterAction(clip.group);
            };
            if (reduce.matches) { video.pause(); activeMove = null; }
        } catch (_) { if (token === generation) { status.textContent = tr('pet_load_video_err', '动画加载失败，请检查本地素材或浏览器 WebM 支持。'); activeMove = null; } }
    }

    function scheduleNextAfterAction(finishedGroup) {
        clearTimeout(gapTimer);
        if (!pools || !config.enabled || document.hidden || drag || velocity || sleeping || working || focusState.running) {
            next();
            return;
        }
        if (finishedGroup === 'move' || finishedGroup === 'random' || finishedGroup === 'click') {
            const idleClip = pick(pools.idle);
            if (idleClip) {
                play(idleClip, true);
                gapTimer = setTimeout(() => next(), 1200 + Math.random() * 1400);
                return;
            }
        }
        next();
    }

    function workClip() {
        if (config.character === 'doro') return manifest?.find(a => a.path === doroTaskTrack(phase));
        const names = phase === 'error' ? ['垂头叹气']
            : phase === 'terminal' ? ['写代码', '忙碌点按']
            : phase === 'files' ? ['清点归档', '轻快记录']
            : phase === 'memory' || phase === 'team' ? ['思考冒泡', '原地踱步张望']
            : phase === 'tool' || phase === 'search' ? ['忙碌点按']
            : phase === 'done' ? ['雀跃庆祝']
            : phase === 'answering' ? ['清点归档']
            : ['思考冒泡'];
        return pick((manifest || []).filter(a => names.some(n => a.name.includes(n)))) || pools?.idle[0];
    }

    function ambientClip() {
        if (config.character === 'doro') return null;
        const reaction = petAmbientReaction(audioState, tr);
        if (!reaction.active || !reaction.preferredNames.length) return null;
        const matches = (manifest || []).filter(a => reaction.preferredNames.some(n => a.name.includes(n)));
        return matches.length ? pick(matches) : null;
    }

    function focusClip() {
        const reaction = petFocusReaction(focusState, tr);
        if (config.character === 'doro') {
            if (reaction.clipGroup === 'focus') return manifest?.find(a => a.path === 'work');
            if (reaction.clipGroup === 'break') return manifest?.find(a => a.path === 'cola') || manifest?.find(a => a.path === 'idle');
            if (reaction.clipGroup === 'celebrate') return manifest?.find(a => a.path === 'work-success');
            return null;
        }
        const names = reaction.clipGroup === 'focus' ? ['写代码', '清点归档', '思考冒泡']
            : reaction.clipGroup === 'break' ? ['超大伸懒腰', '哈欠连天', '悠闲哼歌']
            : reaction.clipGroup === 'celebrate' ? ['雀跃庆祝']
            : [];
        return names.length ? pick((manifest || []).filter(a => names.some(n => a.name.includes(n)))) : null;
    }

    function next() {
        clearTimeout(gapTimer);
        if (!pools || !isLocalPetVisible() || document.hidden || drag || velocity) return;
        if (sleeping) return play(manifest.find(a => a.path === 'sleep') || pick(manifest.filter(a => a.name.includes('沉眠') || a.name.includes('睡觉'))) || pools.idle[0], true);
        if (working) return play(workClip(), true);
        if (focusState.running) return play(focusClip() || pools.idle[0], true);
        if ((audioState.musicPlaying || audioState.soundKind) && Math.random() < 0.65) {
            const aClip = ambientClip();
            if (aClip) return play(aClip);
        }
        let clip = petNextAction(pools);
        const blockMove = !config.roam || config.locked || typing || (quickChat && !quickChat.hidden);
        if (clip.group === 'move' && (lastActionGroup === 'move' || blockMove)) {
            clip = pick(pools.random) || pick(pools.idle) || clip;
        }
        play(clip);
    }

    // Hover side panel management
    function showSidePanel(show) {
        if (!sidePanel) return;
        clearTimeout(hoverCloseTimer);
        if (show) {
            if (!isLocalPetVisible() || drag) return;
            sidePanel.hidden = false;
            positionFloatingOverlays(config.x ?? 0, config.y ?? 0);
        } else {
            if (recordingShortcut) stopShortcutRecording();
            sidePanel.hidden = true;
        }
        syncOverlayMouse();
    }
    function scheduleHideSidePanel() {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(() => {
            if (recordingShortcut) return;
            if (sidePanel && sidePanel.contains(document.activeElement)) return;
            showSidePanel(false);
        }, 260);
    }
    root.addEventListener('mouseenter', () => {
        wakeUp();
        showSidePanel(true);
        if (!working && !focusState.running && !sleeping && bubble.hidden && (!quickChat || quickChat.hidden)) {
            showBubble(tr('pet_bubble_default', '我在这里陪你，点这里查看对话。'), { sticky: false, duration: 3200 });
        }
    });
    root.addEventListener('mouseleave', scheduleHideSidePanel);
    if (sidePanel) {
        sidePanel.addEventListener('mouseenter', () => clearTimeout(hoverCloseTimer));
        sidePanel.addEventListener('mouseleave', scheduleHideSidePanel);
        sidePanel.addEventListener('focusout', () => {
            setTimeout(() => {
                if (recordingShortcut) return;
                if (!sidePanel.matches(':hover') && !root.matches(':hover') && !sidePanel.contains(document.activeElement)) {
                    showSidePanel(false);
                }
            }, 120);
        });
    }
    if (sideClose) sideClose.onclick = () => showSidePanel(false);

    // Quick input box management (single click)
    function toggleQuickChat(open) {
        if (!quickChat || !quickInput) return;
        const willOpen = open !== undefined ? open : quickChat.hidden;
        quickChat.hidden = !willOpen;
        if (willOpen) {
            wakeUp({ forceManual: true });
            activeMove = null;
            positionFloatingOverlays(config.x ?? 0, config.y ?? 0);
            if (isPetOverlayWindow && electronApi && typeof electronApi.petSetIgnoreMouse === 'function') {
                lastIgnoreMouse = false;
                electronApi.petSetIgnoreMouse(false);
            }
            if (isPetOverlayWindow && electronApi && typeof electronApi.petSetFocusable === 'function') {
                electronApi.petSetFocusable(true);
            }
            quickInput.focus();
        } else {
            if (isPetOverlayWindow && electronApi && typeof electronApi.petSetFocusable === 'function') {
                electronApi.petSetFocusable(false);
            }
            syncOverlayMouse();
        }
    }
    function submitQuickMessage() {
        if (!quickInput) return;
        const text = quickInput.value.trim();
        if (!text) return;
        if (isPetOverlayWindow && electronApi && typeof electronApi.petSendQuickMessage === 'function') {
            void electronApi.petSendQuickMessage(text);
        } else {
            const mainInput = document.getElementById('chat-input');
            if (mainInput && typeof sendMessage === 'function') {
                const savedDraft = mainInput.value;
                mainInput.value = text;
                sendMessage();
                if (savedDraft) {
                    mainInput.value = savedDraft;
                    mainInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }
        quickInput.value = '';
        toggleQuickChat(false);
    }
    if (quickChat && quickInput) {
        quickChat.addEventListener('submit', e => { e.preventDefault(); submitQuickMessage(); });
        quickInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuickMessage(); }
            else if (e.key === 'Escape') { e.preventDefault(); toggleQuickChat(false); }
        });
        document.addEventListener('pointerdown', e => {
            if (!quickChat.hidden && !quickChat.contains(e.target) && !root.contains(e.target)) toggleQuickChat(false);
        }, true);
    }
    if (quickClose) quickClose.onclick = () => toggleQuickChat(false);

    function openChat() {
        if (isPetOverlayWindow && electronApi && typeof electronApi.petOpenMainChat === 'function') {
            void electronApi.petOpenMainChat();
            toggleQuickChat(false);
            showSidePanel(false);
            return;
        }
        if (typeof navigateTo === 'function') navigateTo('chat');
        document.getElementById('chat-input')?.focus();
        toggleQuickChat(false);
        showSidePanel(false);
    }
    if (quickOpenChat) quickOpenChat.onclick = openChat;
    bubble.onclick = openChat;
    document.getElementById('pet-open-chat').onclick = openChat;

    // Double click playful interaction
    function triggerInteraction() {
        setSleepState(false);
        scheduleInactivitySleep();
        playPetSfx('click');
        play(pick(paths('click')));
        if (!working && !focusState.running) showBubble(petClickLine(config.character, Math.random, tr, config.shortcut, desktopPlatform), { duration: 4000 });
    }

    // Restore bar in flower panel (only shown when pet is hidden, click-through, or floating in desktop window)
    if (restoreBtn) {
        restoreBtn.onclick = () => {
            if (!config.enabled) {
                config.enabled = true;
                apply();
                syncDesktopModeToShell();
                next();
            } else if (hasDesktopPetShell && config.desktopWindow && !isPetOverlayWindow) {
                config.desktopWindow = false;
                apply();
                syncDesktopModeToShell();
                next();
            } else if (config.passthrough) {
                config.passthrough = false;
                apply({ avoid: false });
                broadcastConfigSync({ passthrough: false });
            }
        };
    }

    characterSelect.onchange = () => {
        loadCharacter(characterSelect.value).then(() => broadcastConfigSync({ character: config.character }));
    };
    document.getElementById('pet-size').onchange = e => { config.size = Number(e.target.value); apply(); broadcastConfigSync({ size: config.size }); };
    document.getElementById('pet-roam').onchange = e => { config.roam = e.target.checked; activeMove = null; save(); broadcastConfigSync({ roam: config.roam }); };
    document.getElementById('pet-lock').onchange = e => { config.locked = e.target.checked; activeMove = null; save(); broadcastConfigSync({ locked: config.locked }); };
    if (desktopWinEl) desktopWinEl.onchange = e => {
        config.desktopWindow = e.target.checked;
        if (isPetOverlayWindow && !config.desktopWindow) {
            showSidePanel(false);
            toggleQuickChat(false);
        }
        apply();
        syncDesktopModeToShell();
        next();
    };
    if (passthroughEl) passthroughEl.onchange = e => {
        config.passthrough = e.target.checked;
        if (config.passthrough) showSidePanel(false);
        refreshQuietAndRestore();
        syncOverlayMouse();
        save();
        broadcastConfigSync({ passthrough: config.passthrough });
    };
    if (soundEl) soundEl.onchange = e => { config.sound = e.target.checked; save(); broadcastConfigSync({ sound: config.sound }); };
    if (displaySelect) displaySelect.onchange = async e => {
        const nextDisplayId = String(e.target.value || 'primary');
        config.displayId = nextDisplayId;
        save();
        if (hasDesktopPetShell && typeof electronApi.petSetDisplay === 'function') {
            try {
                const res = await electronApi.petSetDisplay(nextDisplayId);
                if (res) {
                    if (Array.isArray(res.displays)) availableDisplays = res.displays;
                    if (typeof res.displayId === 'string') config.displayId = res.displayId;
                    renderDisplayOptions();
                    save();
                }
            } catch (_) {}
        } else {
            broadcastConfigSync({ displayId: config.displayId });
        }
    };

    async function commitShortcut(nextShortcut) {
        shortcutErrorMsg = '';
        if (hasDesktopPetShell && typeof electronApi.petSetShortcut === 'function') {
            try {
                const res = await electronApi.petSetShortcut(nextShortcut);
                if (res && res.ok) {
                    config.shortcut = typeof res.shortcut === 'string' ? res.shortcut : '';
                    save();
                    renderShortcutControls();
                } else {
                    if (res && typeof res.shortcut === 'string') config.shortcut = res.shortcut;
                    const errCode = res?.error;
                    shortcutErrorMsg = errCode === 'invalid'
                        ? tr('pet_shortcut_invalid', '请使用修饰键（如 Ctrl/Alt）+ 主键，或直接按 F1-F12')
                        : tr('pet_shortcut_conflict', '该快捷键已被系统或其他应用占用，请更换组合');
                    renderShortcutControls();
                }
            } catch (_) {
                shortcutErrorMsg = tr('pet_shortcut_conflict', '该快捷键已被系统或其他应用占用，请更换组合');
                renderShortcutControls();
            }
            return;
        }
        const normalized = petNormalizeShortcut(nextShortcut);
        if (normalized === null) {
            shortcutErrorMsg = tr('pet_shortcut_invalid', '请使用修饰键（如 Ctrl/Alt）+ 主键，或直接按 F1-F12');
            renderShortcutControls();
            return;
        }
        config.shortcut = normalized;
        save();
        renderShortcutControls();
        broadcastConfigSync({ shortcut: config.shortcut });
    }

    function onShortcutRecordKeyDown(e) {
        if (!recordingShortcut) return;
        e.preventDefault();
        e.stopPropagation();
        const parsed = petShortcutFromKeyboardEvent(e);
        if (parsed.action === 'ignore') return;
        if (parsed.action === 'cancel') {
            stopShortcutRecording();
            return;
        }
        if (parsed.action === 'invalid') {
            shortcutErrorMsg = tr('pet_shortcut_invalid', '请使用修饰键（如 Ctrl/Alt）+ 主键，或直接按 F1-F12');
            renderShortcutControls();
            return;
        }
        if (parsed.action === 'clear' || parsed.action === 'set') {
            const target = parsed.shortcut || '';
            stopShortcutRecording({ keepPausedUntilCommit: true });
            void commitShortcut(target);
        }
    }

    function startShortcutRecording() {
        if (recordingShortcut) return;
        recordingShortcut = true;
        shortcutErrorMsg = '';
        if (hasDesktopPetShell && typeof electronApi.petSetShortcutPaused === 'function') {
            void electronApi.petSetShortcutPaused(true);
        }
        if (isPetOverlayWindow && electronApi) {
            if (typeof electronApi.petSetIgnoreMouse === 'function') {
                lastIgnoreMouse = false;
                electronApi.petSetIgnoreMouse(false);
            }
            if (typeof electronApi.petSetFocusable === 'function') {
                electronApi.petSetFocusable(true);
            }
        }
        window.addEventListener('keydown', onShortcutRecordKeyDown, true);
        renderShortcutControls();
    }

    function stopShortcutRecording({ keepPausedUntilCommit = false } = {}) {
        if (!recordingShortcut) return;
        recordingShortcut = false;
        window.removeEventListener('keydown', onShortcutRecordKeyDown, true);
        if (!keepPausedUntilCommit && hasDesktopPetShell && typeof electronApi.petSetShortcutPaused === 'function') {
            void electronApi.petSetShortcutPaused(false);
        }
        if (isPetOverlayWindow && electronApi && (!quickChat || quickChat.hidden)) {
            if (typeof electronApi.petSetFocusable === 'function') {
                electronApi.petSetFocusable(false);
            }
            syncOverlayMouse();
        }
        renderShortcutControls();
    }

    if (shortcutBtn) {
        shortcutBtn.onclick = () => {
            if (recordingShortcut) stopShortcutRecording();
            else startShortcutRecording();
        };
    }
    if (shortcutResetBtn) {
        shortcutResetBtn.onclick = () => {
            stopShortcutRecording({ keepPausedUntilCommit: true });
            void commitShortcut(PET_DEFAULT_SHORTCUT);
        };
    }
    document.getElementById('pet-sleep').onclick = () => {
        setSleepState(!sleeping, { manual: !sleeping });
        if (!sleeping) scheduleInactivitySleep();
        next();
    };
    const resetPosBtn = document.getElementById('pet-reset-pos');
    if (resetPosBtn) resetPosBtn.onclick = () => {
        config.x = null;
        config.y = null;
        apply({ avoid: true });
        scheduleInactivitySleep();
    };
    document.getElementById('pet-hide').onclick = () => {
        config.enabled = false;
        clearTimeout(inactivityTimer);
        showSidePanel(false);
        toggleQuickChat(false);
        generation++; activeMove = null; videos.forEach(v => v.pause());
        apply();
        syncDesktopModeToShell();
    };
    root.oncontextmenu = e => { e.preventDefault(); showSidePanel(sidePanel ? sidePanel.hidden : false); };
    root.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleQuickChat(); }
        if (e.key === 'Escape') { toggleQuickChat(false); showSidePanel(false); }
    };
    window.addEventListener('keydown', e => {
        if (recordingShortcut) return;
        if (!config.shortcut || !petMatchesShortcut(e, config.shortcut, desktopPlatform)) return;
        if (hasDesktopPetShell && config.desktopWindow && !isPetOverlayWindow) return;
        e.preventDefault();
        if (!config.enabled) {
            config.enabled = true;
            apply({ avoid: true });
            syncDesktopModeToShell();
            next();
        }
        toggleQuickChat();
    });
    document.getElementById('pet-animation').onchange = e => { setSleepState(false); scheduleInactivitySleep(); play(manifest?.find(a => a.path === e.target.value)); };

    root.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        clearTimeout(gapTimer);
        scheduleInactivitySleep();
        velocity = null; activeMove = null;
        drag = { x: e.clientX, y: e.clientY, left: config.x, top: config.y, lastX: e.clientX, lastY: e.clientY, time: performance.now(), vx: 0, vy: 0, moved: false };
        updateAirborneState();
        root.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', e => {
        if (!drag || config.locked) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
            drag.moved = true;
            showSidePanel(false);
            toggleQuickChat(false);
            play(pick(paths('drag')), true);
        }
        if (drag.moved) {
            const now = performance.now(), dt = Math.max(16, now - drag.time) / 1000;
            drag.vx = (e.clientX - drag.lastX) / dt; drag.vy = (e.clientY - drag.lastY) / dt;
            drag.time = now; drag.lastX = e.clientX; drag.lastY = e.clientY;
            place(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
        }
    });
    function release(e) {
        if (!drag) return;
        const d = drag; drag = null;
        if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
        const w = root.offsetWidth || Math.round(config.size * 0.46);
        const h = root.offsetHeight || Math.round(config.size * 0.49);
        const floorY = Math.max(0, innerHeight - h - 4);
        if (d.moved) {
            if (e.type !== 'pointercancel' && !reduce.matches && performance.now() - d.time < 100 && Math.hypot(d.vx, d.vy) > 120) {
                velocity = { x: Math.max(-1200, Math.min(1200, d.vx)), y: Math.max(-1200, Math.min(1200, d.vy)) };
            } else {
                const snapped = petSnapTarget(config.x, config.y, innerWidth, innerHeight, w, h, getDockSurface(), 26);
                if (snapped.docked) {
                    place(snapped.x, snapped.y);
                    playPetSfx('land');
                    next();
                } else if (!reduce.matches && config.y < floorY - 6) {
                    velocity = { x: 0, y: 0 };
                } else {
                    place(config.x, config.y, { avoid: true });
                    next();
                }
            }
        } else {
            const now = performance.now();
            if (now - lastTapAt < 250) {
                clearTimeout(clickTimer);
                lastTapAt = 0;
                toggleQuickChat(false);
                triggerInteraction();
            } else {
                lastTapAt = now;
                clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    lastTapAt = 0;
                    toggleQuickChat();
                }, 230);
            }
        }
        updateAirborneState();
        save();
    }
    root.addEventListener('pointerup', release); root.addEventListener('pointercancel', release);

    function tick(now) {
        const dt = Math.min(.04, (now - last) / 1000 || .016); last = now;
        if (config.enabled && !document.hidden && !drag) {
            if (velocity) {
                velocity.y += 1400 * dt;
                const x = config.x + velocity.x * dt, y = config.y + velocity.y * dt;
                const p = petBounds(x, y, innerWidth, innerHeight, root.offsetWidth, root.offsetHeight);
                if (p.x !== x) velocity.x *= -.68;
                if (p.y !== y) {
                    if (Math.abs(velocity.y) > 180) playPetSfx('land');
                    velocity.y = Math.abs(velocity.y) < 120 ? 0 : velocity.y * -.68;
                    velocity.x *= Math.exp(-2.5 * dt);
                }
                velocity.x *= Math.pow(.985, dt * 60);
                place(p.x, p.y);
                if (Math.abs(velocity.x) < 15 && Math.abs(velocity.y) < 40 && p.y >= innerHeight - root.offsetHeight - 2) {
                    velocity = null;
                    place(config.x, config.y, { avoid: true });
                    updateAirborneState();
                    save();
                    next();
                }
            } else if (activeMove && activeMove.token === generation) {
                let progress = null;
                if (activeFrames && activeMove.clip.frames) {
                    const idx = petFrameIndex(now, frameStarted, manifestFrameMs);
                    progress = Math.min(1, idx / Math.max(1, activeFrames.length - 1));
                } else {
                    const v = videos[current];
                    if (v && Number.isFinite(v.duration) && v.duration > 0) {
                        progress = Math.min(1, v.currentTime / v.duration);
                    }
                }
                if (progress !== null) {
                    const factor = sampleMoveCurve(activeMove.curve, progress);
                    place(activeMove.startX + activeMove.dir * activeMove.distance * factor, config.y);
                }
            }
        }
        if (activeFrames && frameToken === generation && config.enabled && !document.hidden) {
            const index = petFrameIndex(now, frameStarted, manifestFrameMs);
            if (index >= activeFrames.length && !frameLoop) {
                if (activeMove && activeMove.token === generation) {
                    place(activeMove.startX + activeMove.dir * activeMove.distance, config.y);
                }
                const finishedGroup = lastActionGroup;
                activeFrames = null; activeMove = null;
                scheduleNextAfterAction(finishedGroup);
            } else {
                const frame = activeFrames[index % activeFrames.length];
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(frame, 0, 0);
            }
        }
        requestAnimationFrame(tick);
    }

    function setTyping(active) {
        clearTimeout(typingTimer);
        typing = active;
        if (active) {
            activeMove = null;
            place(config.x, config.y, { avoid: true });
            typingTimer = setTimeout(() => { typing = false; refreshQuietAndRestore(); }, 2500);
        }
        refreshQuietAndRestore();
    }
    document.addEventListener('focusin', e => { if (e.target && e.target.id === 'chat-input') setTyping(true); });
    document.addEventListener('input', e => { if (e.target && e.target.id === 'chat-input') setTyping(true); });
    document.addEventListener('focusout', e => { if (e.target && e.target.id === 'chat-input') setTyping(false); });

    document.addEventListener('visibilitychange', () => {
        clearTimeout(gapTimer); clearTimeout(inactivityTimer); generation++; videos.forEach(v => v.pause()); activeMove = null; velocity = null;
        if (!document.hidden) {
            if (pendingVisibilityBubble) {
                pendingVisibilityBubble = false;
                showBubble(bubble.textContent, { sticky: false, duration: 7000 });
            }
            scheduleInactivitySleep();
            next();
        }
    });
    reduce.addEventListener('change', () => { velocity = null; activeMove = null; next(); });
    window.addEventListener('resize', () => apply({ avoid: true }));
    window.addEventListener('beforeunload', () => {
        if (recordingShortcut) stopShortcutRecording();
        for (const url of videoBlobCache.values()) URL.revokeObjectURL(url);
        videoBlobCache.clear();
    });

    function updateTask(type, tool = '', speakerName = '', previewText = '') {
        const task = petTaskStatus(type, tool, { tr, speakerName });
        const previous = phase, wasWorking = working;
        working = !['done', 'error', 'cancelled'].includes(type);
        phase = task.phase;
        wakeUp();
        if (type === 'done') {
            playPetSfx('done');
            const preview = petFormatReplyPreview(previewText, speakerName);
            if (document.hidden) pendingVisibilityBubble = true;
            showBubble(preview ? `✓ ${preview}` : task.text, { sticky: false, duration: preview ? 10500 : 9000 });
        } else if (type === 'error') {
            if (document.hidden) pendingVisibilityBubble = true;
            showBubble(task.text, { sticky: false, duration: 9000 });
        } else if (type === 'cancelled') {
            showBubble(task.text, { sticky: false, duration: 4000 });
        } else {
            showBubble(task.text, { sticky: true });
        }
        if (!sleeping && (!wasWorking || previous !== phase || type === 'done' || type === 'error')) play(workClip(), working);
    }
    function handleFocusState(detail = {}) {
        focusState = { running: Boolean(detail.running), mode: detail.mode || 'work' };
        const reaction = petFocusReaction(detail, tr);
        if (detail.completed) {
            playPetSfx('done');
            if (!working && !sleeping) {
                showBubble(reaction.bubble, { sticky: false, duration: 7500 });
                play(focusClip() || pools?.idle[0], false);
            }
            return;
        }
        if (!working && !sleeping) {
            if (reaction.active) {
                showBubble(reaction.bubble, { sticky: true });
                play(focusClip() || pools?.idle[0], true);
            } else {
                stickyBubble = false;
                bubble.hidden = true;
                syncOverlayMouse();
                next();
            }
        }
    }
    function handleAmbientAudio(detail = {}) {
        if (detail.source === 'music') audioState.musicPlaying = Boolean(detail.playing);
        if (detail.source === 'sound') audioState.soundKind = detail.playing ? (detail.kind || '') : '';
        const reaction = petAmbientReaction(audioState, tr);
        if (!working && !focusState.running && !sleeping && reaction.active) {
            showBubble(reaction.bubble, { sticky: false, duration: 4200 });
            const clip = ambientClip();
            if (clip) play(clip);
        }
    }
    function syncOverlayAppearance(detail = {}) {
        if (!isPetOverlayWindow) return;
        const dark = typeof detail.dark === 'boolean'
            ? detail.dark
            : (localStorage.getItem('cow_theme') === 'dark');
        document.documentElement.classList.toggle('dark', dark);
        try {
            const cached = JSON.parse(localStorage.getItem('cow_theme_cache') || 'null');
            const state = cached && cached.id === localStorage.getItem('cow_theme_id') && cached[dark ? 'dark' : 'light'];
            if (state && state.vars) {
                for (const [name, value] of Object.entries(state.vars)) {
                    if (name.indexOf('--cw-') === 0) document.documentElement.style.setProperty(name, value);
                }
            }
        } catch (_) {}
        if (detail.lang && typeof currentLang !== 'undefined' && typeof applyI18n === 'function' && currentLang !== detail.lang) {
            currentLang = detail.lang;
            applyI18n();
            renderDisplayOptions();
            renderShortcutControls();
        }
    }
    function applyRemoteConfigSync(patch = {}) {
        const prevChar = config.character;
        readStoredConfig();
        if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
        if (typeof patch.desktopWindow === 'boolean') config.desktopWindow = patch.desktopWindow;
        if (typeof patch.size === 'number') config.size = patch.size;
        if (typeof patch.roam === 'boolean') config.roam = patch.roam;
        if (typeof patch.locked === 'boolean') config.locked = patch.locked;
        if (typeof patch.passthrough === 'boolean') config.passthrough = patch.passthrough;
        if (typeof patch.sound === 'boolean') config.sound = patch.sound;
        if (typeof patch.displayId === 'string' && patch.displayId.trim()) config.displayId = patch.displayId.trim();
        if (typeof patch.shortcut === 'string') {
            const norm = petNormalizeShortcut(patch.shortcut);
            if (norm !== null) config.shortcut = norm;
        }
        if (patch.character === 'doro' || patch.character === 'shenshen') config.character = patch.character;
        save();
        if (config.character !== prevChar) {
            void loadCharacter(config.character);
            return;
        }
        apply({ avoid: true, persist: false });
        next();
    }

    document.addEventListener('navora:companion-phase', e => updateTask(e.detail?.type, e.detail?.tool, e.detail?.speakerName));
    document.addEventListener('navora:reply-complete', e => updateTask('done', '', e.detail?.speakerName, e.detail?.previewText));
    document.addEventListener('navora:focus-state', e => handleFocusState(e.detail || {}));
    document.addEventListener('navora:ambient-audio', e => handleAmbientAudio(e.detail || {}));
    document.addEventListener('navora:pet-config-sync', e => applyRemoteConfigSync(e.detail || {}));

    async function hydrateDesktopPetShellState() {
        if (!hasDesktopPetShell) return;
        try {
            const [modeRes, displaysRes] = await Promise.all([
                typeof electronApi.petGetDesktopMode === 'function' ? electronApi.petGetDesktopMode().catch(() => null) : null,
                typeof electronApi.petGetDisplays === 'function' ? electronApi.petGetDisplays().catch(() => null) : null,
            ]);
            if (modeRes) {
                if (typeof modeRes.displayId === 'string' && modeRes.displayId.trim()) config.displayId = modeRes.displayId.trim();
                if (typeof modeRes.shortcut === 'string') {
                    const norm = petNormalizeShortcut(modeRes.shortcut);
                    if (norm !== null) config.shortcut = norm;
                }
                if (typeof modeRes.desktopWindow === 'boolean') config.desktopWindow = modeRes.desktopWindow;
                if (typeof modeRes.enabled === 'boolean') config.enabled = modeRes.enabled;
            }
            if (displaysRes && Array.isArray(displaysRes.displays)) {
                availableDisplays = displaysRes.displays;
                if (typeof displaysRes.displayId === 'string' && displaysRes.displayId.trim()) {
                    config.displayId = displaysRes.displayId.trim();
                }
            }
            apply({ avoid: true, persist: true });
        } catch (_) {}
    }

    if (typeof MutationObserver === 'function') {
        new MutationObserver(() => {
            renderDisplayOptions();
            renderShortcutControls();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }

    if (hasDesktopPetShell && typeof electronApi.onPetDisplaysChanged === 'function') {
        electronApi.onPetDisplaysChanged(payload => {
            if (!payload) return;
            if (Array.isArray(payload.displays)) availableDisplays = payload.displays;
            if (typeof payload.displayId === 'string' && payload.displayId.trim()) config.displayId = payload.displayId.trim();
            renderDisplayOptions();
            save();
        });
    }

    if (isPetOverlayWindow && electronApi) {
        document.addEventListener('mousemove', e => syncOverlayMouse(e.clientX, e.clientY));
        document.addEventListener('mouseleave', () => syncOverlayMouse());
        if (typeof electronApi.onPetToggleQuickChat === 'function') {
            electronApi.onPetToggleQuickChat(() => {
                if (!config.enabled) {
                    config.enabled = true;
                    apply({ avoid: true });
                    syncDesktopModeToShell();
                    next();
                }
                toggleQuickChat(true);
            });
        }
        if (typeof electronApi.onPetSyncEvent === 'function') {
            electronApi.onPetSyncEvent(ev => {
                if (!ev || !ev.type) return;
                const d = ev.detail || {};
                if (ev.type === 'navora:companion-phase') updateTask(d.type, d.tool, d.speakerName);
                else if (ev.type === 'navora:reply-complete') updateTask('done', '', d.speakerName, d.previewText);
                else if (ev.type === 'navora:focus-state') handleFocusState(d);
                else if (ev.type === 'navora:ambient-audio') handleAmbientAudio(d);
                else if (ev.type === 'working-state') {
                    if (Boolean(d.working) !== working) {
                        if (d.working) updateTask('reasoning');
                        else if (!['done', 'error'].includes(phase)) updateTask('cancelled');
                    }
                } else if (ev.type === 'appearance') syncOverlayAppearance(d);
            });
        }
        if (typeof electronApi.onPetConfigChanged === 'function') {
            electronApi.onPetConfigChanged(patch => applyRemoteConfigSync(patch || {}));
        }
        void hydrateDesktopPetShellState();
    } else if (hasDesktopPetShell) {
        void hydrateDesktopPetShellState();
    }

    const ambientToggle = document.getElementById('ambient-toggle');
    if (ambientToggle) ambientToggle.addEventListener('click', () => setTimeout(() => place(config.x, config.y, { avoid: true }), 20));

    const send = document.getElementById('send-btn');
    if (send) new MutationObserver(() => {
        const value = send.classList.contains('send-btn-cancel');
        if (value === working) return;
        if (value) updateTask('reasoning');
        else if (!['done', 'error'].includes(phase)) updateTask('cancelled');
    }).observe(send, { attributes: true, attributeFilter: ['class'] });

    fetch('/assets/vendor/dsh-pet/assets/characters/shenshen/videos/move_strides.json')
        .then(r => r.ok ? r.json() : {})
        .then(data => { if (data && typeof data === 'object') moveStrides = data; })
        .catch(() => {});

    apply(); requestAnimationFrame(tick);
    async function loadCharacter(character) {
        const version = ++switchToken, previous = config.character; characterSelect.disabled = true;
        try {
            let frameMs = 42;
            const response = await fetch(character === 'doro' ? '/assets/vendor/doro/manifest.json' : '/assets/vendor/dsh-pet/manifest.json');
            if (!response.ok) throw Error();
            const data = await response.json();
            if (version !== switchToken) return;
            const labels = { idle: '待机', move: '移动', work: '工作', 'work-success': '完成庆祝', 'work-fail': '失败反应', sleep: '睡觉', wash: '洗澡', cola: '喝可乐', orange: '吃橘子', tongue: '吐舌头', struggle: '拖拽挣扎' };
            const clips = character === 'doro'
                ? Object.entries(data.tracks).map(([track, frames]) => ({ path: track, name: labels[track] || track, frames, group: track === 'struggle' ? 'drag' : ['idle', 'move'].includes(track) ? track : ['cola', 'orange', 'tongue', 'wash'].includes(track) ? 'random' : track }))
                : data;
            if (character === 'doro' && Number(data.frameMs)) frameMs = Number(data.frameMs);
            if (!clips.some(a => a.group === 'idle')) throw Error();
            clearTimeout(gapTimer); generation++; activeFrames = null; activeMove = null; velocity = null; frameCache.clear(); videos.forEach(v => v.pause());
            manifest = clips; manifestFrameMs = frameMs;
            config.character = character; root.dataset.character = character; characterSelect.value = character;
            const source = document.getElementById('pet-source');
            if (character === 'doro') {
                source.href = 'https://github.com/zhu1090093659/dsh-pet/tree/main/assets/doro';
                source.textContent = 'stushansusu / Doro';
            } else {
                source.href = 'https://github.com/MerZlin/dsh-pet-indesktop';
                source.textContent = 'MerZlin/dsh-pet-indesktop';
            }
            const nameKeys = { doro: 'pet_char_doro', shenshen: 'pet_char_shenshen' };
            const charLabel = tr(nameKeys[character] || 'pet_char_shenshen', character);
            root.setAttribute('aria-label', tr('pet_aria_label', '{name}桌宠，单击快问，双击互动，悬停打开设置').replace('{name}', charLabel));
            pools = { idle: paths('idle'), turn: paths('turn'), move: paths('move'), random: paths('random') };
            const select = document.getElementById('pet-animation');
            select.replaceChildren(new Option(tr('pet_animation_pick', '选择动作'), ''));
            for (const clip of manifest) select.append(new Option(clip.name, clip.path));
            refreshStatusHint();
            apply({ avoid: true });
            showBubble(petClickLine(character, Math.random, tr, config.shortcut, desktopPlatform), { duration: 3800 });
            schedulePreload(manifest);
            scheduleInactivitySleep();
            next();
        } catch (_) {
            characterSelect.value = previous;
            status.textContent = tr('pet_switch_err', '角色素材未就绪，切换失败，请刷新重试。');
            showSidePanel(true);
        } finally {
            if (version === switchToken) characterSelect.disabled = false;
        }
    }
    await loadCharacter(config.character);
})();
