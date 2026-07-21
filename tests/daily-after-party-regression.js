const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

assert(daily.includes('afterPartyV1:true'),'민턴LIVE 세션이 회원 뒷풀이 신청 기능을 명시해야 합니다.');
assert(checkin.includes('${afterPartyBox(selected,requestDisabledAttr)}'),'본인 카드에 뒷풀이 신청·취소 버튼을 제공해야 합니다.');
assert(checkin.includes('${officialPartySummaryHtml()}'),'클럽 임원 화면에서 뒷풀이 신청 인원과 이름을 바로 확인할 수 있어야 합니다.');

const toggle=functionSource(checkin,'toggleAfterParty','officialActor');
assert(toggle.includes('confirmPlayerIdentity(p)'),'뒷풀이 신청은 이 기기에서 확인한 본인에게만 제공해야 합니다.');
assert(toggle.includes("checkinPath()+'/party/'+playerId"),'뒷풀이 응답은 현재 민턴LIVE 링크 아래에 격리해 저장해야 합니다.');
assert(toggle.includes('firebase.database.ServerValue.TIMESTAMP'),'회원 기기 시간이 아닌 서버 시간으로 신청 시점을 기록해야 합니다.');
assert(toggle.includes('await ref.transaction'),'동시 신청·취소는 선수별 원자 트랜잭션으로 저장해야 합니다.');
assert(toggle.includes('revision:Number(current?.revision||0)+1'),'다른 기기의 갱신 순서를 확인할 수 있도록 리비전을 올려야 합니다.');
assert(toggle.includes(':null);'),'회원이 같은 버튼에서 뒷풀이 신청을 취소할 수 있어야 합니다.');
assert(toggle.includes('if(previous)partyResponses[playerId]=previous'),'저장 실패 시 낙관적으로 바꾼 화면을 이전 상태로 되돌려야 합니다.');
assert(!toggle.includes('operatorConnected()'),'뒷풀이 신청은 관리자 대진 엔진 연결과 무관하게 저장되어야 합니다.');

const listener=functionSource(daily,'dailyStartCheckinListener','_dailyCheckinBlockReason');
assert(listener.includes("_fbDb.ref(path+'/party').on"),'시스템 관리자 화면도 예외 확인을 위해 현재 뒷풀이 명단을 구독해야 합니다.');
assert(daily.includes("_fbDb.ref(_dailyCheckinListeningPath+'/party').off()"),'다른 민턴LIVE 링크로 바뀔 때 이전 뒷풀이 구독을 해제해야 합니다.');
const managerSummary=functionSource(daily,'dailyRenderCheckinRequests','dailyRender');
assert(managerSummary.includes('뒷풀이 ${partyNames.length}명'),'관리자 링크 패널에서 뒷풀이 신청 수를 확인할 수 있어야 합니다.');
assert(managerSummary.includes("row.attending!==false&&_dailyPlayer(id)"),'취소됐거나 현재 참가자 명단에 없는 뒷풀이 응답을 집계하면 안 됩니다.');
assert(!managerSummary.includes('row.name'),'공개 경로의 이름을 신뢰하지 말고 현재 참가자 명단에서 이름을 가져와야 합니다.');
assert(daily.includes('const base=startedAt||_dailyCheckinCreatedAt||0'),'첫 경기 전 링크도 생성 시각 기준으로 만료되어야 합니다.');

const helperSource=functionSource(checkin,'afterPartyEntry','afterPartyBox');
const helperSandbox={};
vm.createContext(helperSandbox);
vm.runInContext(`
let session={players:[{id:'p1',name:'동명이인'},{id:'p2',name:'동명이인'}]};
let partyResponses={p1:{attending:true},p2:{attending:true},stale:{attending:true}};
${helperSource}
this.names=afterPartyNames;
`,helperSandbox);
assert.strictEqual(helperSandbox.names().length,2,'동명이인도 서로 다른 현재 선수 ID라면 두 명으로 집계해야 합니다.');
assert.deepStrictEqual(Array.from(helperSandbox.names()),['동명이인','동명이인'],'삭제된 선수 ID는 집계하지 않고 현재 명단 이름만 사용해야 합니다.');

console.log('daily after-party regression ok');
