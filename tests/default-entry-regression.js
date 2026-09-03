'use strict';
/**
 * 앱을 열면 어느 화면이 뜨는가.
 *
 * 2026-09-03 운영자: "민턴라이브를 많이 사용하니까 메뉴순서를 팀전과 맞바꿔줘" →
 * "기본 화면 민턴라이브로 해야지". 그전까지는 루트 주소와 홈 화면 아이콘이 팀전으로
 * 전환됐고(index.html 의 defaultEntryRedirect), 설치형 앱의 start_url 도 team.html
 * 이었다. 매일 쓰는 쪽이 기본이어야 하므로 둘 다 민턴LIVE 로 돌렸다.
 * 팀전은 상단 모드 필로 간다 — 입구가 사라진 것이 아니다.
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
  '팀전이 민턴LIVE 로 자동 전환하면 안 됩니다 — 모드 필로만 오갑니다.');

// ③ 두 화면 모두 상대 모드로 가는 입구가 있어야 한다(자동 전환을 없앤 대신).
assert(indexHtml.includes(`team.html?v=${version}&from=daily`),
  '민턴LIVE 에 팀전으로 가는 모드 필이 있어야 합니다.');
assert(teamHtml.includes(`index.html?v=${version}&from=team`),
  '팀전에 민턴LIVE 로 가는 모드 필이 있어야 합니다.');

// ④ 모드 필 순서 — 자주 쓰는 쪽이 왼쪽(엄지에 가까운 자리). 두 화면이 같아야
//    오갈 때 버튼 자리가 바뀌지 않는다.
function modeOrder(html) {
  const block = html.match(/<div class="live-mode-switch"[\s\S]*?<\/div>/)?.[0] || '';
  // 브랜드의 LIVE 는 네온 표시를 위해 <span> 으로 감싸여 있습니다. 태그를 걷고 봅니다.
  const text = block.replace(/<[^>]*>/g, '');
  return [text.indexOf('팀전'), text.indexOf('민턴LIVE')];
}
for (const html of [indexHtml, teamHtml]) {
  const [teamIndex, dailyIndex] = modeOrder(html);
  assert(teamIndex >= 0 && dailyIndex >= 0 && dailyIndex < teamIndex,
    'LIVE 전환은 민턴LIVE 가 먼저 보여야 합니다(자주 쓰는 쪽이 왼쪽).');
}

// ⑤ 서비스워커는 두 화면을 다 캐시해야 한다 — 기본이 바뀌어도 오프라인에서 둘 다 열린다.
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert(sw.includes("'/badminton/index.html'") && sw.includes("'/badminton/team.html'"),
  '두 화면 모두 오프라인 캐시에 있어야 합니다.');

// ⑥ 화면이 스스로를 설명하는 문구도 기본이 바뀐 것을 알아야 한다 — 「운영 방식 선택」 카드가
//    옛 기본(팀전)을 계속 말하면 사용자는 화면과 설명 중 어느 쪽을 믿을지 고민하게 된다.
assert(indexHtml.includes('기본 시작 화면은 민턴LIVE입니다'),
  '운영 방식 안내가 기본 화면을 민턴LIVE 라고 말해야 합니다.');
assert(!indexHtml.includes('기본 시작 화면은 팀전'),
  '옛 기본(팀전) 설명이 남아 있으면 안 됩니다.');
{
  const grid = indexHtml.match(/<div class="operation-grid">([\s\S]*?)<\/div>\s*<div class="operation-hint"/)?.[1] || '';
  assert(grid, '운영 방식 두 갈래를 찾을 수 있어야 합니다.');
  assert(grid.indexOf('data-operation-option="daily"') < grid.indexOf('operation-option team'),
    '두 갈래 순서도 모드 필과 같이 민턴LIVE 가 먼저여야 합니다.');
}

console.log('default entry regression ok');
