const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const version = indexHtml.match(/<meta name="app-version" content="([^"]+)"/)?.[1];
assert(version, '앱 버전을 찾을 수 있어야 합니다.');
assert.strictEqual(manifest.start_url, `/badminton/team.html?v=${version}&from=app`, '설치형 앱은 팀전LIVE로 시작해야 합니다.');

const redirectScript = indexHtml.match(/<script id="defaultEntryRedirect">([\s\S]*?)<\/script>/)?.[1];
assert(redirectScript, '기존 홈 화면 아이콘을 위한 기본 진입 전환 스크립트가 있어야 합니다.');

function redirectFor({pathname, search = '', standalone = false, displayStandalone = false}) {
  let replaced = '';
  const sandbox = {
    URLSearchParams,
    location: {pathname, search, replace(value) { replaced = value; }},
    navigator: {standalone},
    matchMedia() { return {matches: displayStandalone}; }
  };
  vm.runInNewContext(redirectScript, sandbox);
  return replaced;
}

assert.strictEqual(redirectFor({pathname:'/badminton/',search:'?v=1.10.312'}), `team.html?v=${version}&from=entry`, '기존 루트 주소도 팀전LIVE로 전환해야 합니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/index.html',standalone:true}), `team.html?v=${version}&from=entry`, '기존 iOS 홈 화면 아이콘도 팀전LIVE로 전환해야 합니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/index.html',displayStandalone:true}), `team.html?v=${version}&from=entry`, '설치형 PWA의 기존 index 진입도 팀전LIVE로 전환해야 합니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/index.html'}), '', '브라우저에서 민턴LIVE 주소를 직접 열면 그대로 유지해야 합니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/index.html',search:'?from=team',standalone:true}), '', '팀전LIVE에서 민턴LIVE를 선택한 경우 다시 되돌리면 안 됩니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/',search:'?mode=daily'}), '', '명시적인 민턴LIVE 진입은 루트에서도 유지해야 합니다.');
assert.strictEqual(redirectFor({pathname:'/badminton/',search:'?sample=1'}), '', '민턴LIVE 샘플 화면은 팀전LIVE로 전환하면 안 됩니다.');

function modeOrder(html) {
  const block = html.match(/<div class="live-mode-switch"[\s\S]*?<\/div>/)?.[0] || '';
  return [block.indexOf('팀전LIVE'), block.indexOf('민턴LIVE')];
}

for (const html of [indexHtml, teamHtml]) {
  const [teamIndex, dailyIndex] = modeOrder(html);
  assert(teamIndex >= 0 && dailyIndex >= 0 && teamIndex < dailyIndex, 'LIVE 전환에서도 팀전LIVE가 먼저 보여야 합니다.');
}

assert(teamHtml.includes(`index.html?v=${version}&from=team`), '사용자가 선택한 민턴LIVE 진입 의도를 표시해야 합니다.');

console.log('team default entry regression ok');
