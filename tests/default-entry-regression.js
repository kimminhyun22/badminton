'use strict';
/**
 * 앱을 열면 어느 화면이 뜨는가.
 *
 * 2026-09-03 운영자: "민턴라이브를 많이 사용하니까 메뉴순서를 팀전과 맞바꿔줘" →
 * "기본 화면 민턴라이브로 해야지". 그전까지는 루트 주소와 홈 화면 아이콘이 팀전으로
 * 전환됐고(index.html 의 defaultEntryRedirect), 설치형 앱의 start_url 도 team.html
 * 이었다. 매일 쓰는 쪽이 기본이어야 하므로 둘 다 민턴LIVE 로 돌렸다.
 * 팀전은 참가자 준비 카드에서 고른다. 운영 화면의 상단 전환 바는 중복이라 두지 않는다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const version = indexHtml.match(/<meta name="app-version" content="([^"]+)"/)?.[1];
assert(version, '앱 버전을 찾을 수 있어야 합니다.');

// ① 설치형 앱(홈 화면 아이콘)은 민턴LIVE 로 시작한다.
assert.strictEqual(manifest.start_url, `/badminton/index.html?v=${version}&from=app`,
  '설치형 앱은 민턴LIVE 로 시작해야 합니다.');

// ② 루트 주소로 들어와도 그대로 민턴LIVE — 전환 스크립트가 되살아나면 안 된다.
assert(!indexHtml.includes('id="defaultEntryRedirect"'),
  '기본 진입 전환 스크립트가 남아 있으면 안 됩니다 — 민턴LIVE 가 기본 화면입니다.');
assert(!/location\.replace\(\s*['"`]team\.html/.test(indexHtml),
  '민턴LIVE 에서 팀전으로 자동 전환하면 안 됩니다.');
// 반대 방향도 막는다 — 팀전이 스스로를 기본으로 되돌리는 길
assert(!/location\.replace\(\s*['"`]index\.html/.test(teamHtml),
  '팀전이 민턴LIVE 로 자동 전환하면 안 됩니다.');

// ③ 운영 방식 선택은 참가자 준비 카드 한 곳뿐이다.
assert(indexHtml.includes("onclick=\"dailyChooseOperation('team')\""),
  '참가자 준비 카드에 팀전 선택이 있어야 합니다.');
assert(!indexHtml.includes('live-mode-switch')&&!teamHtml.includes('live-mode-switch'),
  '운영 화면 상단에 민턴LIVE·팀전 전환 바를 중복 노출하면 안 됩니다.');

// ④ 서비스워커는 두 화면을 다 캐시해야 한다 — 기본이 바뀌어도 오프라인에서 둘 다 열린다.
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert(sw.includes("'/badminton/index.html'") && sw.includes("'/badminton/team.html'"),
  '두 화면 모두 오프라인 캐시에 있어야 합니다.');

// ⑤ 기본 화면은 참가자를 먼저 준비한 뒤 두 운영 방식 중 하나를 고른다.
assert(indexHtml.includes('참가자를 먼저 등록하면 같은 명단으로 원하는 방식을 시작합니다.'),
  '기본 화면이 참가자 우선 흐름을 짧게 안내해야 합니다.');
assert(!indexHtml.includes('기본 시작 화면은 팀전'),
  '옛 기본(팀전) 설명이 남아 있으면 안 됩니다.');
{
  const grid = indexHtml.match(/<div class="operation-grid participant-operation-grid">([\s\S]*?)<\/div>\s*<div class="participant-prep-hint"/)?.[1] || '';
  assert(grid, '운영 방식 두 갈래를 찾을 수 있어야 합니다.');
  assert(grid.indexOf('participantChooseDaily') < grid.indexOf('participantChooseTeam'),
    '두 갈래는 자주 쓰는 민턴LIVE가 먼저여야 합니다.');
}

console.log('default entry regression ok');
