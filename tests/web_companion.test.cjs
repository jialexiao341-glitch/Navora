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
