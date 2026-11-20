const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {petNextAction,petBounds}=require('../channel/web/static/js/core/indesktop-pet.js');
test('weighted chain follows upstream idle turn action and move buckets',()=>{
 const pools={idle:['idle'],turn:['turn'],random:['action'],move:['move']};
 for(const [p,expected] of [[0,'idle'],[.3,'turn'],[.4,'action'],[.8,'move']]) assert.equal(petNextAction(pools,()=>p),expected);
 assert.equal(petNextAction({...pools,random:[]},()=>.5),'idle');
});
test('viewport bounds handle throw edges and resize',()=>{
 assert.deepEqual(petBounds(-10,900,500,400,120,160),{x:0,y:240});
 assert.deepEqual(petBounds(90,100,50,50,120,160),{x:0,y:0});
});
test('all 106 local animations are the original upstream files',()=>{
 const root=path.join(__dirname,'../channel/web/static/vendor/dsh-pet');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream-lock.json')));
 assert.equal(manifest.length,106);
 for(const item of manifest){
  const data=fs.readFileSync(path.join(root,item.path));
  const hash=crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
  assert.equal(hash,lock.files[item.path],item.path);
 }
});

test('Navora task events become visible companion status',()=>{
 const {petTaskStatus}=require('../channel/web/static/js/core/indesktop-pet.js');
 assert.equal(petTaskStatus('tool_start','web_search').phase,'search');
 assert.equal(petTaskStatus('tool_start','write').text,'正在执行：write');
 assert.equal(petTaskStatus('delta').phase,'answering');
 assert.equal(petTaskStatus('done').phase,'done');
 assert.equal(petTaskStatus('error').phase,'error');
 assert.equal(petTaskStatus('cancelled').phase,'idle');
});

test('Doro maps task outcomes to its own animation tracks',()=>{
 const {doroTaskTrack}=require('../channel/web/static/js/core/indesktop-pet.js');
 assert.equal(doroTaskTrack('thinking'),'work');
 assert.equal(doroTaskTrack('tool'),'work');
 assert.equal(doroTaskTrack('done'),'work-success');
 assert.equal(doroTaskTrack('error'),'work-fail');
});

test('frames never go negative when image decoding completes after the RAF timestamp',()=>{
 const {petFrameIndex}=require('../channel/web/static/js/core/indesktop-pet.js');
 assert.equal(petFrameIndex(100,115),0);
 assert.equal(petFrameIndex(157,115),1);
});

test('Doro frame sequences are ordered numerically and match imported hashes',()=>{
 const root=path.join(__dirname,'../channel/web/static/vendor/doro');
 const pack=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 for(const track of ['idle','move','work','work-success','work-fail','sleep','struggle','cola','orange','tongue','wash']) {
  assert.ok(pack.tracks[track].length>0,track);
  let previous=0;
  for(const file of pack.tracks[track]) {
   const index=Number(file.match(/-(\d+)_/)[1]);
   assert.ok(index>previous, file); previous=index;
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),pack.sha256[file]);
  }
 }
});

test('move stride curves keep stationary lead-in/lead-out frames anchored without ghost sliding',()=>{
 const {sampleMoveCurve}=require('../channel/web/static/js/core/indesktop-pet.js');
 const strides=JSON.parse(fs.readFileSync(path.join(__dirname,'../channel/web/static/vendor/dsh-pet/assets/characters/shenshen/videos/move_strides.json')));
 const runCurve=strides['左转奔跑'].curve;
 assert.equal(sampleMoveCurve(runCurve,0),0);
 assert.equal(sampleMoveCurve(runCurve,0.1),0);
 assert.ok(sampleMoveCurve(runCurve,0.35)>0 && sampleMoveCurve(runCurve,0.35)<1);
 assert.equal(sampleMoveCurve(runCurve,0.85),1);
 assert.equal(sampleMoveCurve(null,0.05),0);
 assert.equal(sampleMoveCurve(null,0.95),1);
 assert.ok(Math.abs(sampleMoveCurve(null,0.5)-0.5)<1e-12);
});

test('petShouldFlip matches default facing of Shenshen and Doro so neither walks backwards',()=>{
 const {petShouldFlip}=require('../channel/web/static/js/core/indesktop-pet.js');
 assert.equal(petShouldFlip({name:'左转奔跑'},-1,'shenshen'),false);
 assert.equal(petShouldFlip({name:'左转奔跑'},1,'shenshen'),true);
 assert.equal(petShouldFlip({name:'螃蟹走路'},-1,'shenshen'),false);
 assert.equal(petShouldFlip({name:'漂浮踏步'},1,'shenshen'),false);
 assert.equal(petShouldFlip({path:'move',name:'移动'},-1,'doro'),false);
 assert.equal(petShouldFlip({path:'move',name:'移动'},1,'doro'),true);
});

test('inward direction and move distance clamp prevent walking into screen walls',()=>{
 const {petChooseMoveDirection,petPlannedMoveDistance}=require('../channel/web/static/js/core/indesktop-pet.js');
 assert.equal(petChooseMoveDirection(20,1200,148,80,()=>0.1),1);
 assert.equal(petChooseMoveDirection(1000,1200,148,80,()=>0.9),-1);
 assert.equal(petPlannedMoveDistance(240,320,500,1,1200,148,16),240);
 assert.equal(petPlannedMoveDistance(240,320,1000,1,1200,148,16),36);
 assert.equal(petPlannedMoveDistance(240,240,500,1,1200,110,16),180);
});

test('petSafePlace, petSnapTarget, granular tasks, focus/ambient reactions, and hover/quick-chat markup',()=>{
 const {
  petSafePlace,petSnapTarget,petTaskStatus,petFocusReaction,petAmbientReaction,petClickLine,petFormatReplyPreview,petOverlayShouldIgnoreMouse
 }=require('../channel/web/static/js/core/indesktop-pet.js');

 const composer={left:200,top:620,right:900,bottom:740};
 const avoided=petSafePlace(400,640,1200,800,150,160,[composer],8);
 assert.equal(avoided.avoided,true);
 assert.ok(avoided.y+160<=composer.top-8 || avoided.x+150<=composer.left-8 || avoided.x>=composer.right+8);

 const docked=petSnapTarget(360,445,1200,800,150,160,composer,24);
 assert.equal(docked.docked,true);
 assert.equal(docked.y,460);

 assert.equal(petTaskStatus('tool_start','bash').phase,'terminal');
 assert.equal(petTaskStatus('tool_start','memory_search').phase,'memory');
 assert.equal(petTaskStatus('tool_start','delegate',{speakerName:'Coder'}).text,'[Coder] 正在执行：delegate');
 assert.equal(petTaskStatus('peer_start','', {speakerName:'Planner'}).phase,'team');
 assert.equal(petTaskStatus('peer_start','', {speakerName:'Planner'}).text,'正在交接给 Planner…');
 assert.equal(petTaskStatus('peer_end','').phase,'team');
 assert.equal(petTaskStatus('subagent_step','web_search',{speakerName:'Coder'}).phase,'team');
 assert.equal(petTaskStatus('subagent_step','web_search',{speakerName:'Coder'}).text,'[Coder] 子任务执行中：web_search');

 assert.equal(petFocusReaction({running:true,mode:'work'}).clipGroup,'focus');
 assert.equal(petFocusReaction({running:false,mode:'work',completed:true}).clipGroup,'celebrate');
 assert.equal(petAmbientReaction({musicPlaying:true,soundKind:''}).active,true);
 assert.equal(petFormatReplyPreview('## 标题\n**结果**：已完成\n```js\nconst a = 1;\n```','Planner',40),'[Planner] 标题 结果：已完成');
 assert.ok(petFormatReplyPreview('这是一段特别长的回答内容，需要在桌面宠物气泡里面进行合理截断以免挡住界面展示。','',28).endsWith('…'));

 for(const id of ['shenshen','doro']) {
  assert.ok(petClickLine(id,()=>0).length>0);
 }

 const html=fs.readFileSync(path.join(__dirname,'../channel/web/templates/layout/ambient-player.html'),'utf8');
 assert.ok(!html.includes('ambient-pet-tab'));
 assert.ok(!html.includes('ambient-pet-view'));
 for(const id of ['pet-side-panel','pet-quick-chat','pet-quick-input','pet-reset-pos','ambient-pet-restore','pet-passthrough','pet-desktop-window','pet-display-wrap','pet-display','pet-shortcut-wrap','pet-shortcut-btn','pet-shortcut-reset','pet-shortcut-error','pet-sound','shenshen','doro','checkin','inspire','compliment']) {
  assert.ok(html.includes(id),id);
 }
 for(const removed of ['xiaoya','lanlan','paopao','momo']) {
  assert.ok(!html.includes(removed),removed);
 }

 // Desktop overlay hit-testing rules
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: false, hitPet: false }), true);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: false, hitPet: true }), false);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: true, hitPet: true }), true);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: true, hitPanel: true }), false);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: true, hitQuickChat: true }), false);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: true, passthrough: true, hitBubble: true }), false);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: false, dragging: true }), false);
 assert.equal(petOverlayShouldIgnoreMouse({ enabled: false, hitPet: true }), true);

 const petHtml = fs.readFileSync(path.join(__dirname, '../channel/web/pet.html'), 'utf8');
 assert.ok(petHtml.includes('pet-window-mode'));
 assert.ok(petHtml.includes('templates/layout/ambient-player.html'));
 assert.ok(petHtml.includes('indesktop-pet.js'));
});

test('custom quick-ask shortcut normalization, event capture, matching, and hints', () => {
 const {
  petNormalizeShortcut, petShortcutFromKeyboardEvent, petFormatShortcut, petMatchesShortcut, petFormatHint, petClickLine
 } = require('../channel/web/static/js/core/indesktop-pet.js');

 assert.equal(petNormalizeShortcut('alt+p'), 'Alt+P');
 assert.equal(petNormalizeShortcut('shift+control+space'), 'Ctrl+Shift+Space');
 assert.equal(petNormalizeShortcut('CommandOrControl+Shift+k'), 'CmdOrCtrl+Shift+K');
 assert.equal(petNormalizeShortcut('f8'), 'F8');
 assert.equal(petNormalizeShortcut(''), '');
 assert.equal(petNormalizeShortcut('p'), null);
 assert.equal(petNormalizeShortcut('Shift+P'), null);
 assert.equal(petNormalizeShortcut('Ctrl+Alt'), null);

 // macOS Option+P produces dead/greek key 'π' in e.key while e.code is 'KeyP'
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ altKey: true, key: 'π', code: 'KeyP' }),
  { action: 'set', shortcut: 'Alt+P' }
 );
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ ctrlKey: true, shiftKey: true, key: ' ', code: 'Space' }),
  { action: 'set', shortcut: 'Ctrl+Shift+Space' }
 );
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }),
  { action: 'ignore' }
 );
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ key: 'Escape', code: 'Escape' }),
  { action: 'cancel' }
 );
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ key: 'Backspace', code: 'Backspace' }),
  { action: 'clear', shortcut: '' }
 );
 assert.deepEqual(
  petShortcutFromKeyboardEvent({ shiftKey: true, key: 'A', code: 'KeyA' }),
  { action: 'invalid' }
 );

 assert.equal(petFormatShortcut('Alt+P', 'darwin'), 'Option+P');
 assert.equal(petFormatShortcut('CmdOrCtrl+Shift+K', 'darwin'), 'Cmd+Shift+K');
 assert.equal(petFormatShortcut('CmdOrCtrl+Shift+K', 'win32'), 'Ctrl+Shift+K');
 assert.equal(petFormatShortcut('', 'win32'), '未设置');

 assert.equal(petMatchesShortcut({ altKey: true, code: 'KeyP', key: 'π' }, 'Alt+P', 'darwin'), true);
 assert.equal(petMatchesShortcut({ altKey: true, ctrlKey: true, code: 'KeyP', key: 'p' }, 'Alt+P', 'win32'), false);
 assert.equal(petMatchesShortcut({ metaKey: true, shiftKey: true, code: 'KeyK', key: 'K' }, 'CmdOrCtrl+Shift+K', 'darwin'), true);
 assert.equal(petMatchesShortcut({ altKey: true, code: 'KeyP', key: 'p' }, '', 'win32'), false);

 assert.ok(petFormatHint('Ctrl+Shift+Space', 'win32').includes('Ctrl+Shift+Space'));
 assert.ok(!petFormatHint('', 'win32').includes('Alt+P'));
 assert.match(petClickLine('shenshen', () => 0.7, null, 'Ctrl+K', 'win32'), /Ctrl\+K/);
});
