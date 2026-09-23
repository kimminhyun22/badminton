'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=process.env.DAILY_IMAGE_IMPORT_SOURCE_ROOT
  ?path.resolve(process.env.DAILY_IMAGE_IMPORT_SOURCE_ROOT)
  :path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/daily-image-import.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const daily=fs.readFileSync(path.join(root,'js/daily.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const sandbox={window:{},document:{getElementById(){return null;}},console,setTimeout,clearTimeout,URL,Image:function(){}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);
const api=sandbox.window.KokMatchDailyImageImport;
assert(api&&typeof api.resolve==='function','캡처 분석 결과의 확정 규칙을 공개해야 합니다.');

const roster=Array.from({length:16},(_,index)=>({
  memberId:`m${index+1}`,name:`회원${String(index+1).padStart(2,'0')}`,grade:index%3===0?'B':'C',gender:index%2?'여':'남',ageGroup:'40대'
}));
const vote=roster.slice(0,15).map(member=>({name:`${member.name}/90/C`}));
// 겹친 캡처와 같은 중복 이름은 한 명으로 세야 합니다.
vote.push({name:'회원08/78/C'});
const raw={
  voteAttendees:vote,
  // 게스트만 접수한 댓글 작성자는 commentAttendees에 포함하지 않는 것이 AI 계약입니다.
  commentAttendees:[{name:'회원16(경기이사)',arrivalText:'11시 참석'}],
  guests:[
    {name:'게스트가',gender:'남',grade:'A'},
    {name:'게스트나',gender:'남',grade:'B'},
    {name:'게스트다',gender:'여',grade:'C'},
    {name:'게스트가',gender:'남',grade:'A'}
  ],
  lateMentions:[{name:'회원06',arrivalText:'11시쯤 늦게 참석'},{name:'회원16',arrivalText:'11시 참석'}],
  declaredVoteCount:15,
  warnings:[]
};
const result=api.resolve(raw,roster);
assert.strictEqual(result.voteCount,15,'겹친 투표 캡처는 중복을 제거해 15명이어야 합니다.');
assert.strictEqual(result.commentCount,1,'투표 밖 댓글 참석 회원을 별도로 한 명 더해야 합니다.');
assert.strictEqual(result.guests.length,3,'여러 댓글에 반복된 게스트는 한 번만 세야 합니다.');
assert.strictEqual(result.members.length,16,'회원은 투표 15명과 댓글 추가 1명이어야 합니다.');
assert.strictEqual(result.total,19,'최종 등록 후보는 회원 16명과 게스트 3명, 총 19명이어야 합니다.');
assert.strictEqual(result.members.filter(row=>row.arrivalText).length,2,'지각 표시는 참가 집계에서 빼지 않고 상태로 붙여야 합니다.');
assert(result.members.every(row=>row.match),'정확히 일치한 회원은 명부 프로필과 연결되어야 합니다.');
assert.strictEqual(result.guests[0].ageGroup,'40대','게스트 연령 미기재 시 화면에서 확인 가능한 기본값을 제공해야 합니다.');

const unresolved=api.resolve({...raw,voteAttendees:[...raw.voteAttendees,{name:'잘못읽은이름'}]},roster);
assert(unresolved.members.some(row=>!row.match),'명부에 없는 회원 이름을 자동 확정하면 안 됩니다.');
assert(unresolved.warnings.some(message=>message.includes('투표 화면은 15명')),'투표 머리글과 추출 인원이 다르면 경고해야 합니다.');

assert(index.includes('id="dailyCaptureInput"')&&index.includes('multiple')&&index.includes('KokMatchDailyImageImport.analyze()'),
  '관리자 참가자 모달에 여러 캡처 선택과 분석 입구가 있어야 합니다.');
assert(index.includes('firebase-app-check-site-key'),'공개 AI 호출은 App Check로 보호해야 합니다.');
assert(index.indexOf('js/daily-image-import.js')<index.indexOf('js/daily.js'),'캡처 모듈은 적용 함수를 부르는 daily.js보다 먼저 로드해야 합니다.');
assert(daily.includes('async function dailyApplyImageImportResult(payload)'),'확정 결과를 기존 참가자 등록 경로에 적용해야 합니다.');
assert(source.includes("status:row.arrivalText?'planned':'wait'")&&daily.includes("raw.status==='planned'?'planned':'wait'"),
  '지각 댓글은 도착 전 상태로 등록해야 합니다.');
assert(sw.includes("'/badminton/js/daily-image-import.js'"),'설치형 앱에서도 캡처 등록 모듈을 캐시해야 합니다.');
assert(!source.includes('localStorage')&&!source.includes('firebase.storage'),'캡처 원본이나 분석 결과를 별도 저장하면 안 됩니다.');

console.log('daily image participant import regression ok');
