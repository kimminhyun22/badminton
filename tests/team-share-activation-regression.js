'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('js/team.js','utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const code=cut("let _teamShareActive=false;","/* 채널별 바로 공유")+cut("let _teamShareReadyKey=",'function rsvpLoad(');
async function fixture(source=code){
 const calls={share:0,writes:0,copy:0,alerts:[],silent:[]},button={setAttribute(){}};
 let revision=1,fail=false,release,activation=true,shareRelease;
 const c={String,Date,Promise,console,currentMatches:[{}],_rsvpId:'TEST',
  _rsvpEnsureCurrentEventLink:o=>calls.silent.push(o.silent),_rsvpSessionMembers:()=>[{}],_fbInit:()=>true,rsvpEnsureId:()=>{},
  _rsvpSessionPayload:()=>({rsvpId:'TEST',members:[{id:revision}],createdAt:1,updatedAt:Date.now(),eventUpdatedAt:Date.now()}),
  _rsvpRememberHistory:()=>{},rsvpStartListener:()=>{},_rsvpUrl:()=> 'https://example.invalid/rsvp?id=TEST',_rsvpApplyAutoTitle:()=>{},_rsvpTitle:()=> 'E2E팀전',
  document:{querySelectorAll:()=>[button]},alert:m=>calls.alerts.push(m),_teamFlashNote:()=>{},teamLiveOpenPlayers:()=>{},
  navigator:{share:p=>{assert(activation,'share must start inside click activation');calls.share++;assert(p.url);return new Promise(r=>shareRelease=r);},clipboard:{writeText:async()=>calls.copy++}},
  _fbDb:{ref:()=>({update:()=>{calls.writes++;return new Promise((r,j)=>release=()=>fail?j(Error('offline')):r());},set:async()=>{calls.writes++;}})}};
 vm.createContext(c);vm.runInContext(source,c);
 const prepare=c._teamPrepareShareLink();assert.equal(button.disabled,true);button.disabled=false;const concurrent=c._teamPrepareShareLink();assert.equal(button.disabled,true,'rerendered button must stay disabled while save is pending');release();assert(await prepare);assert(await concurrent);assert.equal(button.disabled,false);
 const writes=calls.writes;
 const share=c.rsvpShareLink();assert.equal(calls.share,1,'one click must invoke native share synchronously, before a microtask');
 activation=false;await c.rsvpShareLink();assert.equal(calls.share,1,'double clicks cannot dispatch twice');shareRelease();await share;assert.equal(calls.writes,writes,'ready link needs no click-time network wait');assert(calls.silent.every(Boolean),'sharing must not show link-switch confirmation');
 const cached=c._teamPrepareShareLink();assert(await cached);assert.equal(calls.writes,writes);
 revision=2;const changed=c._teamPrepareShareLink();assert.equal(button.disabled,true);release();assert(await changed);assert.equal(calls.writes,writes+2);
 revision=3;fail=true;const failed=c._teamPrepareShareLink();release();assert.equal(await failed,false);assert.equal(button.disabled,false);
 return calls;
}
(async()=>{
 assert(cut('function rsvpSaveLocal(){','function rsvpEnsureId()').includes('_teamWarmShareLink()'),'title changes must warm the new snapshot before sharing');
 await fixture();
 // Restoring the old network wait destroys click activation and must be caught.
 await assert.rejects(fixture(code.replace('  if(navigator.share){','  await Promise.resolve().then(()=>{});\n  if(navigator.share){')));
 console.log('PASS prepublished link, synchronous native sharing, double-click guard, silent switching, cache invalidation, failed-save recovery and activation mutation');
})().catch(e=>{console.error(e);process.exit(1);});
