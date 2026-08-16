'use strict';
/**
 * 2026-08-16 운영자: "회원 간에 대진 배정 공정성에 대해 의문을 표하는 경우가
 * 있었어. 임원입장에서 현재 인당 평균게임과 해당 회원의 게임수가 얼마나 차이가
 * 나는지 확인할 필요가 있어. 직관적으로 보고 관리할 수 있게" —
 * 임원 화면 공정성 요약 줄을 펼치면 전원 게임 분배 보드가 나온다.
 *
 * 설계 원칙:
 * - 게임수는 회원이 아는 숫자(완료 경기)로 말한다. 진행·대기 배정은 태그.
 * - 판정 칩은 보정 기대치(도착 이후 기준) — 완료 수 격차로 색칠하면
 *   지각자가 온통 빨갛게 떠서 이미 고친 헛경보가 되살아난다.
 * - 전원 표시(휴식·종료 포함), 많이 뛴 쪽도 보인다 — 시비는 양쪽에서 온다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

// ── 소스 구조 검증 ──
assert(src.includes('function officialFairBoardHtml('), '게임 분배 보드 함수가 있어야 합니다.');
assert(src.includes('인당 평균 ${'), '요약 줄에 인당 평균 게임수가 보여야 합니다.');
assert(/status==='rest'\|\|status==='done'/.test(src) && src.includes('운동 종료'),
  '휴식·종료 인원도 보드에 실려야 합니다 — 따지러 온 사람이 쉬는 중일 수 있습니다.');
assert(/r\.gap>=FAIR_PRIORITY_GAP/.test(src),
  '부족 판정은 완료 수 격차가 아니라 보정 기대치 기준이어야 합니다.');
assert(src.includes('늦합류'), '지각자는 완료 수가 적어도 정상으로 설명해야 합니다.');
assert(src.includes('많이 뜀'), '평균보다 많이 뛴 쪽도 보여야 합니다.');
assert(/officialFairBoardHtml[\s\S]{0,3000}openOfficialQueueCompose\('\$\{esc\(actorId\)\}'/.test(src),
  '부족자 줄에서 바로 「대진 짜기」가 열려야 합니다(기존 진입점 재사용).');
assert(src.includes('${officialFairBoardHtml(p.id)}'),
  '보드가 운영 패널의 공정성 자리에 들어가야 합니다.');
assert(!src.includes('<span class="official-fairness'),
  '옛 공정성 스팬이 남아 있으면 같은 사실이 두 곳에 뜹니다.');
assert(src.includes('officialFairBoardHtml._open'), '펼친 상태가 재렌더에도 유지돼야 합니다.');

// ── 기능 검증: 실제 함수를 잘라내 fixture 세션으로 렌더 ──
function cut(begin, end){
  const a = src.indexOf(begin);
  assert(a >= 0, `소스에서 ${begin.slice(0, 40)} 를 찾지 못했습니다.`);
  const b = src.indexOf(end, a);
  assert(b > a, `소스에서 ${end.slice(0, 40)} 를 찾지 못했습니다.`);
  return src.slice(a, b);
}
const code = [
  "const FAIR_PRIORITY_GAP=.75;",
  cut('function currentMatchForPlayer(', 'const FAIR_PRIORITY_GAP'),
  cut('function playerFairnessInfo(', '/* 게임 분배 보드'),
  cut('function officialFairBoardHtml(', '/* 완료 경기 수와 지난 대진'),
].join('\n');

const ctx = {
  esc: s => String(s ?? ''),
  session: {
    event: { active: [], next: [{ playerIds: ['E'] }] },
    players: [
      { id: 'A', name: '평균이', status: 'wait', games: 3, fairExpected: 3 },
      { id: 'B', name: '부족이', status: 'wait', games: 2, fairExpected: 4 },
      { id: 'C', name: '지각이', status: 'wait', games: 1, fairExpected: 1 },
      { id: 'D', name: '많이뛴', status: 'wait', games: 5, fairExpected: 5 },
      { id: 'E', name: '대기중', status: 'wait', games: 1, fairExpected: 2 },
      { id: 'F', name: '휴식이', status: 'rest', games: 3 },
    ],
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const html = vm.runInContext("officialFairBoardHtml('actor1')", ctx);

// 평균은 대기·경기 인원만으로: (3+2+1+5+1)/5 = 2.4 — 휴식자는 평균에서 제외
assert(html.includes('인당 평균 2.4게임'), `평균 2.4가 보여야 합니다: ${html.slice(0, 200)}`);
// 부족이: 완료 격차는 −0.4뿐이지만 보정 기대치로는 −2 부족 → 빨간 칩 + 대진 짜기
assert(/부족이[\s\S]{0,300}부족 −2<\/span><button[^>]*openOfficialQueueCompose\('actor1','B'\)/.test(html),
  '보정 기대치 부족자는 완료 수가 평균에 가까워도 빨간 칩과 대진 짜기 버튼이 붙어야 합니다.');
// 지각이: 완료 −1.4인데 기대치도 낮다 → 늦합류 정상 (빨간 칩 금지)
assert(/지각이[\s\S]{0,300}늦합류 · 정상/.test(html), '지각자는 늦합류 정상으로 설명해야 합니다.');
assert(!/지각이[\s\S]{0,300}fr-chip lack/.test(html), '지각자에게 부족 칩이 붙으면 헛경보 부활입니다.');
// 대기중: 다음 대진에 이미 배정 → 초록 「대기 배정됨」
assert(/대기중[\s\S]{0,300}대기 배정됨/.test(html), '대기 배정자는 곧 해소 예정으로 보여야 합니다.');
// 많이뛴: +2.6 → 파란 칩
assert(/많이뛴[\s\S]{0,300}많이 뜀/.test(html), '평균보다 많이 뛴 쪽도 파란 칩으로 보여야 합니다.');
// 휴식이: 목록 맨 뒤 태그 행으로는 보인다
assert(/휴식이[\s\S]{0,200}휴식 중/.test(html), '휴식자도 게임수가 보여야 합니다.');
// 정렬: 게임 적은 순 — 1게임(지각이·대기중)이 5게임(많이뛴)보다 먼저
assert(html.indexOf('지각이') < html.indexOf('많이뛴'), '게임 적은 순으로 정렬돼야 합니다.');

console.log('checkin fair board regression ok');
