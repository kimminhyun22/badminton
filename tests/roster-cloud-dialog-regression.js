'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/roster-cloud.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
  constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.attributes={};}
  append(child){child.remove();this.children.push(child);child.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
  replaceChildren(){for(const child of this.children.slice())child.remove();}
  get isConnected(){return this.root===true||!!this.parent?.isConnected;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  setAttribute(key,value){this.attributes[key]=value;}
  all(){return [this,...this.children.flatMap(c=>c.all())];}
}
async function check(script){
  const head=new Element('head'),body=new Element('body');
  head.root=body.root=true;
  const club={id:'c',name:'시험 클럽',members:[{name:'시험 회원'}]};
  const values=new Map([['badminton_rosters_v1',JSON.stringify({clubs:[club]})]]);
  const document={head,body,createElement:t=>new Element(t),addEventListener(){},
    querySelectorAll:selector=>body.all().filter(e=>selector==='[data-roster-cloud-status]'&&e.dataset.rosterCloudStatus!==undefined)};
  let fail=true,release,historyReads=0;
  const sdk={getApps:()=>[],initializeApp:()=>({}),getAuth:()=>({}),getFunctions:()=>({}),
    onAuthStateChanged:(_,f)=>f({uid:'fake',email:'fixture'}),httpsCallable:()=>async ({action})=>{
      if(action==='list'){
        await new Promise(resolve=>{release=resolve;});
        if(fail)throw Error('unavailable');
        return {data:{clubs:[]}};
      }
      assert.equal(action,'history');historyReads++;return {data:{versions:[]}};
    }};
  const context={sdk,document,navigator:{onLine:true},localStorage:{getItem:key=>values.get(key)||null},setInterval(){},
    window:{KokMatchFirebaseConfig:{},addEventListener(){}},alert:msg=>{throw Error(msg);}};
  vm.runInNewContext(script.replaceAll(/await import\(root\+'firebase-(?:app|auth|functions)\.js'\)/g,'await sdk'),context);
  await tick();
  const open=context.window.openRosterCloud();
  const dialog=body.children[0],buttons=text=>dialog.all().filter(el=>el.tag==='button'&&el.textContent===text);
  assert.equal(buttons('닫기').length,1,'loading offers an exit on touch screens');
  release();await open;
  assert.equal(buttons('닫기').length,1,'list failure still offers an exit');
  assert.equal(buttons('다시 불러오기').length,1,'list failure can retry');
  fail=false;
  const retry=buttons('다시 불러오기')[0].onclick();release();await retry;
  assert.equal(buttons('서버에 저장').length,1);assert.equal(buttons('이 기기 명부 모두 서버에 저장').length,0);
  assert.equal(buttons('다시 저장').length,0);
  values.set('badminton_rosters_v1',JSON.stringify({clubs:[club,{...club,id:'d'}]}));
  const two=context.window.openRosterCloud();release();await two;assert.equal(buttons('이 기기 명부 모두 서버에 저장').length,1);
  values.set('minton_roster_cloud_v1_fake',JSON.stringify({c:{id:'remote',base:club,updatedAt:1}}));
  const a=context.window.openRosterCloud(),oldReply=release;
  await buttons('닫기')[0].onclick();
  const b=context.window.openRosterCloud();release();await b;oldReply();await a;
  assert.equal(buttons('저장 이력').length,1,'late result from a previous opening adds no duplicate controls');
  const history=buttons('저장 이력')[0];
  await history.onclick();assert.equal(history.attributes['aria-expanded'],'true');
  await history.onclick();assert.equal(history.attributes['aria-expanded'],'false');
  assert.equal(historyReads,1);
}
(async()=>{
  await check(source);
  const withoutClose=source.replace("button('닫기',()=>dialog.close(),header);",'');
  assert.notEqual(withoutClose,source);await assert.rejects(check(withoutClose),/loading offers an exit/);
  console.log('roster cloud dialog: loading, retry, late result, single and multiple save actions, history and mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
