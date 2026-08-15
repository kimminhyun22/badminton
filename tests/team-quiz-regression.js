'use strict';
/**
 * 예측 설문 (예측왕 퀴즈) — 급수 영점 조정의 수집 경로 (2026-08-14 운영자).
 *
 *   "각 클럽의 고수에게 이런 설문을 진행해서 영점을 맞추면 보다 박빙의 게임을
 *    설계할 수 있지 않을까"  /  "관리자 페이지에서 카톡 링크 형식으로 보내고
 *    정보를 수집하는 형태"
 *
 * 여기서 고정하는 것:
 *   1) 설문 payload 에는 **이름만** — 급수·합계·실효 숫자가 실리면 응답이
 *      급수를 되읽는다(앵커링). 어제 실측: 운영자도 우세 6경기를 6개 전부
 *      급수대로 찍었다.
 *   2) 집계는 **기대 점수** — 픽 개수 집계는 박빙 10개를 통승 10개로 부풀린다
 *      (청 5:20 오판의 원인). 낙승 .9 / 승 .675 / 박빙 .5 로 환산해 평균.
 *   3) 응답 페이지: 본인 경기 자동 제외 · 문항 순서는 이름 씨앗으로 결정적 셔플.
 *   4) 진입점은 공유 메뉴 하나 (데스크탑 드롭다운 + 모바일 바텀시트).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const quizHtml = fs.readFileSync(path.join(root, 'quiz.html'), 'utf8');

function cut(src, a, b, label){
  const i = src.indexOf(a);
  assert(i >= 0, `${label}: 시작 표지를 못 찾음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  assert(j > i, `${label}: 끝 표지를 못 찾음: ${b}`);
  return src.slice(i, j);
}

// 1) payload 에는 이름만 — 급수가 새면 앵커링 차단이 무너진다.
{
  const sandbox = {console, Object, Number, String, Array, JSON, Math, Date};
  vm.createContext(sandbox);
  const P = (name, team, level) => ({name, team, level, gender: 'M'});
  vm.runInContext(`
function _teamLiveSignature(){ return 'sig-test'; }
${cut(teamSrc, 'function _teamMatchIsBlueFirst(m)', '\nfunction ', 'team.js')}
let currentMatches=[];
let currentParticipants=[];
${cut(teamSrc, 'function _teamQuizSystemExpectation(matches)', '\nfunction _teamQuizCompare', 'team.js')}
${cut(teamSrc, 'function _teamQuizPayload()', '\nfunction _teamQuizUrl', 'team.js')}
this.api={_teamQuizPayload, set(m,p){currentMatches=m;currentParticipants=p;}};
`, sandbox);
  const api = sandbox.api;
  api.set([
    {matchNumber: 1, round: 1, court: 2, type: '남복', levelDiff: 1, team1Level: 8, team2Level: 7,
     team1A: P('청A', '청팀', 4), team1B: P('청B', '청팀', 4),
     team2C: P('홍C', '홍팀', 4), team2D: P('홍D', '홍팀', 3)},
    // team1 이 홍팀인 낡은 배열도 청이 t1 으로 정렬되어야 한다
    {matchNumber: 2, round: 1, court: 3, type: '혼복', levelDiff: 0, team1Level: 7, team2Level: 7,
     team1A: P('홍E', '홍팀', 4), team1B: P('홍F', '홍팀', 3),
     team2C: P('청G', '청팀', 4), team2D: P('청H', '청팀', 3)}
  ], [P('청A', '청팀', 4), P('홍C', '홍팀', 4)]);
  const payload = api._teamQuizPayload();
  assert.strictEqual(payload.kind, 'expertQuiz');
  payload.matches.forEach(m => {
    assert.deepEqual(Object.keys(m).sort(), ['court', 'num', 'round', 't1', 't2', 'type'],
      `payload 경기에 허용된 칸만 있어야 합니다: ${Object.keys(m)}`);
  });
  assert(!/level|Level|effLevel|급수/.test(JSON.stringify(payload)),
    'payload 어디에도 급수·레벨 숫자가 실리면 안 됩니다.');
  assert.deepEqual(payload.matches[0].t1, ['청A', '청B'], 't1 은 청팀이어야 합니다.');
  assert.deepEqual(payload.matches[1].t1, ['청G', '청H'],
    'team1 이 홍팀인 데이터도 청이 t1 으로 정렬되어야 합니다.');
  assert.deepEqual(payload.players, ['청A', '홍C'], '참가자 이름 목록이 실려야 합니다.');
  console.log('  payload: 이름만 · 청=t1 정렬 · 급수 미노출');
}

// 2) 집계는 기대 점수 — 낙승 .9 / 승 .675 / 박빙 .5, 응답 없는 경기는 반반.
//    그리고 시스템 기대와 **즉석 비교** (운영자 2026-08-15 "매번 바로 비교").
{
  const sandbox = {console, Object, Number, String, Array, JSON, Math, Set};
  vm.createContext(sandbox);
  vm.runInContext(`
${cut(teamSrc, 'function _teamMatchIsBlueFirst(m)', '\nfunction ', 'team.js')}
${cut(teamSrc, 'function _teamQuizConsensus(responses,matches)', '\nfunction _teamQuizPanel', 'team.js')}
this.api={_teamQuizConsensus,_teamQuizSystemExpectation,_teamQuizCompare};
`, sandbox);
  const P = (name, team) => ({name, team, gender: 'M'});
  const M = (num, s1, s2, blueFirst) => ({matchNumber: num,
    team1Level: s1, team2Level: s2,
    team1A: P(blueFirst ? '청' + num + 'a' : '홍' + num + 'a', blueFirst ? '청팀' : '홍팀'),
    team1B: P(blueFirst ? '청' + num + 'b' : '홍' + num + 'b', blueFirst ? '청팀' : '홍팀'),
    team2C: P(blueFirst ? '홍' + num + 'c' : '청' + num + 'c', blueFirst ? '홍팀' : '청팀'),
    team2D: P(blueFirst ? '홍' + num + 'd' : '청' + num + 'd', blueFirst ? '홍팀' : '청팀')});
  const matches = [M(1, 8, 8, true), M(2, 9, 8, true), M(3, 8, 10, true)];
  const responses = {
    r1: {n: '고수1', a: {1: 1, 2: 3}},        // 1번 청낙승, 2번 박빙
    r2: {n: '고수2', a: {1: 4}}                // 1번 홍
  };
  const c = sandbox.api._teamQuizConsensus(responses, matches);
  // 1번: (0.9+0.325)/2 = 0.6125, 2번: 0.5, 3번(무응답): 0.5 → 청 1.6125 ≈ 1.6
  assert.strictEqual(c.blue, 1.6, `기대 점수 환산이 틀렸습니다: ${c.blue}`);
  assert.strictEqual(c.red, 1.4);
  assert.deepEqual(c.split, [1], '청·홍으로 갈린 경기는 1번뿐입니다(박빙은 갈림이 아님).');

  // 시스템 기대: 백중 .5 · 우세 .75 · 큰 우세 .9 (방향 포함)
  const sys = sandbox.api._teamQuizSystemExpectation(matches);
  assert.strictEqual(sys.probs[1], 0.5, '합 차 0은 백중 = 0.5');
  assert.strictEqual(sys.probs[2], 0.75, '합 차 +1은 청 우세 = 0.75');
  assert.strictEqual(sys.probs[3], 0.1, '합 차 −2는 홍 큰 우세 = 청 0.1');
  const swapped = sandbox.api._teamQuizSystemExpectation([M(4, 9, 8, false)]);
  assert.strictEqual(swapped.probs[4], 0.25, 'team1 이 홍팀이면 방향을 뒤집어야 합니다.');

  // 정합 판정: 시스템 백중(1번, 0.5)인데 고수 낙승이면… 여기선 0.6125 라 불일치 아님.
  // 3번은 시스템 0.1 인데 응답 없음 → 판정 대상 아님. 강한 불일치를 하나 만들어 확인:
  const strong = {r1: {n: '고수1', a: {1: 1}}};   // 1번(백중)을 청낙승 0.9 로
  const cmp = sandbox.api._teamQuizCompare(strong, matches);
  assert.strictEqual(cmp.flags.length, 1, `백중 vs 낙승은 강한 불일치입니다: ${JSON.stringify(cmp.flags)}`);
  assert.strictEqual(cmp.flags[0].num, 1);
  assert(cmp.flags[0].names.includes('청1a'), '재검토 후보로 그 경기 선수들이 지목돼야 합니다.');
  assert(typeof cmp.gap === 'number' && typeof cmp.ok === 'boolean', '총점 오차와 성공 판정이 나와야 합니다.');
  console.log('  집계: 기대 점수 · 시스템 비교 · 강한 불일치 지목');
}

// 3) 응답 페이지 — 자기 경기 제외 · 이름 씨앗 셔플 · 숫자 미노출.
{
  // 값이 샐 수 있는 통로(레벨 식별자)를 막는다 — payload 쪽은 1)에서 검사.
  assert(!/effLevel|levelDiff|team1Level|team2Level/.test(quizHtml),
    'quiz.html 은 급수·레벨 값을 다루는 코드가 없어야 합니다.');
  assert(/낙승.*8점차/.test(quizHtml.replace(/\n/g, '')), '낙승 정의(8점차)가 안내에 있어야 합니다.');
  assert(quizHtml.includes('js/storage.js'), '공용 Firebase 초기화(storage.js)를 써야 합니다.');
  assert(quizHtml.includes('/responses/'), '응답은 <설문>/responses/ 아래에 저장돼야 합니다.');
  // 보안 규칙(database.rules.json)은 live/ 아래 세션형 키만 허용한다 — 규칙 배포 없이
  // 동작하려면 설문도 그 관문을 지나야 하고, 새 최상위(quiz/)는 쓰면 안 된다.
  assert(!/ref\('quiz\//.test(quizHtml) && !teamSrc.includes("ref('quiz/"),
    '규칙에 없는 quiz/ 최상위 경로를 쓰면 안 됩니다(규칙 임의 배포 금지).');
  assert(quizHtml.includes("ref('live/'+QID)"), '설문은 live/<세션형 ID> 에서 읽어야 합니다.');
  assert(quizHtml.includes("kind!=='expertQuiz'"),
    '실경기 세션 ID 를 설문으로 열면 거부해야 합니다(네임스페이스 공유의 안전장치).');
  // 제출 후 결과 대조 (운영자 2026-08-15 "결과가 없으니까 재미가 없고 확인도 안 돼"):
  // 시스템 기대는 payload 에 실리되, 제출 전에는 절대 렌더되지 않아야 한다.
  assert(teamSrc.includes('sys:_teamQuizSystemExpectation(currentMatches).probs'),
    'payload 에 시스템 기대(확률 버킷)가 실려야 제출 후 대조가 됩니다.');
  assert(quizHtml.includes('function renderReveal()') && quizHtml.includes('갈림 '),
    '제출 후 시스템과의 대조(일치/갈림)를 보여줘야 합니다.');
  assert(quizHtml.includes("classList.add('locked')") && quizHtml.includes('결과를 본 뒤에는'),
    '결과를 본 뒤에는 수정이 잠겨야 합니다 — 보고 고치면 측정이 오염됩니다.');
  const beforeSubmit = quizHtml.slice(0, quizHtml.indexOf('function renderReveal'));
  assert(!beforeSubmit.includes('QUIZ.sys['),
    '시스템 기대는 결과 화면 밖(제출 전 렌더 경로)에서 읽으면 안 됩니다.');
  assert(teamSrc.includes('qid=_genLiveId()'),
    '설문 ID 는 규칙이 허용하는 6자리 세션형 생성기를 써야 합니다.');

  const sandbox = {console, Object, Number, String, Array, JSON, Math, Set};
  vm.createContext(sandbox);
  vm.runInContext(`
${cut(quizHtml, 'function quizSeededOrder(name,count)', '\nfunction quizOwnMatches', 'quiz.html')}
${cut(quizHtml, 'function quizOwnMatches(name,matches)', '\nconst $', 'quiz.html')}
this.api={quizSeededOrder,quizOwnMatches};
`, sandbox);
  const api = sandbox.api;
  const o1 = api.quizSeededOrder('김민현', 25);
  const o2 = api.quizSeededOrder('김민현', 25);
  const o3 = api.quizSeededOrder('김동균', 25);
  assert.deepEqual(o1, o2, '같은 이름은 같은 순서여야 합니다(새로고침에도 안정).');
  assert(JSON.stringify(o1) !== JSON.stringify(o3), '다른 이름은 다른 순서여야 합니다.');
  assert.deepEqual([...o1].sort((a, b) => a - b), Array.from({length: 25}, (_, i) => i),
    '셔플은 전 문항을 정확히 한 번씩 포함해야 합니다.');
  const matches = [
    {num: 1, t1: ['김민현', 'A'], t2: ['B', 'C']},
    {num: 2, t1: ['D', 'E'], t2: ['F', '김민현']},
    {num: 3, t1: ['D', 'E'], t2: ['F', 'G']}
  ];
  assert.deepEqual([...api.quizOwnMatches('김민현', matches)].sort(), [1, 2],
    '본인이 낀 경기는 어느 편이든 제외돼야 합니다.');
  assert.strictEqual(api.quizOwnMatches('없는사람', matches).size, 0);
  console.log('  응답 페이지: 결정적 셔플 · 자기 경기 제외 · 숫자 미노출');
}

// 4) 진입점 — 공유 메뉴 두 UI(드롭다운·바텀시트) 모두에서 열리고, 집계 패널이 있다.
{
  const menuCount = (teamHtml.match(/teamQuizShare\(\)/g) || []).length;
  assert.strictEqual(menuCount, 2,
    `설문 버튼은 데스크탑 드롭다운과 모바일 바텀시트 두 곳이어야 합니다: ${menuCount}곳`);
  assert(teamHtml.includes('id="quizPanel"'), '응답 집계 패널 자리가 있어야 합니다.');
  assert(teamSrc.includes('_teamQuizAutoWatch();'),
    '대진을 다시 그릴 때 저장된 설문을 자동으로 감시해야 합니다(새로고침 생존).');
  assert(teamSrc.includes('대진이 바뀌어 마감됐습니다'),
    '대진 재생성으로 설문이 낡으면 조용히 숨기지 말고 안내해야 합니다(2026-08-14 운영자).');
  // 낡은 설문의 응답은 버리지 않는다 — 설문의 산출물은 대진이 아니라 선수 보정이다
  // (운영자: "해당 경기가 아니더라도 … 드랍할 일은 아니라는 말이야").
  assert(teamSrc.includes('영점 조정 데이터로 남습니다'),
    '안내문이 응답 보존을 말해야 합니다.');
  assert(teamSrc.includes("TEAM_QUIZ_HISTORY_KEY='badminton_team_quizHistory'")
    && teamSrc.includes('_teamQuizRemember(qid,sig)'),
    '설문 ID 이력을 보존해야 서버의 응답을 나중에 δ 재료로 되찾을 수 있습니다.');
  assert(quizHtml.includes('og:title'), '카톡 미리보기 제목이 있어야 합니다 — 대진 내용은 싣지 않습니다.');
  console.log('  진입점: 공유 메뉴 2곳 · 집계 패널 · 자동 감시 · 카톡 미리보기');
}

console.log('\nteam quiz regression ok');
