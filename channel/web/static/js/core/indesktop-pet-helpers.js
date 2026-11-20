/* Browser port of MerZlin/dsh-pet-indesktop v4.3.4. See vendor/dsh-pet/NOTICE.md. */
function petNextAction(pools, random = Math.random) {
    const p = random();
    const pool = p < .3 ? pools.idle : p < .4 ? pools.turn : p < .8 ? pools.random : pools.move;
    return pool[Math.floor(random() * pool.length)] || pools.idle[0];
}
function petBounds(x, y, width, height, w, h) {
    return {x:Math.max(0, Math.min(x, Math.max(0, width-w))), y:Math.max(0, Math.min(y, Math.max(0, height-h)))};
}
function petRectOverlapArea(ax, ay, aw, ah, obs, margin = 0) {
    const ox = Math.max(0, Math.min(ax + aw, obs.right + margin) - Math.max(ax, obs.left - margin));
    const oy = Math.max(0, Math.min(ay + ah, obs.bottom + margin) - Math.max(ay, obs.top - margin));
    return ox * oy;
}
function petSafePlace(x, y, width, height, w, h, obstacles = [], margin = 8) {
    const base = petBounds(x, y, width, height, w, h);
    if (!obstacles || !obstacles.length) return { ...base, avoided: false };
    const totalOverlap = (cx, cy) => obstacles.reduce((sum, obs) => sum + petRectOverlapArea(cx, cy, w, h, obs, margin), 0);
    if (totalOverlap(base.x, base.y) === 0) return { ...base, avoided: false };
    const candidates = [];
    for (const obs of obstacles) {
        candidates.push(
            { x: base.x, y: obs.top - h - margin },
            { x: obs.left - w - margin, y: base.y },
            { x: obs.right + margin, y: base.y },
            { x: base.x, y: obs.bottom + margin }
        );
    }
    candidates.push(
        { x: margin, y: margin },
        { x: width - w - margin, y: margin },
        { x: margin, y: height - h - margin },
        { x: width - w - margin, y: height - h - margin }
    );
    let bestFree = null, bestFreeDist = Infinity;
    let bestPartial = base, bestOverlap = totalOverlap(base.x, base.y), bestPartialDist = 0;
    for (const raw of candidates) {
        const c = petBounds(raw.x, raw.y, width, height, w, h);
        const dist = (c.x - base.x) ** 2 + (c.y - base.y) ** 2;
        const ov = totalOverlap(c.x, c.y);
        if (ov === 0 && dist < bestFreeDist) { bestFree = c; bestFreeDist = dist; }
        else if (ov < bestOverlap || (ov === bestOverlap && dist < bestPartialDist)) {
            bestPartial = c; bestOverlap = ov; bestPartialDist = dist;
        }
    }
    const chosen = bestFree || bestPartial;
    return { x: chosen.x, y: chosen.y, avoided: chosen.x !== base.x || chosen.y !== base.y };
}
function petSnapTarget(x, y, width, height, w, h, dockSurface = null, threshold = 24) {
    const base = petBounds(x, y, width, height, w, h);
    if (!dockSurface) return { ...base, docked: false };
    const overlapsX = base.x + w > dockSurface.left + 12 && base.x < dockSurface.right - 12;
    const bottom = base.y + h;
    if (overlapsX && bottom >= dockSurface.top - threshold && bottom <= dockSurface.top + threshold) {
        const snapped = petBounds(base.x, dockSurface.top - h, width, height, w, h);
        return { ...snapped, docked: true };
    }
    return { ...base, docked: false };
}
function petTaskStatus(type, tool = '', meta = {}) {
    const tr = meta && typeof meta.tr === 'function' ? meta.tr : null;
    const prefix = meta && meta.speakerName ? `[${meta.speakerName}] ` : '';
    const format = (key, fallback, vars = {}, withPrefix = true) => {
        let text = tr ? tr(key, fallback) : fallback;
        for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, v);
        return withPrefix ? prefix + text : text;
    };
    if (type === 'peer_start') {
        const target = (meta && meta.targetName) || (meta && meta.speakerName) || tool || '团队成员';
        return { phase: 'team', text: format('pet_phase_handoff', `正在交接给 ${target}…`, { name: target }, false) };
    }
    if (type === 'peer_end') {
        return { phase: 'team', text: format('pet_phase_team', '正在与团队成员协作…') };
    }
    if (type === 'subagent_step') {
        const subTool = tool || 'step';
        return { phase: 'team', text: format('pet_phase_subagent', `子任务执行中：${subTool}`, { tool: subTool }) };
    }
    if (type === 'tool_start') {
        const name = tool || '工具';
        if (/web_search|web_fetch|browser/.test(name)) return { phase: 'search', text: format('pet_phase_search', `正在执行：${name}`, { tool: name }) };
        if (/bash|terminal|exec|shell/.test(name)) return { phase: 'terminal', text: format('pet_phase_terminal', `正在执行：${name}`, { tool: name }) };
        if (/read|write|edit|ls|search_files|glob/.test(name)) return { phase: 'files', text: format('pet_phase_files', `正在执行：${name}`, { tool: name }) };
        if (/memory|knowledge/.test(name)) return { phase: 'memory', text: format('pet_phase_memory', `正在执行：${name}`, { tool: name }) };
        if (/subagent|delegate|team/.test(name)) return { phase: 'team', text: format('pet_phase_team', `正在执行：${name}`, { tool: name }) };
        if (/image/.test(name)) return { phase: 'image', text: format('pet_phase_image', `正在执行：${name}`, { tool: name }) };
        return { phase: 'tool', text: format('pet_phase_tool', `正在执行：${name}`, { tool: name }) };
    }
    if (type === 'delta') return { phase: 'answering', text: format('pet_phase_answering', '正在整理回答…') };
    if (type === 'done') return { phase: 'done', text: format('pet_phase_done', '任务完成，点这里查看回答。') };
    if (type === 'error') return { phase: 'error', text: format('pet_phase_error', '任务遇到问题，点这里查看详情。') };
    if (type === 'cancelled') return { phase: 'idle', text: format('pet_phase_cancelled', '已停止任务，我在这里陪你。') };
    return { phase: 'thinking', text: format('pet_phase_thinking', '正在思考，稍等一下…') };
}
function doroTaskTrack(phase) { return phase === 'done' ? 'work-success' : phase === 'error' ? 'work-fail' : 'work'; }
function petFrameIndex(now, started, frameMs = 42) { return Math.max(0, Math.floor((now - started) / Math.max(16, frameMs || 42))); }
function sampleMoveCurve(curve, progress) {
    const p = Math.max(0, Math.min(1, progress || 0));
    if (Array.isArray(curve) && curve.length >= 2) {
        const pos = p * (curve.length - 1);
        const idx = Math.floor(pos);
        const nextIdx = Math.min(curve.length - 1, idx + 1);
        const frac = pos - idx;
        return curve[idx] + (curve[nextIdx] - curve[idx]) * frac;
    }
    if (p <= 0.1) return 0;
    if (p >= 0.9) return 1;
    return 0.5 - 0.5 * Math.cos(Math.PI * ((p - 0.1) / 0.8));
}
function petShouldFlip(clip, dir, character = 'shenshen') {
    if (!clip || !dir) return false;
    const name = clip.name || '';
    if (name.includes('螃蟹') || name.includes('漂浮')) return false;
    const facesLeftByDefault = name.includes('左') || (character === 'doro' && clip.path === 'move');
    return facesLeftByDefault ? dir > 0 : dir < 0;
}
function petChooseMoveDirection(x, width, w, edgeMargin = 80, random = Math.random) {
    const maxX = Math.max(0, width - w);
    if (x <= edgeMargin) return 1;
    if (x >= maxX - edgeMargin) return -1;
    return random() < 0.5 ? -1 : 1;
}
function petPlannedMoveDistance(stridePx, size, x, dir, width, w, margin = 16) {
    const scaled = Math.max(24, (stridePx || 120) * ((size || 320) / 320));
    const room = dir < 0 ? Math.max(0, x - margin) : Math.max(0, width - w - margin - x);
    return Math.min(scaled, room);
}
const PET_DEFAULT_SHORTCUT = 'Alt+P';
const PET_MODIFIER_ORDER = ['Ctrl', 'Cmd', 'CmdOrCtrl', 'Alt', 'Shift'];
const PET_MODIFIER_ALIASES = {
    ctrl: 'Ctrl', control: 'Ctrl',
    cmd: 'Cmd', command: 'Cmd', meta: 'Cmd', super: 'Cmd', win: 'Cmd',
    commandorcontrol: 'CmdOrCtrl', cmdorctrl: 'CmdOrCtrl',
    alt: 'Alt', option: 'Alt', altgr: 'Alt',
    shift: 'Shift',
};
const PET_SPECIAL_KEYS = {
    space: 'Space', spacebar: 'Space', ' ': 'Space',
    enter: 'Enter', return: 'Enter',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete', del: 'Delete',
    home: 'Home', end: 'End',
    pageup: 'PageUp', pagedown: 'PageDown',
    up: 'Up', arrowup: 'Up',
    down: 'Down', arrowdown: 'Down',
    left: 'Left', arrowleft: 'Left',
    right: 'Right', arrowright: 'Right',
    plus: 'Plus',
    '=': '=', '-': '-', ',': ',', '.': '.', '/': '/', ';': ';', "'": "'", '[': '[', ']': ']', '\\': '\\', '`': '`',
};
const PET_CODE_TO_KEY = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
function petNormalizeShortcut(raw) {
    if (raw === '') return '';
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const parts = trimmed.split('+').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const mods = new Set();
    let mainKey = null;
    for (const part of parts) {
        const lower = part.toLowerCase();
        const mod = PET_MODIFIER_ALIASES[lower];
        if (mod) { mods.add(mod); continue; }
        if (mainKey !== null) return null;
        if (/^[A-Z0-9]$/i.test(part) || /^F([1-9]|1[0-2])$/i.test(part)) mainKey = part.toUpperCase();
        else if (PET_SPECIAL_KEYS[lower]) mainKey = PET_SPECIAL_KEYS[lower];
        else return null;
    }
    if (!mainKey) return null;
    const isFn = /^F([1-9]|1[0-2])$/i.test(mainKey);
    if (!isFn && mods.size === 0) return null;
    if (!isFn && mods.size === 1 && mods.has('Shift') && (/^[A-Z0-9]$/i.test(mainKey) || mainKey === 'Space')) return null;
    return [...PET_MODIFIER_ORDER.filter(m => mods.has(m)), mainKey].join('+');
}
function petExtractEventKey(event) {
    if (!event) return null;
    const code = String(event.code || '');
    if (/^Key([A-Z])$/.test(code)) return code.slice(3);
    if (/^Digit([0-9])$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-2])$/.test(code)) return code;
    if (PET_CODE_TO_KEY[code]) return PET_CODE_TO_KEY[code];
    const key = String(event.key || '');
    if (!key) return null;
    const lower = key.toLowerCase();
    if (['control', 'shift', 'alt', 'meta', 'os', 'altgraph'].includes(lower)) return 'MODIFIER_ONLY';
    if (key === 'Escape' || lower === 'escape') return 'Escape';
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
    if (PET_SPECIAL_KEYS[lower]) return PET_SPECIAL_KEYS[lower];
    return null;
}
function petShortcutFromKeyboardEvent(event) {
    if (!event) return { action: 'invalid' };
    const mainKey = petExtractEventKey(event);
    if (mainKey === 'MODIFIER_ONLY') return { action: 'ignore' };
    const hasMod = Boolean(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
    if (mainKey === 'Escape' && !hasMod) return { action: 'cancel' };
    if ((mainKey === 'Backspace' || mainKey === 'Delete') && !hasMod) return { action: 'clear', shortcut: '' };
    if (!mainKey) return { action: 'invalid' };
    const mods = [];
    if (event.ctrlKey) mods.push('Ctrl');
    if (event.metaKey) mods.push('Cmd');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    const normalized = petNormalizeShortcut([...mods, mainKey].join('+'));
    if (!normalized) return { action: 'invalid' };
    return { action: 'set', shortcut: normalized };
}
function petFormatShortcut(shortcut, platform = '', tr = null) {
    const f = (k, fb) => (typeof tr === 'function' ? tr(k, fb) : fb);
    if (!shortcut) return f('pet_shortcut_none', '未设置');
    const isMac = platform === 'darwin' || /Mac/i.test(String(platform || ''));
    return String(shortcut).split('+').map(part => {
        if (part === 'CmdOrCtrl') return isMac ? 'Cmd' : 'Ctrl';
        if (part === 'Alt' && isMac) return 'Option';
        return part;
    }).join('+');
}
function petMatchesShortcut(event, shortcut, platform = '') {
    if (!event || !shortcut) return false;
    const normalized = petNormalizeShortcut(shortcut);
    if (!normalized) return false;
    const parts = normalized.split('+');
    const expectedKey = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));
    const isMac = platform === 'darwin' || /Mac/i.test(String(platform || ''));
    const needCtrl = mods.has('Ctrl') || (mods.has('CmdOrCtrl') && !isMac);
    const needCmd = mods.has('Cmd') || (mods.has('CmdOrCtrl') && isMac);
    const needAlt = mods.has('Alt');
    const needShift = mods.has('Shift');
    if (Boolean(event.ctrlKey) !== needCtrl) return false;
    if (Boolean(event.metaKey) !== needCmd) return false;
    if (Boolean(event.altKey) !== needAlt) return false;
    if (Boolean(event.shiftKey) !== needShift) return false;
    const actualKey = petExtractEventKey(event);
    return actualKey === expectedKey;
}
function petFormatHint(shortcut, platform = '', tr = null) {
    const f = (k, fb) => (typeof tr === 'function' ? tr(k, fb) : fb);
    if (!shortcut) return f('pet_hint_no_key', '单击快问 · 双击互动 · 悬停设置 · 拖动甩抛');
    const formatted = petFormatShortcut(shortcut, platform, tr);
    return f('pet_hint_tpl', '单击快问({shortcut}) · 双击互动 · 悬停设置 · 拖动甩抛').replace('{shortcut}', formatted);
}
function petClickLine(character, random = Math.random, tr = null, shortcut = PET_DEFAULT_SHORTCUT, platform = '') {
    const isEn = typeof tr === 'function' && tr('pet_size_sm', '小') === 'Small';
    const keyLabel = shortcut ? petFormatShortcut(shortcut, platform, tr) : '';
    const banks = {
        doro: isEn
            ? [
                'Doro is cheering for you!',
                'Want an orange? 🍊',
                'Hehe~ what shall we do next?',
                'Guarding your workspace!',
                'Sip some water and take a tiny stretch~',
                'Doro’s ears are perked and ready!',
            ]
            : [
                'Doro 在给你加油哦！',
                '要来个橘子吗？🍊',
                '嘿嘿~ 接下来要做什么呀？',
                '有我在看着工作区呢！',
                '喝口水伸个懒腰，状态会更好~',
                'Doro 的雷达已经竖起来啦！',
            ],
        shenshen: isEn
            ? [
                'Hey! That tickles~',
                'Ready whenever you are!',
                'Need a hand with something?',
                'Staying right beside you.',
                keyLabel ? `Press ${keyLabel} anytime if a thought pops up~` : 'Click me anytime if a thought pops up~',
                'You’re doing great—one step at a time!',
            ]
            : [
                '喂~ 别乱戳人家啦！',
                '随时待命，有什么需要尽管说！',
                '要一起聊点什么吗？',
                '我一直都在旁边陪着你哦~',
                keyLabel ? `有灵感的话随时按 ${keyLabel} 叫我！` : '有灵感的话随时点我叫我！',
                '一步一步来，今天也在稳稳推进呢~',
            ],
    };
    const bank = banks[character] || banks.shenshen;
    return bank[Math.floor(random() * bank.length)] || bank[0];
}
function petFocusReaction(detail = {}, tr = null) {
    const f = (k, fb) => (typeof tr === 'function' ? tr(k, fb) : fb);
    if (detail.completed) {
        return detail.mode === 'work'
            ? { active: false, phase: 'done', bubble: f('pet_focus_work_done', '专注结束啦，起来伸个懒腰吧！'), clipGroup: 'celebrate' }
            : { active: false, phase: 'break_done', bubble: f('pet_focus_break_done', '休息结束，准备继续下一段吧！'), clipGroup: 'wake' };
    }
    if (!detail.running) return { active: false, phase: 'idle', bubble: '', clipGroup: 'idle' };
    return detail.mode === 'work'
        ? { active: true, phase: 'focus_work', bubble: f('pet_focus_work', '专注模式进行中，一起加油！'), clipGroup: 'focus' }
        : { active: true, phase: 'focus_break', bubble: f('pet_focus_break', '休息时间，喝口水放松一下~'), clipGroup: 'break' };
}
function petAmbientReaction(audioState = {}, tr = null) {
    const f = (k, fb) => (typeof tr === 'function' ? tr(k, fb) : fb);
    if (audioState.musicPlaying) {
        return { active: true, bubble: f('pet_ambient_music', '♪ 跟着旋律轻轻晃一晃~'), preferredNames: ['轻快摇摆舞', '悠闲哼歌', '可爱宅舞', '小提琴演奏'] };
    }
    if (audioState.soundKind === 'rain') {
        return { active: true, bubble: f('pet_ambient_rain', '听着雨声，心也静下来了。'), preferredNames: ['待机呼吸休闲', '悠闲哼歌', '原地小憩沉眠'] };
    }
    if (audioState.soundKind === 'wind') {
        return { active: true, bubble: f('pet_ambient_wind', '微风吹过，呼吸都轻松了。'), preferredNames: ['摇扇纳凉', '吹笛子', '荡秋千'] };
    }
    if (audioState.soundKind === 'fire') {
        return { active: true, bubble: f('pet_ambient_fire', '暖炉劈啪响，好舒服呀~'), preferredNames: ['涮火锅', '原地小憩沉眠', '悠闲哼歌'] };
    }
    return { active: false, bubble: '', preferredNames: [] };
}
function petFormatReplyPreview(rawText, speakerName = '', maxLen = 96) {
    const cleaned = String(rawText || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/[*~]+/g, '')
        .replace(/(^|\s)[#>-]+\s*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return '';
    const prefix = speakerName ? `[${speakerName}] ` : '';
    const limit = Math.max(24, Number(maxLen) || 96);
    const bodyMax = Math.max(12, limit - prefix.length);
    const body = cleaned.length > bodyMax ? cleaned.slice(0, bodyMax - 1).trimEnd() + '…' : cleaned;
    return `${prefix}${body}`;
}
function petOverlayShouldIgnoreMouse(hit = {}) {
    if (hit.dragging) return false;
    if (hit.hitPanel || hit.hitQuickChat || hit.hitBubble) return false;
    if (!hit.enabled) return true;
    if (hit.hitPet && !hit.passthrough) return false;
    return true;
}
if (typeof module !== 'undefined') {
    module.exports = {
        petNextAction, petBounds, petSafePlace, petSnapTarget, petTaskStatus, doroTaskTrack, petFrameIndex,
        sampleMoveCurve, petShouldFlip, petChooseMoveDirection, petPlannedMoveDistance,
        petNormalizeShortcut, petShortcutFromKeyboardEvent, petFormatShortcut, petMatchesShortcut, petFormatHint,
        petClickLine, petFocusReaction, petAmbientReaction, petFormatReplyPreview, petOverlayShouldIgnoreMouse
    };
}
