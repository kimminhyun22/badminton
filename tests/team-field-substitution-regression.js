'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {applyTeamOfficialRequest, suggestSubstitutes, bracketKey, attendanceKey} = require('../functions/team-official-engine');
const field = require('../functions/team-field-substitution');

const root = path.join(__dirname, '..');
const ui = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/match-quality.js'), 'utf8'), ui);
vm.runInNewContext(fs.readFileSync(path.join(root, 'functions/team-field-substitution.js'), 'utf8'), ui);

function player(n, skillRating, g = 'F'){
  return {n, skillRating, g, l:4};
}
function scenario(levels, bench){
  const blue = [player('청앞', levels[0]), player('청뒤', levels[1]), ...bench];
  const red = [player('홍앞', levels[2]), player('홍뒤', levels[3])];
  return {isTeam:true, members:{blue,red}, matches:[
    {round:1, court:1, num:1, type:'여복', t1:['청앞','청뒤'], t2:['홍앞','홍뒤']}
  ]};
}
function lookup(s){
  return name => [...s.members.blue,...s.members.red].find(p => p.n === name);
}
function swap(s, from, to, options = {}){
  const result = applyTeamOfficialRequest(s, {type:'team-official-substitute', matchNum:1,
    outName:from, inName:to, ...options}, {adminClaim:true, now:1000000});
  assert.equal(result.status, 'applied', result.reason);
  return result.session;
}
function undo(s){
  const r = applyTeamOfficialRequest(s, {type:'team-official-undo'}, {adminClaim:true, now:1000100});
  assert.equal(r.status, 'applied', r.reason);
  return r.session;
}
function oldTop(candidates){
  return [...candidates].sort((a,b) => Number(a.crossTeam)-Number(b.crossTeam)
    || Math.abs(a.balance)-Math.abs(b.balance) || Number(a.balance>0)-Number(b.balance>0)
    || a.games-b.games || a.name.localeCompare(b.name,'ko'))[0];
}

// Two eligible substitutes. Within the existing close margin, keep women's doubles.
const allEven = scenario([4,4,4,4], [player('동등남',4,'M'), player('근접여',4.1)]);
const evenCandidates = suggestSubstitutes(allEven, 1, '청앞');
assert.equal(oldTop(evenCandidates).name, '동등남');
assert.deepEqual(evenCandidates.map(c => c.name), ['근접여','동등남']);
assert.equal(evenCandidates[0].close, true);
assert.equal(evenCandidates[0].preservesWomen, true);
assert.equal(evenCandidates[1].predictedType, '보정');
assert.equal(evenCandidates[1].womenLost, true);
assert.equal(swap(allEven,'청앞','근접여').matches[0].type, '여복');
const irregular = swap(allEven,'청앞','동등남');
assert.equal(irregular.matches[0].type, '보정');
assert.equal(irregular.bracketKey, bracketKey(irregular));
const restored = undo(irregular);
assert.deepEqual(restored.matches, allEven.matches);
assert.equal(restored.bracketKey, bracketKey(allEven));

// Equal raw sums previously hid a lopsided pair; honor the original generation policy.
const asymmetric = scenario([2.5,6,4.25,4.25], [player('합계동점',2.5),player('페어접전',3.4)]);
const asymCandidates = suggestSubstitutes(asymmetric, 1, '청앞');
assert.equal(oldTop(asymCandidates).name, '합계동점');
assert.equal(asymCandidates[0].name, '페어접전');
assert.equal(asymCandidates[0].close, true);
assert.equal(asymCandidates[1].close, false);
assert.equal(swap(asymmetric,'청앞','페어접전').substitutions[0].swing, asymCandidates[0].swing);
assert(Math.abs(asymCandidates[0].adjustedGap - 0.01) < 1e-9);
assert(Math.abs(asymCandidates[1].adjustedGap - 1.225) < 1e-9);

// A strongly unequal women's game cannot outrank an equally matched alternative on the same team.
const lopsided = scenario([4,4,4,4], [player('무리여',8),player('동등남',4,'M')]);
const guarded = suggestSubstitutes(lopsided, 1, '청앞');
assert.deepEqual(guarded.map(c => c.name), ['동등남','무리여']);
assert.equal(guarded[1].allowed, false);
assert.equal(swap(lopsided,'청앞','무리여').matches[0].type, '여복');

// A red-side replacement must use that side's signed margin. Compressed and long-form gender work.
const right = scenario([4,4,4,4], []);
right.members.red.push(player('홍후보',4.2,'여'));
const rightCandidate = suggestSubstitutes(right,1,'홍뒤')[0];
assert(rightCandidate.adjustedBalance > 0);
assert.equal(rightCandidate.predictedType, '여복');
const genders = (arr, pairs) => field.matchType({t1:pairs[0],t2:pairs[1]}, n => ({gender:arr[n]}));
assert.equal(genders(['남','F','M','여'],[[0,1],[2,3]]),'혼복');
assert.equal(genders(['남','M','M','남'],[[0,1],[2,3]]),'남복');
assert.equal(genders(['F','F','M','M'],[[0,1],[2,3]]),'보정');
assert.equal(genders(['F',undefined,'F','F'],[[0,1],[2,3]]),'');

// Old snapshots can lack gender and score. Do not claim a discipline or predicted close score.
const legacy = scenario([4,4,4,4], [{n:'옛선수'}]);
delete legacy.members.blue[0].g;
const scored = suggestSubstitutes(legacy,1,'청앞')[0];
assert.equal(scored.ratingsKnown, false);
assert.equal(scored.close,false);
assert.equal(scored.adjustedGap,null);
const unknown = swap(legacy,'청앞','옛선수',{previousType:'남복'});
assert.equal(unknown.matches[0].type, '종목 미확인');
assert.equal(undo(unknown).matches[0].type, '여복');

// Retain all available candidates and never count a voided appearance in the tie-break.
const available = scenario([4,4,4,4], ['가','나','다','마'].map(n=>player(n,4)));
available.members.red.push(player('홍후보',4));
available.matches.push(
  {round:2,court:1,num:2,t1:['가'],t2:[]},
  {round:2,court:2,num:3,t1:['나'],t2:[],voided:true},
  {round:1,court:3,num:4,t1:['다'],t2:[],win:'blue'}
);
available.late = {[attendanceKey('마')]:{name:'마'}};
assert.deepEqual(suggestSubstitutes(available,1,'청앞').map(c => c.name), ['나','가','홍후보']);
assert.equal(suggestSubstitutes(available,1,'청앞',{limit:1})[0].name, '나');
delete available.late;
available.attendanceSeeded = true;
available.attendance = Object.fromEntries(['가','홍후보'].map(n => [attendanceKey(n),true]));
assert.deepEqual(suggestSubstitutes(available,1,'청앞').map(c => c.name), ['가','홍후보']);

// Compare both module entry points against the shipped pair scorer across different ratings.
let checked = 0;
for(const a of [2.5,4,7])for(const b of [2,4,5.5])for(const c of [2,4,6])for(const d of [2.5,4,7]){
  const s = scenario([2,b,c,d], [player('가',a)]);
  const get = lookup(s), candidate = get('가');
  const args = [s.matches[0],'청앞',candidate,get,p=>p.skillRating];
  const assessed = field.assess(...args);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.TeamFieldSubstitution.assess(...args))), assessed);
  const q = ui.KokMatchQuality.pairBalance([candidate,get('청뒤')],[get('홍앞'),get('홍뒤')]);
  assert.equal(assessed.allowed, q.allowed);
  assert.equal(Math.round(assessed.adjustedGap*100)/100, q.adjustedDiff);
  assert.equal(Math.round(assessed.rawGap*100)/100, q.rawDiff);
  checked++;
}
console.log(`field substitution: women's doubles 0→1 with both close, partner-adjusted gap 1.225→0.010, unsafe alternative retained; ${checked} generator/browser/server parity cases, override/undo/unknown/eligibility passed`);
