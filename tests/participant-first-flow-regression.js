'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=process.env.PARTICIPANT_FIRST_SOURCE_ROOT
  ? path.resolve(process.env.PARTICIPANT_FIRST_SOURCE_ROOT)
  : path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const team=fs.readFileSync(path.join(root,'js','team.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const teamHtml=fs.readFileSync(path.join(root,'team.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css','app.css'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾지 못했습니다.`);
  const safeEnd=end>=6&&src.slice(end-6,end)==='async '?end-6:end;
  return src.slice(start,safeEnd);
}

const handed=[];
const dailySandbox={
  APP_VERSION:'1.2.3',_dailyPlayers:[{name:'가'},{name:'나'}],
  _dailyCheckinId:null,_dailyOperationStarted:false,_dailyMatches:[],
  location:{href:''},document:{getElementById:()=>null},
  sessionStorage:{setItem:()=>{},removeItem:()=>{}},
  _dailyRosterBridge:()=>({handoff:(source,rows)=>handed.push({source,count:rows.length})}),
  dailyImportRoster:()=>{throw new Error('등록된 선수에서 등록창을 다시 열면 안 됩니다.');},
  dailyOpenBoardTarget:()=>{},dailyRender:()=>{},_dailyPreparedOperation:''
};
vm.createContext(dailySandbox);
vm.runInContext(`${functionSource(daily,'dailyChooseOperation','_dailyCreatePlayerDirect')}\nthis.run=dailyChooseOperation;`,dailySandbox);
dailySandbox.run('team');
assert.deepStrictEqual(handed,[{source:'daily',count:2}],'민턴에서 팀전을 고르면 현재 명단을 공통 스냅샷으로 건네야 합니다.');
assert.strictEqual(dailySandbox.location.href,'team.html?v=1.2.3&from=participants&source=daily','팀전은 자동 명단 승계 주소로 열려야 합니다.');

let imported=null;
const dailyEntry={
  URLSearchParams,
  location:{search:'?from=participants&source=team'},
  _dailyCheckinId:null,_dailyOperationStarted:false,_dailyMatches:[],
  _dailyParticipantHandoffSnapshot:()=>({source:'team',players:[{name:'팀전가'}]}),
  dailyImportTeamRoster:options=>{imported=options;return true;}
};
vm.createContext(dailyEntry);
vm.runInContext(`${functionSource(daily,'dailyApplyParticipantHandoff','renderParticipantPreparation')}\nthis.run=dailyApplyParticipantHandoff;`,dailyEntry);
assert.strictEqual(dailyEntry.run(),true,'팀전에서 돌아온 공통 명단을 민턴 준비 화면에 자동 적용해야 합니다.');
assert.strictEqual(imported.silent,true,'자동 승계는 불필요한 확인창 없이 끝나야 합니다.');
dailyEntry._dailyOperationStarted=true;
imported=null;
assert.strictEqual(dailyEntry.run(),false,'민턴LIVE 진행 중에는 공통 명단으로 덮어쓰면 안 됩니다.');
assert.strictEqual(imported,null,'진행 중 기록 보호 시 가져오기 함수를 호출하면 안 됩니다.');

assert(indexHtml.includes('participant-prep-register')&&indexHtml.includes('participantChooseDaily')&&indexHtml.includes('participantChooseTeam'),
  '첫 화면은 참가자 등록 뒤 운영 방식을 선택하는 두 단계여야 합니다.');
const dailyPage=indexHtml.indexOf('id="pageDaily"');
const prepCard=indexHtml.indexOf('id="operationModeCard"');
const dashboard=indexHtml.indexOf('daily-dashboard-card');
assert(dailyPage>=0&&prepCard>dailyPage&&dashboard>prepCard,
  '참가자 준비 카드는 숨은 옛 페이지가 아니라 실제 민턴 상황판 바로 위에 있어야 합니다.');
assert(!indexHtml.includes('dailyImportTeamRosterBtn')&&!teamHtml.includes('teamImportDailyRosterBtn'),
  '수동 명단 복사 버튼이 다시 생기면 안 됩니다.');
assert(!indexHtml.includes('live-mode-switch')&&!teamHtml.includes('live-mode-switch'),
  '운영 방식을 고른 뒤 상단에 같은 선택을 다시 노출하면 안 됩니다.');
assert(css.includes('.participant-operation-grid .operation-option:disabled'),
  '참가자가 없을 때 운영 방식 선택을 비활성화하는 화면 규칙이 있어야 합니다.');

console.log('participant first flow regression ok');
