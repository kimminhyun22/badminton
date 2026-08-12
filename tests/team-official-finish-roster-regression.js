'use strict';
/**
 * 팀전 임원 운영 — 마무리 · 명단 고치기 · 운영 기록 (운영자 2026-08-12).
 *
 *   "임원 운영 철학에 따라 더 추가해야 할 기능이 있는지도 점검"
 *   → 관리자를 불러야만 되던 세 가지를 임원 손으로 옮깁니다.
 *
 * 여기서 지키는 것:
 *   1) 임원이 팀전을 마무리해도 **데이터를 지우지 않는다** (관리자 「팀전 종료」와 다름)
 *   2) 결과가 없는 경기가 남았으면 확인 없이는 마무리하지 않는다
 *   3) 명단에 넣고 뺄 수 있다 — 단, 남은 경기에 이름이 있으면 대체 투입이 먼저다
 *   4) 관리자 앱이 임원의 명단 수정을 **따라온다** (안 그러면 다음 게시에 지워진다)
 *   5) 조작 기록이 화면에 보인다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {applyTeamOfficialRequest} = require('../functions/team-official-engine');

const NOW = 1_830_000_000_000;
const member = (name, team, level, grade) => ({memberId:'m_'+name, name, level, grade, team});

function makeSession(){
  const blue = [member('청하나','blue',5,'B'), member('청두리','blue',4,'C'),
                member('청세모','blue',4,'C'), member('청벤치','blue',3,'D')];
  const red  = [member('홍하나','red',5,'B'), member('홍두리','red',4,'C'),
                member('홍세모','red',4,'C'), member('홍벤치','red',3,'D')];
  return {
    liveId:'TEAMFIN', isTeam:true, teamBlue:'청 팀', teamWhite:'홍 팀',
    members:{blue, red, all:[...blue, ...red]},
    officials:{clubOfficials:[{memberId:'m_청하나', name:'청하나'}], temporaryOperators:[]},
    matches:[
      {round:1, court:1, num:1, type:'남복', t1:['청하나','청두리'], t2:['홍하나','홍두리'],
       t1g:['B','C'], t2g:['B','C'], win:null, winAt:null},
      {round:1, court:2, num:2, type:'남복', t1:['청세모','청벤치'], t2:['홍세모','홍벤치'],
       t1g:['C','D'], t2g:['C','D'], win:null, winAt:null}
    ],
    substitutions:[], updatedAt:NOW
  };
}
function send(session, request, opts){
  return applyTeamOfficialRequest(session, {
    actorPlayerName:'청하나', createdAt:NOW, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, ...(opts||{})});
}
function settleAll(session){
  let s = session;
  s = send(s, {type:'team-official-result', matchNum:1, win:'t1'}).session;
  s = send(s, {type:'team-official-result', matchNum:2, win:'t2'}).session;
  return s;
}

// ── 1) 마무리 ─────────────────────────────────────────────────────────────
{
  const half = send(makeSession(), {type:'team-official-result', matchNum:1, win:'t1'}).session;
  const blocked = send(half, {type:'team-official-finish', finished:true});
  assert.strictEqual(blocked.status, 'rejected', '결과가 남았는데 그냥 마무리하면 안 됩니다.');
  assert(/결과가 없는 경기가 1개/.test(blocked.reason), `남은 경기 수를 알려야 합니다: ${blocked.reason}`);

  const forced = send(half, {type:'team-official-finish', finished:true, allowUnfinished:true});
  assert.strictEqual(forced.status, 'applied', `확인하면 마무리할 수 있어야 합니다: ${forced.reason||''}`);
  assert(Number(forced.session.finishedAt) > 0, '마무리 시각이 남아야 합니다.');
  assert.strictEqual(forced.session.finishedBy, '청하나', '누가 마무리했는지 남아야 합니다.');
  // 관리자 「팀전 종료」와 결정적으로 다른 점 — 결과가 그대로 남습니다.
  assert.strictEqual(forced.session.matches.length, 2, '마무리는 경기 기록을 지우지 않아야 합니다.');
  assert.strictEqual(forced.session.members.blue.length, 4, '마무리는 명단을 지우지 않아야 합니다.');

  const again = send(forced.session, {type:'team-official-finish', finished:true, allowUnfinished:true});
  assert.strictEqual(again.status, 'rejected', '두 번 마무리할 수는 없습니다.');

  const undone = send(forced.session, {type:'team-official-undo'});
  assert.strictEqual(undone.status, 'applied', `마무리도 되돌릴 수 있어야 합니다: ${undone.reason||''}`);
  assert(!undone.session.finishedAt, '되돌리면 마무리 표시가 지워져야 합니다.');

  const clean = send(settleAll(makeSession()), {type:'team-official-finish', finished:true});
  assert.strictEqual(clean.status, 'applied', '경기가 다 끝났으면 확인 없이 마무리됩니다.');
  console.log('  마무리: 남은 경기 확인 · 데이터 보존 · 되돌리기');
}

// ── 2) 명단 추가 ──────────────────────────────────────────────────────────
{
  const added = send(makeSession(), {type:'team-official-roster', action:'add',
    playerName:'늦은손님', team:'red', level:4, grade:'C'});
  assert.strictEqual(added.status, 'applied', `명단에 넣을 수 있어야 합니다: ${added.reason||''}`);
  const row = added.session.members.red.find(m => (m.n||m.name) === '늦은손님');
  assert(row, '홍팀 명단에 들어가야 합니다.');
  assert.strictEqual(row.l, 4, '급수가 실려야 대체 후보 계산이 됩니다.');
  assert.strictEqual(row.gr, 'C', '등급도 실려야 합니다.');

  // 관리자 앱이 따라올 수 있도록 순서대로 적힙니다.
  assert.strictEqual(added.session.rosterEdits.length, 1, '명단 수정이 기록되어야 합니다.');
  assert.strictEqual(added.session.rosterEdits[0].action, 'add');
  assert.strictEqual(added.session.rosterEdits[0].team, 'red');

  const dup = send(added.session, {type:'team-official-roster', action:'add', playerName:'늦은손님', team:'blue'});
  assert.strictEqual(dup.status, 'rejected', '같은 이름을 두 번 넣으면 안 됩니다.');

  const undone = send(added.session, {type:'team-official-undo'});
  assert.strictEqual(undone.status, 'applied', `추가도 되돌릴 수 있어야 합니다: ${undone.reason||''}`);
  assert(!undone.session.members.red.some(m => (m.n||m.name) === '늦은손님'),
    '되돌리면 명단에서 빠져야 합니다.');

  // 넣은 사람은 곧바로 대체 투입 후보가 되어야 합니다(넣는 이유가 그것이므로).
  const used = send(added.session, {type:'team-official-substitute',
    matchNum:1, outName:'홍두리', inName:'늦은손님', allowCrossTeam:true});
  assert.strictEqual(used.status, 'applied', `새로 넣은 선수를 바로 투입할 수 있어야 합니다: ${used.reason||''}`);
  console.log('  명단 추가: 급수·등급 반영 · 중복 거절 · 되돌리기 · 즉시 투입');
}

// ── 3) 명단 제외 ──────────────────────────────────────────────────────────
{
  const blocked = send(makeSession(), {type:'team-official-roster', action:'remove', playerName:'청두리'});
  assert.strictEqual(blocked.status, 'rejected', '남은 경기에 있는 사람은 그냥 뺄 수 없습니다.');
  assert(/1번 경기/.test(blocked.reason) && /대체 투입/.test(blocked.reason),
    `어느 경기인지와 다음 할 일을 알려야 합니다: ${blocked.reason}`);

  // 벤치에 앉은 사람은 뺄 수 있습니다.
  const bench = makeSession();
  bench.matches[1].t1 = ['청세모','청하나'];
  const removed = send(bench, {type:'team-official-roster', action:'remove', playerName:'청벤치'});
  assert.strictEqual(removed.status, 'applied', `경기에 없는 사람은 뺄 수 있어야 합니다: ${removed.reason||''}`);
  assert(!removed.session.members.blue.some(m => (m.n||m.name) === '청벤치'), '청팀에서 빠져야 합니다.');
  assert(!removed.session.members.all.some(m => (m.n||m.name) === '청벤치'), '전체 명단에서도 빠져야 합니다.');
  assert.strictEqual(removed.session.rosterEdits[0].action, 'remove');

  const undone = send(removed.session, {type:'team-official-undo'});
  assert.strictEqual(undone.status, 'applied', `제외도 되돌릴 수 있어야 합니다: ${undone.reason||''}`);
  const back = undone.session.members.blue.find(m => (m.n||m.name) === '청벤치');
  assert(back, '되돌리면 명단에 다시 들어와야 합니다.');
  assert.strictEqual(back.l, 3, '급수까지 그대로 돌아와야 합니다.');
  console.log('  명단 제외: 경기 중이면 거절 · 전체 명단 동기 · 급수 보존 되돌리기');
}

// ── 4) 관리자 앱이 명단 수정을 따라온다 ───────────────────────────────────
// 이게 없으면 임원이 넣은 선수가 **다음 게시 한 번에 지워집니다**.
{
  const teamSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');
  const start = teamSrc.indexOf('function _teamAdoptServerRoster');
  assert(start > 0, '관리자 앱에 명단 따라가기 함수가 있어야 합니다.');
  const end = teamSrc.indexOf('/* 받아 적은 뒤', start);
  const sandbox = {console, Number, String, Array, Object};
  vm.createContext(sandbox);
  vm.runInContext(`
    var currentParticipants=[{name:'청하나',level:5,memberId:'m_청하나'},
                             {name:'청벤치',level:3,memberId:'m_청벤치'}];
    var teamAssignment={blue:[currentParticipants[0],currentParticipants[1]],white:[]};
    var teamNames={blue:'청 팀',white:'홍 팀'};
    var currentSettings={teamMode:true};
    function _teamLiveSigName(n){ return String(n||'').replace(/\\s+/g,''); }
    function _teamEnsureMemberId(p){ if(p&&!p.memberId)p.memberId='m_'+p.name; return p?p.memberId:''; }
    ${teamSrc.slice(start, end)}
    this.api={ adopt:_teamAdoptServerRoster,
      names(){ return currentParticipants.map(p=>p.name); },
      blue(){ return teamAssignment.blue.map(p=>p.name); },
      white(){ return teamAssignment.white.map(p=>p.name); } };
  `, sandbox);

  const edits = [
    {at:NOW, action:'add', name:'늦은손님', team:'red', level:4, grade:'C'},
    {at:NOW+1, action:'remove', name:'청벤치', team:'blue', level:3, grade:'D'}
  ];
  const first = sandbox.api.adopt({rosterEdits:edits});
  assert.strictEqual(first.applied, true, '관리자 명단이 서버를 따라가야 합니다.');
  // vm 안에서 만들어진 배열이라 deepStrictEqual 은 realm 이 달라 실패합니다.
  const list = v => Array.from(v).join(',');
  assert.strictEqual(list(first.added), '늦은손님');
  assert.strictEqual(list(first.removed), '청벤치');
  assert.strictEqual(list(sandbox.api.names()), '청하나,늦은손님', '참가자 목록이 맞아야 합니다.');
  assert.strictEqual(list(sandbox.api.blue()), '청하나', '청팀에서 빠져야 합니다.');
  assert.strictEqual(list(sandbox.api.white()), '늦은손님', '홍팀에 들어가야 합니다.');

  // 같은 목록을 다시 읽어도 결과가 같아야 합니다 — 서버는 매번 전체를 보냅니다.
  const second = sandbox.api.adopt({rosterEdits:edits});
  assert.strictEqual(second.applied, false, '이미 반영된 수정을 또 적용하면 안 됩니다.');
  assert.strictEqual(list(sandbox.api.names()), '청하나,늦은손님', '두 번 읽어도 명단은 같아야 합니다.');
  console.log('  관리자 동기화: 추가·제외 반영 · 몇 번 읽어도 같은 결과');
}

// ── 5) 화면 ───────────────────────────────────────────────────────────────
{
  const viewSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'live-view.js'), 'utf8');

  // 마무리는 **끝이 보일 때만**. 못 치른 경기는 「미실시」가 먼저입니다.
  const jump = viewSrc.slice(viewSrc.indexOf('function _officialJumpHtml'),
                             viewSrc.indexOf('function _officialLogTime'));
  assert(jump.includes('matches.every(_settled)') && jump.includes('finishTeamLive()'),
    '경기가 다 끝났을 때 마무리 버튼이 떠야 합니다.');
  assert(jump.includes('_liveFinished(d)') && jump.includes('마무리 해제'),
    '이미 마무리했으면 해제 버튼으로 바뀌어야 합니다.');

  // 마무리를 선언하면 결과 화면으로 넘어갑니다.
  assert(viewSrc.includes('const allDone=matches.length>0 && (_liveFinished(d)'),
    '마무리 선언은 결과 화면으로 이어져야 합니다.');

  // 명단 고치기는 명단을 보는 그 자리에서.
  assert(viewSrc.includes('onclick="addTeamPlayer()"') && viewSrc.includes('＋ 선수 추가'),
    '명단 카드에서 선수를 추가할 수 있어야 합니다.');
  // 2026-08-12 계약 갱신(운영자 "삭제 기능도 필요 없어"): 명단에서 빼는 버튼은
  // 뗐습니다 — 불참이면 어차피 대체 투입을 하므로 명단에서 지워도 달라지는 게
  // 없습니다. 서버 명령은 남겨 둡니다(추가와 같은 명령을 씁니다).
  assert(!viewSrc.includes('onclick="removeTeamPlayer('),
    '명단 제외 버튼이 다시 생기면 안 됩니다.');

  // 조작 기록 — 서버에는 쌓이는데 화면에서 볼 수 없었습니다.
  assert(viewSrc.includes('function _officialLogHtml'), '운영 기록 화면이 있어야 합니다.');
  const log = viewSrc.slice(viewSrc.indexOf('function _officialLogHtml'),
                            viewSrc.indexOf('var _officialLogOpen'));
  assert(log.includes("if(!rows.length)return ''"), '기록이 없으면 아무것도 띄우지 않아야 합니다.');
  assert(log.includes('.reverse()'), '최근 것이 위로 와야 합니다.');
  assert(log.includes('_canFixResult(d)'), '운영 기록은 임원에게만 보여야 합니다.');
  assert(viewSrc.includes('${_officialLogHtml(d)}'), '운영 현황 안에 붙어야 합니다.');

  ['finishTeamLive','addTeamPlayer'].forEach(fn=>{
    assert(viewSrc.includes('window.'+fn+'='+fn), `${fn} 은 onclick 에서 부를 수 있어야 합니다.`);
  });
  console.log('  화면: 마무리 노출 조건 · 명단 고치기 진입점 · 운영 기록');
}

console.log('team-official-finish-roster-regression: OK');
