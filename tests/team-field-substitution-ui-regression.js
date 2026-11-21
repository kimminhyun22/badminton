'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const field = require('../functions/team-field-substitution');
const {suggestSubstitutes} = require('../functions/team-official-engine');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root,'js/live-view.js'),'utf8');
const html = fs.readFileSync(path.join(root,'view.html'),'utf8');
assert(html.indexOf('functions/team-field-substitution.js?') >= 0);
assert(html.indexOf('functions/team-field-substitution.js?') < html.indexOf('js/live-view.js?'));

const c = {TeamFieldSubstitution:field,window:{},liveTeamLabel:(_d,side)=>side};
vm.createContext(c);
function include(start,end){
  const i=src.indexOf(start),j=src.indexOf(end,i+start.length);
  assert(i>=0&&j>i,start);
  vm.runInContext(src.slice(i,j),c);
}
include('function esc(s)','\n');
include('function _attKey(name)','function _partyOn(');
include('function _normalizeMembers(','function _sortMembers(');
include('function _teamOfName(','// 서명된 운영 권한');
include('function _substituteGroupsHtml(','function openTeamSubstitutePanel(');
include('function _withFieldMatchTypes(','function render(d)');
assert.match(src,/function render\(d\)\{\s*d=_withFieldMatchTypes\(d\);/);

const member = (n,g,rating) => ({id:n,n,g,skillRating:rating});
const members = {
  blue:[member('청가','F',4), member('청나','F',4), member('대체남','M',4),
    member("테'스트",'F',4.1), member('제외','F',4), member('다른코트','F',4)],
  red:[member('홍가','F',4),member('홍나','F',4),member('홍후보','F',4)]
};
const base = {
  matches:[{num:1,round:1,court:1,type:'여복',t1:['청가','청나'],t2:['홍가','홍나']},
    {num:2,round:1,court:2,t1:['다른코트','추가가'],t2:['추가나','추가다']},
    {num:3,round:2,court:1,voided:true,t1:["테'스트",'대체남'],t2:['홍후보','다른코트']}],
  members,late:{[c._attKey('제외')]:{name:'제외'}}
};
c.window._liveLate=base.late;
const options = c._substituteCandidates(base,base.matches[0],'청가');
const server = suggestSubstitutes(base,1,'청가');
assert.deepEqual(Array.from(options,r=>r.name),server.map(r=>r.name));
assert.deepEqual(Array.from(options,r=>[r.predictedType,r.adjustedGap,r.games]),
  server.map(r=>[r.predictedType,r.adjustedGap,r.games]));
assert.deepEqual(Array.from(options,r=>r.name),["테'스트",'대체남','홍후보']);
const chips = c._substituteGroupsHtml(base,base.matches[0],'청가',options);
assert.equal(chips.match(/data-player=/g).length,3);
assert.match(chips,/여복 유지 · 접전 예상/);
assert.match(chips,/보정 · 접전 예상/);
assert.match(chips,/data-player="테'스트"/);
assert(!chips.includes("'테'스트'"),'이름을 인라인 함수 문자열에 삽입하면 따옴표 문자가 깨진다');

const forced = structuredClone(base);
forced.matches[0].t1[0]='대체남';
assert.equal(c._withFieldMatchTypes(forced).matches[0].type,'보정','로그가 없는 구 버전도 네 선수 성별로 복원');
assert.equal(forced.matches[0].type,'여복','서버 스냅샷은 표시 과정에서 바뀌지 않는다');
forced.members.blue.find(p=>p.n==='대체남').g='';
assert.equal(c._withFieldMatchTypes(forced).matches[0].type,'여복','교체 정보도 성별도 없는 옛 기록 보존');
forced.substitutions=[{matchNum:1}];
assert.equal(c._withFieldMatchTypes(forced).matches[0].type,'종목 미확인');
const incomplete = structuredClone(base);
delete incomplete.members.blue[3].skillRating;
const unknown = c._substituteCandidates(incomplete,incomplete.matches[0],'청가').find(p=>p.name==="테'스트");
const missing = c._substituteGroupsHtml(incomplete,incomplete.matches[0],'청가',[unknown]);
assert.match(missing,/여복 유지 · 전력 미확인/);
assert(!missing.includes('접전 예상')&&!missing.includes('교체팀 균형'));

console.log('PASS 현장 추천·서버 순서/배정 수 일치, 전체 선택·표시 이유·특수문자 이름·기존 경기 종목 보존과 복원');

include('function _officialQualityHtml(','/* 지금 메워야 하는 자리');
Object.assign(c,{_canFixResult:()=>true,_liveTimeLeft:()=>null,_officialQualityOpen:false});
const publishedQuality={...base,bracketKey:'saved-1',quality:{decisionVersion:1,decisionPhase:'draft',
  bracketKey:'saved-1',voidedGames:'3',score:65,scoreVersion:10,grade:'D',gradeLabel:'개선 권장',
  opTitle:'현재 대진으로 진행 권장',opSub:'같은 조건의 후보 4개 중 1위',opClass:'ok'}};
const decision = c._officialQualityHtml(publishedQuality);
assert(decision.indexOf('현재 대진으로 진행 권장') >= 0);
assert(decision.indexOf('현재 대진으로 진행 권장') < decision.indexOf('합산 품질점수'));
assert(!decision.includes('개선 권장'));
for(const changed of [{bracketKey:'changed'},{fieldTypeCorrected:true}]){
  const obsolete = c._officialQualityHtml({...publishedQuality,...changed});
  assert(!obsolete.includes('현재 대진으로 진행 권장') && !obsolete.includes('합산 품질점수'));
}
const inProgress = c._officialQualityHtml({...publishedQuality,matchStartedAt:1234});
assert(!inProgress.includes('현재 대진으로 진행 권장') && inProgress.includes('합산 품질점수'));
const missingComparison = c._officialQualityHtml({...publishedQuality,quality:{...publishedQuality.quality,
  opTitle:'현재 조건의 후보 비교 필요',opSub:'새 대진 생성을 눌러 주세요'}});
assert(missingComparison.includes('현재 대진의 비교 기록 없음') && !missingComparison.includes('새 대진 생성을 눌러'));
console.log('PASS 품질 안내 순서, 게시 직전 판단 보존, 오래된 선수·종목·진행 단계 권고 숨김');
