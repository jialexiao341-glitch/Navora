/* Browser port of MerZlin/dsh-pet-indesktop v4.3.4. See vendor/dsh-pet/NOTICE.md. */
function petNextAction(pools, random = Math.random) {
    const p = random();
    const pool = p < .3 ? pools.idle : p < .4 ? pools.turn : p < .8 ? pools.random : pools.move;
    return pool[Math.floor(random() * pool.length)] || pools.idle[0];
}
function petBounds(x, y, width, height, w, h) {
    return {x:Math.max(0, Math.min(x, Math.max(0, width-w))), y:Math.max(0, Math.min(y, Math.max(0, height-h)))};
}
function petTaskStatus(type, tool='') {
    if(type==='tool_start') return {phase:/web_search|web_fetch|browser/.test(tool)?'search':'tool',text:'正在执行：'+(tool || '工具')};
    if(type==='delta') return {phase:'answering',text:'正在整理回答…'};
    if(type==='done') return {phase:'done',text:'任务完成，点这里查看回答。'};
    if(type==='error') return {phase:'error',text:'任务遇到问题，点这里查看详情。'};
    if(type==='cancelled') return {phase:'idle',text:'已停止任务，我在这里陪你。'};
    return {phase:'thinking',text:'正在思考，稍等一下…'};
}
function doroTaskTrack(phase) {return phase==='done'?'work-success':phase==='error'?'work-fail':'work';}
function petFrameIndex(now, started) {return Math.max(0, Math.floor((now-started)/42));}
if (typeof module !== 'undefined') module.exports = {petNextAction, petBounds, petTaskStatus, doroTaskTrack, petFrameIndex};
if (typeof document !== 'undefined') (async () => {
    const root = document.getElementById('indesktop-pet');
    if (!root) return;
    const panel = document.getElementById('ambient-pet-view');
    const status = document.getElementById('pet-status'), enabled = document.getElementById('pet-enabled');
    const bubble = document.getElementById('pet-task-bubble');
    const videos = [...root.querySelectorAll('video')];
    const canvas = root.querySelector('canvas'), context = canvas.getContext('2d');
    const characterSelect = document.getElementById('pet-character');
    const frameCache = new Map();
    let activeFrames=null, frameStarted=0, frameLoop=false, frameToken=0, switchToken=0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let config = {enabled:true, size:320, roam:true, locked:false, x:null, y:null};
    try { Object.assign(config, JSON.parse(localStorage.getItem('navora_indesktop_pet_v1') || '{}')); } catch (_) {}
    config.size = [240,320,400,480].includes(config.size) ? config.size : 320;
    config.character = config.character==='doro'?'doro':'shenshen';
    let manifest, pools, current=0, generation=0, drag=null, velocity=null, last=0, move=0, sleeping=false, working=false, phase='thinking';
    const save = () => { try { localStorage.setItem('navora_indesktop_pet_v1', JSON.stringify(config)); } catch (_) {} };
    const pick = list => list[Math.floor(Math.random()*list.length)];
    function place(x,y) {
        const p = petBounds(x,y,innerWidth,innerHeight,root.offsetWidth,root.offsetHeight);
        config.x=p.x; config.y=p.y; root.style.left=p.x+'px'; root.style.top=p.y+'px';
        bubble.style.left=Math.max(8,Math.min(p.x,innerWidth-228))+'px';
        bubble.style.top=(p.y>80?p.y-64:p.y+root.offsetHeight+8)+'px';
    }
    function apply() {
        root.style.setProperty('--pet-size', Math.min(config.size,innerWidth*1.5)+'px');
        root.hidden=!config.enabled; enabled.checked=config.enabled;
        bubble.hidden=!config.enabled || sleeping;
        document.getElementById('pet-size').value=config.size;
        document.getElementById('pet-roam').checked=config.roam;
        document.getElementById('pet-lock').checked=config.locked;
        place(Number.isFinite(config.x)?config.x:innerWidth-root.offsetWidth-30, Number.isFinite(config.y)?config.y:innerHeight-root.offsetHeight-30);
        save();
    }
    function paths(group) {
        if(config.character==='doro' && group==='click') return (manifest || []).filter(a=>['orange','tongue'].includes(a.path));
        return (manifest || []).filter(a=>a.group===group);
    }
    function motion(clip) {
        move=0;
        if(clip.group==='move' && config.roam && !reduce.matches && !config.locked) {
            move=(clip.name.includes('左')?-1:(Math.random()<.5?-1:1))*45;
            root.classList.toggle('flipped',move<0 && !clip.name.includes('左'));
        } else root.classList.remove('flipped');
    }
    async function loadFrames(clip) {
        if(frameCache.has(clip.path)) return frameCache.get(clip.path);
        const frames=await Promise.all(clip.frames.map(path=>new Promise((resolve,reject)=> {
            const image=new Image(); image.onload=()=>resolve(image); image.onerror=reject;
            image.src='/assets/vendor/doro/'+path.split('/').map(encodeURIComponent).join('/');
        })));
        if(frameCache.size>=2) frameCache.delete(frameCache.keys().next().value);
        frameCache.set(clip.path,frames); return frames;
    }
    async function play(clip, loop=false) {
        if (!clip || !config.enabled || document.hidden) return;
        const token=++generation, index=1-current, video=videos[index];
        activeFrames=null;
        if(clip.frames) {
            move=0;
            try {
                const frames=await loadFrames(clip);
                if(token!==generation) return;
                videos.forEach(v=> {v.pause(); v.classList.remove('active');});
                canvas.width=frames[0].naturalWidth; canvas.height=frames[0].naturalHeight;
                canvas.hidden=false; context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(frames[0],0,0);
                activeFrames=reduce.matches?null:frames; frameStarted=performance.now(); frameLoop=loop; frameToken=token; motion(clip);
            } catch(_) {if(token===generation) status.textContent='Doro 动画加载失败，请刷新重试。';}
            return;
        }
        move=0; video.loop=loop; video.pause();
        video.src='/assets/vendor/dsh-pet/'+clip.path.split('/').map(encodeURIComponent).join('/');
        const loaded = new Promise((resolve,reject)=> { video.onloadeddata=resolve; video.onerror=reject; });
        video.load();
        try { await loaded; if(token!==generation) return; await video.play(); if(token!==generation) {video.pause(); return;}
            videos[current].classList.remove('active'); videos[current].pause();
            current=index; video.classList.add('active');
            canvas.hidden=true; motion(clip);
            video.onended=()=> {move=0; next();};
            if(reduce.matches) {video.pause(); move=0;}
        } catch (_) { if(token===generation) { status.textContent='动画加载失败，请检查本地素材或浏览器 WebM 支持。'; move=0; } }
    }
    function workClip() {
        if(config.character==='doro') return manifest?.find(a=>a.path===doroTaskTrack(phase));
        const names = phase==='error' ? ['垂头叹气'] : phase==='tool' ? ['忙碌点按'] : phase==='done' ? ['雀跃庆祝'] : phase==='answering' ? ['清点归档'] : ['思考冒泡'];
        return pick((manifest || []).filter(a=>names.some(n=>a.name.includes(n)))) || pools?.idle[0];
    }
    function next() {
        if(!pools || !config.enabled || document.hidden || drag || velocity) return;
        if(sleeping) return play(manifest.find(a=>a.path==='sleep') || pick(manifest.filter(a=>a.name.includes('沉眠') || a.name.includes('睡觉'))) || pools.idle[0],true);
        if(working) return play(workClip(),true);
        const clip=petNextAction(pools);
        play(clip.group==='move' && (!config.roam || config.locked) ? pick(pools.random) : clip);
    }
    function showSettings(show) {
        const ambient = document.getElementById('ambient-player'), toggle = document.getElementById('ambient-toggle');
        if(show) {if(ambient.classList.contains('is-collapsed')) toggle.click(); document.getElementById('ambient-pet-tab').click();}
        else if(!ambient.classList.contains('is-collapsed')) toggle.click();
    }
    enabled.addEventListener('change',()=> {config.enabled=enabled.checked; generation++; activeFrames=null; videos.forEach(v=>v.pause()); apply(); next();});
    characterSelect.onchange=()=>loadCharacter(characterSelect.value);
    document.getElementById('pet-size').onchange=e=> {config.size=Number(e.target.value); apply();};
    document.getElementById('pet-roam').onchange=e=> {config.roam=e.target.checked; move=0; save();};
    document.getElementById('pet-lock').onchange=e=> {config.locked=e.target.checked; move=0; save();};
    document.getElementById('pet-sleep').onclick=e=> {sleeping=!sleeping; e.target.textContent=sleeping?'叫醒':'睡觉'; bubble.hidden=sleeping || !config.enabled; next();};
    function openChat() {if(typeof navigateTo==='function') navigateTo('chat'); document.getElementById('chat-input')?.focus(); showSettings(false);}
    bubble.onclick=openChat;
    document.getElementById('pet-open-chat').onclick=openChat;
    document.getElementById('pet-hide').onclick=()=> {config.enabled=false; showSettings(false); generation++; videos.forEach(v=>v.pause()); apply();};
    root.oncontextmenu=e=> {e.preventDefault(); showSettings(true);};
    root.onkeydown=e=> {if(e.key==='Enter' || e.key===' ') {e.preventDefault(); sleeping=false; play(pick(paths('click')));} if(e.key==='Escape') showSettings(false);};
    document.getElementById('pet-animation').onchange=e=> {sleeping=false; play(manifest?.find(a=>a.path===e.target.value));};
    root.addEventListener('pointerdown',e=> {if(e.button!==0) return; velocity=null; move=0; drag={x:e.clientX,y:e.clientY,left:config.x,top:config.y,lastX:e.clientX,lastY:e.clientY,time:performance.now(),vx:0,vy:0,moved:false}; root.setPointerCapture(e.pointerId);});
    root.addEventListener('pointermove',e=> {
        if(!drag || config.locked) return;
        if(!drag.moved && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5) {drag.moved=true; play(pick(paths('drag')),true);}
        if(drag.moved) {const now=performance.now(),dt=Math.max(16,now-drag.time)/1000; drag.vx=(e.clientX-drag.lastX)/dt; drag.vy=(e.clientY-drag.lastY)/dt; drag.time=now; drag.lastX=e.clientX; drag.lastY=e.clientY; place(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);}
    });
    function release(e) {
        if(!drag) return;
        const d=drag; drag=null;
        if(root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
        if(d.moved && e.type!=='pointercancel' && !reduce.matches && performance.now()-d.time<100) velocity={x:Math.max(-1200,Math.min(1200,d.vx)),y:Math.max(-1200,Math.min(1200,d.vy))};
        else if(d.moved) next();
        else {sleeping=false; document.getElementById('pet-sleep').textContent='睡觉'; play(pick(paths('click')));}
        save();
    }
    root.addEventListener('pointerup',release); root.addEventListener('pointercancel',release);
    function tick(now) {
        const dt=Math.min(.04,(now-last)/1000 || .016); last=now;
        if(config.enabled && !document.hidden && !drag) {
            if(velocity) {
                velocity.y+=1400*dt;
                const x=config.x+velocity.x*dt,y=config.y+velocity.y*dt;
                const p=petBounds(x,y,innerWidth,innerHeight,root.offsetWidth,root.offsetHeight);
                if(p.x!==x) velocity.x*=-.68;
                if(p.y!==y) {velocity.y=Math.abs(velocity.y)<120?0:velocity.y*-.68; velocity.x*=Math.exp(-2.5*dt);}
                velocity.x*=Math.pow(.985,dt*60); place(p.x,p.y);
                if(Math.abs(velocity.x)<15 && Math.abs(velocity.y)<40 && p.y>=innerHeight-root.offsetHeight-2) {velocity=null; save(); next();}
            } else if(move) {const before=config.x; place(config.x+move*dt,config.y); if(before===config.x) move=0;}
        }
        if(activeFrames && frameToken===generation && config.enabled && !document.hidden) {
            let index=petFrameIndex(now,frameStarted);
            if(index>=activeFrames.length && !frameLoop) {activeFrames=null; move=0; next();}
            else {const frame=activeFrames[index%activeFrames.length]; context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(frame,0,0);}
        }
        requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange',()=> {generation++; videos.forEach(v=>v.pause()); move=0; velocity=null; if(!document.hidden) next();});
    reduce.addEventListener('change',()=> {velocity=null; next();});
    window.addEventListener('resize',()=>apply());
    function updateTask(type,tool) {
        const task=petTaskStatus(type,tool), previous=phase, wasWorking=working;
        working=!['done','error','cancelled'].includes(type); phase=task.phase;
        bubble.textContent=task.text; bubble.hidden=!config.enabled || sleeping;
        if(!sleeping && (!wasWorking || previous!==phase || type==='done' || type==='error')) play(workClip(),working);
    }
    document.addEventListener('navora:companion-phase',e=>updateTask(e.detail?.type,e.detail?.tool));
    document.addEventListener('navora:reply-complete',()=>updateTask('done'));
    const send=document.getElementById('send-btn');
    if(send) new MutationObserver(()=> {const value=send.classList.contains('send-btn-cancel'); if(value===working) return; if(value) updateTask('reasoning'); else if(!['done','error'].includes(phase)) updateTask('cancelled');}).observe(send,{attributes:true,attributeFilter:['class']});
    apply(); requestAnimationFrame(tick);
    async function loadCharacter(character) {
        const version=++switchToken, previous=config.character; characterSelect.disabled=true;
        try {
            const response=await fetch(character==='doro'?'/assets/vendor/doro/manifest.json':'/assets/vendor/dsh-pet/manifest.json');
            if(!response.ok) throw Error(); const data=await response.json();
            if(version!==switchToken) return;
            const labels={idle:'待机',move:'移动',work:'工作','work-success':'完成庆祝','work-fail':'失败反应',sleep:'睡觉',wash:'洗澡',cola:'喝可乐',orange:'吃橘子',tongue:'吐舌头',struggle:'拖拽挣扎'};
            const clips=character==='doro'?Object.entries(data.tracks).map(([track,frames])=>({path:track,name:labels[track]||track,frames,group:track==='struggle'?'drag':['idle','move'].includes(track)?track:['cola','orange','tongue','wash'].includes(track)?'random':track})):data;
            if(!clips.some(a=>a.group==='idle')) throw Error();
            generation++; activeFrames=null; move=0; velocity=null; frameCache.clear(); videos.forEach(v=>v.pause());
            manifest=clips; config.character=character; root.dataset.character=character; characterSelect.value=character;
            const source=document.getElementById('pet-source'); source.href=character==='doro'?'https://github.com/zhu1090093659/dsh-pet/tree/main/assets/doro':'https://github.com/MerZlin/dsh-pet-indesktop'; source.textContent=character==='doro'?'stushansusu / Doro':'MerZlin/dsh-pet-indesktop';
            root.setAttribute('aria-label',(character==='doro'?'Doro':'深深')+'桌宠，点击互动，右键打开设置');
            pools={idle:paths('idle'),turn:paths('turn'),move:paths('move'),random:paths('random')};
            const select=document.getElementById('pet-animation'); select.replaceChildren(new Option('选择动作',''));
            for(const clip of manifest) select.append(new Option(clip.name,clip.path));
            status.textContent='点击互动 · 拖动甩抛 · 右键设置'; apply(); next();
        } catch(_) {characterSelect.value=previous; status.textContent='角色素材未就绪，切换失败，请刷新重试。'; showSettings(true);}
        finally {if(version===switchToken) characterSelect.disabled=false;}
    }
    await loadCharacter(config.character);
})();
