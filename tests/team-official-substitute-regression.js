'use strict';
/**
 * 팀전 임원 운영 — 대체 투입 (운영자 2026-08-13).
 *
 *   "현실에서는 팀전에서도 갑작스런 불참 및 인원 변경이 발생해… 땜방으로
 *    진행하는 수밖에 없어서 계획대로만 되지는 않거든"
 *   "임원이 현장에서 즉흥적으로 변동상황에 대응할 수 있도록 서포트"
 *   원칙: 같은 팀·다른 팀 모두 허용하되 팀을 넘을 때 경고(운영자 확정).
 *
 * 여기서 지키는 것:
 *   1) 임원이 대체를 넣으면 대진에 반영된다 (관리자 앱 없이 서버가 판정)
 *   2) 한 사람이 같은 라운드 두 경기에 서지 않는다
 *   3) 이미 시작·종료된 경기는 함부로 못 바꾼다
 *   4) 팀을 넘는 투입은 확인 없이는 거절한다
 *   5) AI 후보는 같은 팀 → 급수 근접 → 덜 뛴 순으로 제안한다
 */
const assert = require('assert');
const {
  applyTeamOfficialRequest,
  suggestSubstitutes,
  conflictingMatch,
  teamOf
} = require('../functions/team-official-engine');

const NOW = 1_830_000_000_000;

function member(name, team, level, grade){
  return {memberId:'m_'+name, name, level, grade, team};
}
function makeSession(){
  const blue = [
    member('청하나','blue',5,'B'), member('청두리','blue',4,'C'),
    member('청세모','blue',4,'C'), member('청네모','blue',3,'D'),
    member('청다섯','blue',5,'B'), member('청여섯','blue',3,'D')
  ];
  const red = [
    member('홍하나','red',5,'B'), member('홍두리','red',4,'C'),
    member('홍세모','red',4,'C'), member('홍네모','red',3,'D'),
    member('홍다섯','red',5,'B'), member('홍여섯','red',3,'D')
  ];
  return {
    liveId:'TEAMSUB', isTeam:true, teamBlue:'청 팀', teamWhite:'홍 팀',
    members:{blue, red, all:[...blue, ...red]},
    officials:{
      clubOfficials:[{memberId:'m_청하나', name:'청하나'}],
      temporaryOperators:[]
    },
    matches:[
      {round:1, court:1, num:1, type:'남복', t1:['청하나','청두리'], t2:['홍하나','홍두리'],
       t1g:['B','C'], t2g:['B','C'], win:null, winAt:null},
      {round:1, court:2, num:2, type:'남복', t1:['청세모','청네모'], t2:['홍세모','홍네모'],
       t1g:['C','D'], t2g:['C','D'], win:null, winAt:null},
      {round:2, court:1, num:3, type:'남복', t1:['청다섯','청여섯'], t2:['홍다섯','홍여섯'],
       t1g:['B','D'], t2g:['B','D'], win:null, winAt:null}
    ],
    substitutions:[],
    updatedAt:NOW
  };
}
function send(session, request, opts){
  return applyTeamOfficialRequest(session, {
    actorPlayerName:'청하나', createdAt:NOW, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, ...(opts||{})});
}

// 1) 같은 팀 대체 — 불참자를 같은 팀 사람으로 메웁니다(가장 흔한 땜방).
{
  const r = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯'});
  assert.strictEqual(r.status, 'applied', `같은 팀 대체가 적용되어야 합니다: ${r.reason||''}`);
  const m = r.session.matches.find(x=>x.num===1);
  assert.deepStrictEqual(m.t1, ['청하나','청다섯'], '빠진 자리에 대체 선수가 들어가야 합니다.');
  assert.deepStrictEqual(m.t1g, ['B','B'], '급수 표시도 함께 바뀌어야 합니다.');
  assert.strictEqual(r.result.substitute.crossTeam, false, '같은 팀이면 경고가 없어야 합니다.');
  assert.strictEqual(r.session.substitutions.length, 1, '교체 기록이 남아야 합니다.');
  assert.strictEqual(r.session.substitutions[0].by, '청하나', '누가 바꿨는지 남아야 합니다.');
  console.log('  같은 팀 대체: applied · 급수 동기화 · 기록 남김');
}

// 2) 팀을 넘는 대체 — 확인 없이는 거절, 확인하면 허용하고 경고를 돌려줍니다.
{
  const blocked = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'홍다섯'});
  assert.strictEqual(blocked.status, 'rejected', '팀을 넘는 투입은 확인 없이 막아야 합니다.');
  assert(/상대 팀/.test(blocked.reason), `이유가 팀을 넘는다는 것이어야 합니다: ${blocked.reason}`);

  const allowed = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'홍다섯', allowCrossTeam:true});
  assert.strictEqual(allowed.status, 'applied', `확인하면 넣을 수 있어야 합니다: ${allowed.reason||''}`);
  assert.strictEqual(allowed.result.substitute.crossTeam, true, '팀을 넘었다는 경고가 결과에 실려야 합니다.');
  assert.strictEqual(allowed.session.substitutions[0].crossTeam, true, '기록에도 남아야 합니다.');
  console.log(`  팀 넘는 대체: 확인 없으면 rejected (${blocked.reason}) · 확인하면 applied + 경고`);
}

// 3) 같은 라운드 이중 출전 금지 — 땜방이 새 사고를 만들면 안 됩니다.
{
  const r = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청세모'});
  assert.strictEqual(r.status, 'rejected', '같은 라운드 다른 경기 선수는 거절해야 합니다.');
  assert(/이미 들어가 있습니다/.test(r.reason), `이유가 분명해야 합니다: ${r.reason}`);
  // 다음 라운드 선수는 괜찮습니다.
  const ok = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯'});
  assert.strictEqual(ok.status, 'applied', '다른 라운드 선수는 넣을 수 있어야 합니다.');
  console.log(`  이중 출전: rejected (${r.reason})`);
}

// 4) 이미 시작·종료된 경기 보호
{
  const decided = makeSession();
  decided.matches[0].win = 'blue';
  const r1 = send(decided, {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯'});
  assert.strictEqual(r1.status, 'rejected', '결과가 입력된 경기는 바꾸면 안 됩니다.');

  const started = makeSession();
  started.matches[0].startAt = NOW - 60_000;
  const r2 = send(started, {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯'});
  assert.strictEqual(r2.status, 'rejected', '이미 시작한 경기는 한 번 더 확인해야 합니다.');
  const r3 = send(started, {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯', allowStarted:true});
  assert.strictEqual(r3.status, 'applied', '확인하면 진행 중 경기도 바꿀 수 있어야 합니다.');
  console.log(`  경기 보호: 결과 입력 rejected · 시작 경기는 확인 필요 → applied`);
}

// 5) 지문 — 그 사이 대진이 바뀌었으면 되돌립니다.
{
  const r = send(makeSession(), {type:'team-official-substitute',
    matchNum:1, outName:'청두리', inName:'청다섯',
    expectedT1:['청하나','딴사람']});
  assert.strictEqual(r.status, 'rejected', '지문이 어긋나면 거절해야 합니다.');
  console.log(`  지문 검증: rejected (${r.reason})`);
}

// 6) 권한 — 임원만. 일반 회원 이름으로는 안 됩니다.
{
  const r = applyTeamOfficialRequest(makeSession(), {type:'team-official-substitute',
    actorPlayerName:'청네모', matchNum:1, outName:'청두리', inName:'청다섯'}, {now:NOW});
  assert.strictEqual(r.status, 'rejected', '일반 회원은 대체를 넣을 수 없어야 합니다.');
  const admin = applyTeamOfficialRequest(makeSession(), {type:'team-official-substitute',
    actorPlayerName:'', matchNum:1, outName:'청두리', inName:'청다섯'}, {now:NOW, adminClaim:true});
  assert.strictEqual(admin.status, 'applied', '관리자 연결은 그대로 통과해야 합니다.');
  console.log('  권한: 일반 회원 rejected · 임원/관리자 applied');
}

// 7) AI 보조 — 후보 순서(같은 팀 → 급수 근접 → 덜 뛴 순)
{
  const list = suggestSubstitutes(makeSession(), 1, '청두리');
  assert(list.length > 0, '후보가 나와야 합니다.');
  assert.strictEqual(list[0].crossTeam, false, '같은 팀 후보가 먼저 나와야 합니다.');
  assert.strictEqual(teamOf(makeSession(), list[0].name), 'blue', '같은 팀이어야 합니다.');
  // 같은 라운드에 잡힌 사람은 후보에서 빠집니다.
  assert(!list.some(c => c.name === '청세모'), '같은 라운드 출전 선수는 후보에서 빠져야 합니다.');
  // 급수가 가까운 사람이 앞에 옵니다(청두리 level 4 → 청다섯 5 vs 청여섯 3, 둘 다 gap 1이면 덜 뛴 순)
  const blueFirst = list.filter(c => !c.crossTeam).map(c => c.name);
  assert(blueFirst.length >= 2, '같은 팀 후보가 둘 이상이어야 합니다.');
  const cross = list.filter(c => c.crossTeam);
  if(cross.length){
    assert(list.indexOf(cross[0]) > list.indexOf(list.filter(c=>!c.crossTeam).pop()),
      '다른 팀 후보는 같은 팀 후보 뒤에 와야 합니다.');
  }
  console.log(`  AI 후보: ${list.slice(0,4).map(c=>`${c.name}${c.crossTeam?'(상대팀)':''}`).join(' · ')}`);
}

// 8) 같은 라운드 이중 출전 — **끝난 경기도 셉니다** (운영자 2026-08-14
//    "교체 인원은 해당 라운드에 뛰는 선수는 아니겠지?" · "다음 대진선수 교체도 마찬가지").
//    예전에는 결과가 입력된 경기를 건너뛰어, 방금 뛰고 나온 사람이 후보로 떴습니다.
{
  const s = makeSession();
  s.matches[1].win = 't1';           // 2번(1라운드 2코트) 종료 — 청세모·청네모가 뛰었음
  assert(conflictingMatch(s, '청세모', 1, 1),
    '같은 라운드에서 이미 뛴 사람은 충돌로 잡혀야 합니다.');
  const names = suggestSubstitutes(s, 1, '청두리').map(c => c.name);
  assert(!names.includes('청세모'),
    `끝난 경기라도 같은 라운드면 후보가 아닙니다: ${names.join(', ')}`);

  const blocked = send(s, {type:'team-official-substitute', matchNum:1,
    outName:'청두리', inName:'청세모'});
  assert.strictEqual(blocked.status, 'rejected', '서버도 막아야 합니다.');
  assert(/같은 라운드/.test(blocked.reason), `이유가 분명해야 합니다: ${blocked.reason}`);

  // 다른 라운드(2라운드) 경기에는 넣을 수 있어야 합니다 — 그 라운드에는 안 뛰니까.
  const ok = send(s, {type:'team-official-substitute', matchNum:3,
    outName:'청다섯', inName:'청세모'});
  assert.strictEqual(ok.status, 'applied',
    `다른 라운드에는 넣을 수 있어야 합니다: ${ok.reason}`);
  console.log('  같은 라운드 이중 출전: 진행 중·종료 모두 차단 · 다른 라운드는 허용');
}

console.log('\nteam official substitute regression ok');
