'use strict';
/** 코트 과가동은 초반이 아니라 피로·반복이 누적된 뒤 한 단계 축소만 제안한다.
 * 훼손 시험: COURT_RECOMMENDATION_SOURCE_ROOT=<사본> node 이 파일 */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=process.env.COURT_RECOMMENDATION_SOURCE_ROOT?path.resolve(process.env.COURT_RECOMMENDATION_SOURCE_ROOT):path.join(__dirname,'..');
const api=require(path.join(root,'js','court-recommendation.js'));
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');

const match=(n,offset=0)=>({team1:[`가${offset+n*4}`,`나${offset+n*4}`],team2:[`다${offset+n*4}`,`라${offset+n*4}`],endAt:n+1});
const early=Array.from({length:6},(_,i)=>match(i));
assert.strictEqual(api.evaluate({courts:3,pool:13,completed:early,active:[{team1:['가20','새1'],team2:['새2','새3']}],now:1}),null,
  '초반 두 회전에는 인원이 빠듯해도 코트 축소를 재촉하면 안 됩니다.');

const mature=Array.from({length:9},(_,i)=>match(i));
let rec=api.evaluate({courts:3,pool:15,completed:mature,active:[{team1:['가32','새1'],team2:['새2','새3']}],now:1});
assert(rec&&rec.target===2&&rec.consecutive===1,'교대 인원이 부족하고 연속 출전이 생기면 3→2코트를 권장해야 합니다.');
assert(rec.desc.includes('교대 3명')&&rec.desc.includes('연속 출전 1명'),'권장 이유를 숫자로 짧게 설명해야 합니다.');

const roomy=Array.from({length:9},(_,i)=>match(i,100));
assert.strictEqual(api.evaluate({courts:3,pool:16,completed:roomy,active:[match(0,500)],now:1}),null,
  '교대 4명이 확보되고 반복도 없으면 코트를 줄이지 않아야 합니다.');

const repeated=Array.from({length:9},()=>({team1:['가','나'],team2:['다','라']}));
rec=api.evaluate({courts:3,pool:15,completed:repeated,active:[{team1:['새1','새2'],team2:['새3','새4']}],now:1});
assert(rec&&rec.partnerRepeats>0&&rec.opponentRepeats>0,'교대가 부족하고 반복이 누적되면 현재 경기가 연속 출전이 아니어도 축소를 권장해야 합니다.');
assert.strictEqual(api.evaluate({courts:2,pool:13,completed:repeated,active:[repeated[0]],now:1}),null,
  '한 코트 줄여 교대 5명이 확보되면 과거 반복 기록 때문에 다시 줄이라고 하면 안 됩니다.');
assert.strictEqual(api.evaluate({courts:1,pool:5,completed:repeated,active:[repeated[0]],now:1}),null,'1코트 아래로 줄이면 안 됩니다.');

assert(daily.includes('onclick="dailyStepCourts(-1)"')&&daily.includes('KokMatchCourtRecommendation'),'관리자 제안은 버튼 한 번으로 한 코트 줄여야 합니다.');
assert(checkin.includes('function officialCourtRecommendation(player)')&&checkin.includes("if(!player?.isClubOfficial"),'정식 임원에게만 코트 권장을 보여야 합니다.');
assert(checkin.includes("sendOfficialSettingsCourts('${esc(player.id)}',-1)"),'임원 제안도 기존 서버 코트 변경 명령을 써야 합니다.');

console.log('court reduction recommendation regression passed');
