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
 for(const id of ['pet-side-panel','pet-quick-chat','pet-quick-input','pet-reset-pos','ambient-pet-restore','pet-passthrough','pet-desktop-window','pet-sound','shenshen','doro','checkin','inspire','compliment']) {
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
