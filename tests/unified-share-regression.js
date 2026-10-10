'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function source(file,start,end){const s=read(file);return s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));}
const daily=source('js/daily.js','async function dailyShareCheckinLink(','function _dailyOpenSharePopup(');
const team=source('js/team.js','async function rsvpCopyShareText(','function rsvpLoad(');
const css=read('css/minton-ui.css');
assert(/button\.share-primary\{[^}]*background:#fee500!important/.test(css));
for(const file of ['index.html','team.html','js/team.js']){
  const s=read(file);assert(!/onclick="(?:dailyShareCheckinLink|rsvpShareLink)\('(kakao|band)'\)/.test(s));
  assert(s.includes('share-primary')&&s.includes('icons/lucide/share-2.svg'));
}
async function run(code,name,scenario){
  const calls={share:[],copy:[],popup:0,published:0,alerts:[]};
  const sandbox={String,console,confirm:()=>true,_dailyCheckinId:'test',_dailyOperationStarted:true,_dailyVoteDeadlineAt:'',_dailyPublishKeptUrl:'',
    _dailyOpenSharePopup:()=>{calls.popup++;},_dailyCheckinUrl:()=> 'https://example.invalid/checkin?id=TEST',
    dailyPublishCheckinSession:async()=>{calls.published++;return scenario==='failed'?null:'test';},
    _dailyCopyToClipboard:async s=>{calls.copy.push(s);return true;},_dailyFlashNote:()=>{},
    currentMatches:[{}],_rsvpEnsureCurrentEventLink:()=>{},_rsvpSessionMembers:()=>[{}],teamLiveOpenPlayers:()=>{},_fbInit:()=>true,
    rsvpEnsureId:()=>{},_rsvpUrl:()=> 'https://example.invalid/rsvp?id=TEST',_rsvpApplyAutoTitle:()=>{},_rsvpTitle:()=> '민턴LIVE',
    rsvpPublishSession:async()=>{calls.published++;return scenario==='failed'?null:'test';},_teamFlashNote:()=>{},
    _teamShareReadyKey:scenario==='failed'?'':'ready',_teamShareSnapshot:()=>({key:'ready'}),
    _teamPrepareShareLink:async()=>{calls.published++;return scenario!=='failed';},
    _teamOpenSharePopup:()=>{calls.popup++;},alert:s=>calls.alerts.push(s),prompt:()=>{throw Error('unexpected prompt');},
    navigator:{clipboard:{writeText:async s=>calls.copy.push(s)}}};
  if(scenario!=='no-share')sandbox.navigator.share=async p=>{calls.share.push(p);if(scenario==='cancel')throw Object.assign(Error('cancel'),{name:'AbortError'});if(scenario==='denied')throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
  vm.createContext(sandbox);vm.runInContext(code,sandbox);await sandbox[name]();
  assert.equal(calls.popup,0);assert.equal(calls.published,name==='rsvpCopyShareText'&&scenario!=='failed'?0:1);
  if(scenario==='failed'){assert.equal(calls.share.length,0);assert.equal(calls.copy.length,0);}
  else if(scenario==='no-share'||scenario==='denied'){assert.equal(calls.copy.length,1);assert.equal((calls.copy[0].match(/https:\/\//g)||[]).length,1);}
  else {assert.equal(calls.share.length,1);assert(calls.share[0].url.startsWith('https://'));assert(!calls.share[0].text.includes('https://'));assert.equal(calls.copy.length,0);}
}
(async()=>{
  for(const scenario of ['success','cancel','no-share','denied','failed'])for(const [code,name] of [[daily,'dailyShareCheckinLink'],[team,'rsvpCopyShareText']])await run(code,name,scenario);
  // Removing the URL field must break the common sharing contract.
  await assert.rejects(run(team.replace('text:body,url','text:body'),'rsvpCopyShareText','success'));
  console.log('unified share: 10 behavior cases, single UI entry, yellow style and payload mutation PASS');
})().catch(e=>{console.error(e);process.exit(1);});
