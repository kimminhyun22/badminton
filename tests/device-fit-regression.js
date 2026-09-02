
'use strict';
/**
 * 2026-09-02 운영자: "모든 폰트는 각 스마트폰 스크린 사이즈에 맞게 리사이징… 깨지거나 잘리지 않게",
 * "단말기의 종류에 최적 대응". 반응형 감사(4관점)에서 확정된 단말기 맞춤 규칙을 고정한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ① 굵기 1000 금지 — 로드된 Noto Sans KR 최대는 900, 1000 은 일부 폰에서 가짜 볼드 합성으로 글리프가 깨진다
for (const f of ['css/app.css', 'css/team.css', 'css/live.css', 'checkin.html'])
  assert(!read(f).includes('font-weight:1000'), `${f} 에 font-weight:1000 이 남아 있으면 안 됩니다.`);

// ② 루트 글꼴이 폰 폭을 따른다(rem 화면) + OS 글자 확대 일관성 + 강제 다크 반전 방지
for (const f of ['css/app.css', 'css/team.css']) {
  const s = read(f);
  assert(s.includes('html{scroll-behavior:smooth;-webkit-text-size-adjust:100%;text-size-adjust:100%;font-size:clamp(15px,3.6vw + 2px,17px);color-scheme:only light;}'),
    `${f} 루트 규칙에 clamp 글꼴·text-size-adjust·color-scheme 이 있어야 합니다.`);
  assert(s.includes('  body{font-size:1rem;}'), `${f} 모바일 body 는 고정 px 가 아니라 1rem 이어야 루트 clamp 를 따릅니다.`);
  assert(/max-height:88vh;max-height:88dvh;/.test(s) && /max-height:85vh;max-height:85dvh;/.test(s),
    `${f} 모달 높이는 vh 폴백 뒤에 dvh 여야 합니다.`);
  assert(s.includes('.modal-box input,.modal-box select,.team-name-input,.club-name-input{font-size:16px;}'),
    `${f} 모바일 입력은 16px 이어야 iOS 가 포커스 시 확대하지 않습니다.`);
  assert(s.includes('button,[role="button"],summary{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}'),
    `${f} 에 더블탭 확대·회색 플래시 방지 규칙이 있어야 합니다.`);
}
assert(read('css/app.css').includes('#dailyDashboardTools .daily-player-modes{grid-template-columns:repeat(2,minmax(0,1fr));}'),
  '360px 이하에서 도구 줄은 2열이어야 라벨이 잘리지 않습니다.');

// ③ 회원·임원 화면
const checkin = read('checkin.html');
assert(checkin.includes('color-scheme:only light'), 'checkin 은 강제 다크 반전을 막아야 상태 배지 색이 뒤집히지 않습니다.');
const vhIdx = checkin.indexOf('max-height:calc(100vh - var(--safe-top) - var(--safe-bottom) - 28px)');
const dvhIdx = checkin.indexOf('max-height:calc(100dvh - var(--safe-top) - var(--safe-bottom) - 28px)');
assert(vhIdx > 0 && dvhIdx > vhIdx, '코트 선택 시트는 vh 폴백이 dvh 앞에 있어야 구형 브라우저에서 높이 제한이 살아 있습니다.');
assert(checkin.includes('.fair-row button{min-height:44px;font-size:13px;}'), '분배 보드 버튼은 44px 터치 높이여야 합니다.');
assert(checkin.includes('.official-overview-tools{grid-template-columns:repeat(2,minmax(0,1fr));}'), '360px 이하 임원 도구 줄은 2열이어야 합니다.');

// ④ 전 화면 메타 — 상태바 색과 색 구성표
for (const f of ['index.html', 'team.html', 'checkin.html', 'rsvp.html', 'view.html', 'quiz.html'])
  assert(read(f).includes('<meta name="color-scheme" content="only light">'), `${f} 에 color-scheme 메타가 있어야 합니다.`);
for (const f of ['index.html', 'team.html'])
  assert(read(f).includes('<meta name="theme-color" content="#ffffff">'), `${f} 상태바 색은 흰 헤더와 맞아야 합니다.`);
assert(JSON.parse(read('manifest.json')).theme_color === '#ffffff', 'manifest theme_color 도 흰색이어야 합니다.');

// ⑤ 2차: 좁은 폰에서 이름·버튼이 잘리지 않게
assert(checkin.includes('.event-next-pair{grid-template-columns:minmax(0,1fr);gap:3px;justify-items:stretch;}'), '430px 이하 다음 대진은 팀별 두 이름을 세로로 쌓아야 합니다.');
assert(checkin.includes('.fair-row{flex-wrap:wrap;row-gap:4px;}'), '분배 보드 행은 줄바꿈이 허용돼야 버튼이 잘리지 않습니다.');
assert(/\.toast\{[^}]*z-index:120/.test(checkin), '토스트는 시트(z 80) 위에 떠야 합니다.');
assert(checkin.includes('.official-overview-tool{white-space:normal;overflow:visible;text-overflow:clip;'), '임원 도구 라벨은 줄임표 대신 두 줄이어야 합니다.');
assert(checkin.includes("'.event-active-player,.event-next-player,.my-current-match-team strong,.name,.my-card-name,.replace-picker-row b'") && checkin.includes('let guard=12;'),
  '자동 축소는 내 이름 카드까지 다루고 13px 하한에 닿아야 합니다.');
const app = read('css/app.css');
assert(app.includes('.daily-dashboard-quick-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}'), '모바일 빠른 동작은 2×2 여야 「초기화」가 홀로 전폭이 되지 않습니다.');
assert(app.includes('.daily-player-filter{display:flex;flex-wrap:wrap;gap:6px;overflow:visible;}'), '선수 필터 칩은 줄바꿈돼야 화면 밖으로 넘치지 않습니다.');
assert(app.includes('.daily-next-pair{grid-template-columns:1fr;gap:2px;}'), '관리자 다음 대진도 좁은 폰에서 이름을 세로로 쌓아야 합니다.');
const quiz = read('quiz.html');
assert(quiz.includes("(m.t1||[]).map(esc).join('<br>')") && quiz.includes('.opts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}'),
  '설문 문항 이름은 두 줄, 5단계 버튼은 격자여야 좁은 폰에서 겹치지 않습니다.');

console.log('device fit regression ok');
