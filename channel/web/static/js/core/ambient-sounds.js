function makeAmbientNoise(kind, rate, seconds, random = Math.random) {
    const data = new Float32Array(rate * seconds); let low = 0, slow = 0, crackle = 0;
    for (let i = 0; i < data.length; i++) {
        const white = random() * 2 - 1;
        low += (white - low) * (kind === 'wind' ? .009 : kind === 'fire' ? .05 : .22);
        slow += (random() - .5 - slow) * .001;
        if (kind === 'fire' && random() < .0008) crackle = (random() - .5) * .8;
        crackle *= .993;
        const value = kind === 'rain' ? low * .75 : kind === 'wind' ? low * (1.3 + slow) : low * .7 + crackle;
        const fade = Math.min(1, i / (rate * .12), (data.length - 1 - i) / (rate * .12));
        data[i] = Math.max(-1, Math.min(1, value * fade));
    }
    return data;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {makeAmbientNoise};
if (typeof document !== 'undefined') (() => {
    const view = document.getElementById('ambient-sounds-view');
    if (!view) return;
    const volume = document.getElementById('sounds-volume'), status = document.getElementById('sounds-status');
    const buttons = [...view.querySelectorAll('[data-sound]')];
    let context, source, gain, active = '';
    try { const value = Number(localStorage.getItem('navora_ambient_sound_volume')); if (localStorage.getItem('navora_ambient_sound_volume') !== null && Number.isFinite(value) && value >= 0 && value <= 1) volume.value = value; } catch (_) {}
    function render() { buttons.forEach(button => { const on = button.dataset.sound === active; button.setAttribute('aria-pressed', String(on)); button.querySelector('.sounds-icon').className = 'fas ' + (on ? 'fa-pause' : 'fa-play') + ' sounds-icon'; }); }
    const emitSound = () => document.dispatchEvent(new CustomEvent('navora:ambient-audio', { detail: { source: 'sound', playing: Boolean(active), kind: active } }));
    function stop() { if (source) { source.stop(); source.disconnect(); source = null; } active = ''; render(); emitSound(); }
    async function toggle(kind) {
        if (active === kind) { stop(); return; }
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) throw new Error('Audio unavailable');
            if (!context) { context = new Ctx(); gain = context.createGain(); gain.connect(context.destination); }
            await context.resume();
            const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
            buffer.copyToChannel(makeAmbientNoise(kind, context.sampleRate, 8), 0);
            stop(); gain.gain.value = Number(volume.value); source = context.createBufferSource(); source.buffer = buffer; source.loop = true; source.connect(gain); source.start(); active = kind; status.textContent = ''; render(); emitSound();
        } catch (_) { status.textContent = t('sounds_error'); }
    }
    buttons.forEach(button => button.addEventListener('click', () => toggle(button.dataset.sound)));
    volume.addEventListener('input', () => { if (gain) gain.gain.value = Number(volume.value); try { localStorage.setItem('navora_ambient_sound_volume', volume.value); } catch (_) {} });
    window.addEventListener('beforeunload', stop);
})();
