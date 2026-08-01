'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const dailySrc=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const appCss=fs.readFileSync(path.join(root,'css','app.css'),'utf8');

function functionSource(name,nextName){
  const start=dailySrc.indexOf(`function ${name}`);
  const end=dailySrc.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return dailySrc.slice(start,end);
}

const rosterMatch=dailySrc.match(/const DAILY_AUG3_RECOVERY_ROSTER=Object\.freeze\((\[[\s\S]*?\])\);/);
assert(rosterMatch,'8월 3일 복구 명단 원본이 있어야 합니다.');
const roster=vm.runInNewContext(rosterMatch[1]);
assert.strictEqual(roster.length,36,'8월 3일 준비 명단은 정확히 36명이어야 합니다.');
assert.strictEqual(new Set(roster.map(row=>row[0])).size,36,'복구 명단에 중복 이름이 있으면 안 됩니다.');
assert.strictEqual(roster.filter(row=>row[4]).length,7,'확정된 게스트 7명을 회원과 구분해야 합니다.');
assert.deepStrictEqual(Array.from(roster.find(row=>row[0]==='김하주').slice(1,3)),['S','남'],'희소 S급 선수의 복구 기본값을 잃으면 안 됩니다.');

const recoverySandbox={DAILY_AUG3_RECOVERY_ROSTER:roster};
vm.createContext(recoverySandbox);
vm.runInContext(`
let rosters={clubs:[]};
function _rsvpNameKey(value){return String(value||'').replace(/\\s+/g,'').toLowerCase();}
function _rsvpMemberId(profile){return 'member-'+_rsvpNameKey(profile.name);}
${functionSource('_dailyRecoveryNameKey','_dailyAug3RecoveryClub')}
${functionSource('_dailyAug3RecoveryClub','_dailyBuildAug3RecoveryDraft')}
${functionSource('_dailyBuildAug3RecoveryDraft','_dailyTryRestoreAug3Preparation')}
this.api={
  set(clubs){rosters={clubs};},
  build:_dailyBuildAug3RecoveryDraft
};
`,recoverySandbox);

const members=roster.filter(row=>!row[4]).map(([name,grade,gender,ageGroup])=>({name,grade,gender,ageGroup}));
members.find(member=>member.name==='김하주').grade='A';
recoverySandbox.api.set([{name:'일만클럽',members}]);
const rebuilt=recoverySandbox.api.build();
assert(rebuilt,'일만클럽 명부 이름이 충분히 일치하면 복구본을 만들 수 있어야 합니다.');
assert.strictEqual(rebuilt.targetDate,'2026-08-03');
assert.strictEqual(rebuilt.players.length,36);
assert.strictEqual(rebuilt.players.find(player=>player.name==='김하주').grade,'A','기존 회원은 코드 기본값보다 기기 명부의 최신 급수를 우선해야 합니다.');
assert.strictEqual(rebuilt.players.find(player=>player.name==='강연수').isGuest,true,'게스트는 같은 이름의 회원과 섞이면 안 됩니다.');

const roleMembers=members.map(member=>member.name==='김민현'?{...member,name:'김민현(재무)',isClubOfficial:true}:member);
recoverySandbox.api.set([{name:'일만클럽',members:roleMembers}]);
const roleRebuilt=recoverySandbox.api.build();
assert.strictEqual(roleRebuilt.players.find(player=>player.name==='김민현').isClubOfficial,true,'이름의 임원 표기가 달라도 현재 명부 권한을 복원해야 합니다.');

recoverySandbox.api.set([{name:'다른클럽',members}]);
assert.strictEqual(recoverySandbox.api.build(),null,'이름이 같아도 일만클럽이 아니면 전용 복구본을 적용하면 안 됩니다.');
recoverySandbox.api.set([{id:'old',name:'일만클럽',members},{id:'copy',name:'일만 클럽',members}]);
assert.strictEqual(recoverySandbox.api.build(),null,'동률인 중복 일만클럽 명부가 있으면 임의 선택하면 안 됩니다.');

const tryRestore=functionSource('_dailyTryRestoreAug3Preparation','dailySave');
assert(tryRestore.includes("localStorage.getItem(DAILY_AUG3_RECOVERY_MARKER)==='restored'"),'8월 3일 자동 복구는 한 번만 실행해야 합니다.');
assert(tryRestore.includes('_dailyPlayers.length||_dailyCheckinId||_dailyOperationStarted||_dailyMatches.length'),'기존 명단이나 LIVE가 있으면 복구본으로 덮어쓰면 안 됩니다.');
assert(tryRestore.includes('draft.players.length!==36'),'36명 검증에 실패한 복구본은 적용하면 안 됩니다.');

const restoreSandbox={};
vm.createContext(restoreSandbox);
vm.runInContext(`
const DAILY_AUG3_RECOVERY_MARKER='recovery-marker';
let _dailyPlayers=[];
let _dailyCheckinId=null;
let _dailyOperationStarted=false;
let _dailyMatches=[];
let applied=0;
let storeEnabled=true;
let drafts=[];
const values=new Map();
const localStorage={
  getItem:key=>values.has(key)?values.get(key):null,
  setItem:(key,value)=>values.set(key,String(value))
};
function _dailyNow(){return new Date('2026-08-02T12:00:00+09:00').getTime();}
function _dailyLocalDateKey(){return '2026-08-02';}
function _dailyReadPreparationDrafts(){return drafts;}
function _dailyBuildAug3RecoveryDraft(){return {id:'daily-preparation-2026-08-03-jilman-36',players:Array.from({length:36},(_,i)=>({name:'선수'+i}))};}
function _dailyStorePreparationDraft(draft){if(!storeEnabled)return null;drafts=[draft];return draft;}
function _dailyApplyPreparationDraft(){applied+=1;return true;}
${tryRestore}
this.api={
  run:_dailyTryRestoreAug3Preparation,
  applied:()=>applied,
  stored:()=>drafts.length,
  marker:()=>localStorage.getItem(DAILY_AUG3_RECOVERY_MARKER),
  setPlayers:players=>{_dailyPlayers=players;},
  clearMarker:()=>values.delete(DAILY_AUG3_RECOVERY_MARKER),
  clearDrafts:()=>{drafts=[];},
  setStoreEnabled:value=>{storeEnabled=value;}
};
`,restoreSandbox);
restoreSandbox.api.setPlayers([{name:'현재 선수'}]);
assert.strictEqual(restoreSandbox.api.run(),false,'현재 명단이 있으면 복구본으로 덮어쓰면 안 됩니다.');
assert.strictEqual(restoreSandbox.api.stored(),1,'기존 명단이 있어도 나중에 쓸 36명 복구본은 먼저 보관해야 합니다.');
assert.strictEqual(restoreSandbox.api.applied(),0);
restoreSandbox.api.setPlayers([]);
assert.strictEqual(restoreSandbox.api.run(),true,'빈 준비 화면에는 보관된 36명 복구본을 자동 적용해야 합니다.');
assert.strictEqual(restoreSandbox.api.applied(),1);
assert.strictEqual(restoreSandbox.api.marker(),'restored','성공한 복구만 일회성 완료로 기록해야 합니다.');
assert.strictEqual(restoreSandbox.api.run(),false,'같은 기기에서 자동 복구가 반복되면 안 됩니다.');
restoreSandbox.api.clearMarker();
restoreSandbox.api.clearDrafts();
restoreSandbox.api.setStoreEnabled(false);
assert.strictEqual(restoreSandbox.api.run(),false,'복구본 저장이 실패하면 적용 완료로 처리하면 안 됩니다.');
assert.strictEqual(restoreSandbox.api.marker(),null,'저장 실패 시 재시도를 막는 완료 표식을 남기면 안 됩니다.');
assert.strictEqual(restoreSandbox.api.applied(),1);

const archive=functionSource('_dailyArchiveCurrentPreparation','_dailyLatestPreparationDraft');
assert(archive.includes('_dailyOperationStarted||_dailyCheckinId||_dailyMatches.length'),'LIVE 시작 전 명단만 준비본으로 자동 보관해야 합니다.');
const storeDraft=functionSource('_dailyStorePreparationDraft','_dailyArchiveCurrentPreparation');
assert(storeDraft.includes('if(!_dailyWritePreparationDrafts(drafts))return null'),'준비 명단 저장 실패를 성공으로 오인하면 안 됩니다.');
const saveSource=functionSource('dailySave','_dailySameLocalDay');
assert(saveSource.includes('return true;')&&saveSource.includes('return false;'),'핵심 상태 저장 성공 여부를 복구 흐름이 확인할 수 있어야 합니다.');
assert(saveSource.indexOf('localStorage.setItem(DAILY_KEY')<saveSource.indexOf('_dailyArchiveCurrentPreparation();'),'저장 공간이 부족해도 핵심 상태를 복구 사본보다 먼저 보존해야 합니다.');
const loadSource=functionSource('dailyLoad','dailyApplyReviewSample');
assert(loadSource.includes('_dailyArchiveCurrentPreparation();'),'기존 버전의 미시작 명단도 LIVE 시작 전에 즉시 백업해야 합니다.');
assert(dailySrc.includes('DAILY_PREPARATION_RETENTION_MS=7*24*60*60*1000'),'준비 명단은 7일간 보관해야 합니다.');
assert(dailySrc.includes('DAILY_PREPARATION_DRAFT_LIMIT=3'),'최근 준비 명단은 3개까지만 보관해야 합니다.');
assert(dailySrc.includes('_dailyPreparationState(s,now)?_dailyPreparationPlayers(s.players):[]'),'날짜가 바뀌어도 미시작 준비 명단을 보존해야 합니다.');
const reset=functionSource('dailyReset','dailyToggleAutoAssign');
assert(!reset.includes('DAILY_PREPARATION_DRAFT_KEY'),'초기화 후에도 보관된 준비 명단은 복원할 수 있어야 합니다.');

assert(indexHtml.includes('id="dailyPreparationDraftBanner"'),'상황판 상단에 준비 명단 복원 영역이 있어야 합니다.');
const renderDraft=functionSource('dailyRenderPreparationDraft','dailyRenderStartGuide');
assert(renderDraft.includes('onclick="dailyRestoreLatestPreparationDraft()"'),'복원 버튼에는 검증되지 않은 저장 ID를 직접 삽입하면 안 됩니다.');
assert(!renderDraft.includes('esc(draft.id)'),'로컬 저장 ID를 인라인 스크립트에 넣으면 안 됩니다.');
assert(appCss.includes('.daily-preparation-banner[hidden]{display:none!important;}'),'준비 명단이 없을 때 빈 영역이 남으면 안 됩니다.');
assert(appCss.includes('min-height:44px'),'모바일 복원 버튼은 충분한 터치 높이를 가져야 합니다.');

console.log('daily preparation draft regression ok');
