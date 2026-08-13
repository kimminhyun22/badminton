'use strict';
/**
 * 뒷풀이 신청 버튼 (운영자 2026-08-12).
 *
 *   "뒷풀이 신청이 눈에 잘 안띄어서 신청버튼이 있는지 모르는 사람들이 많네."
 *   "그걸 누르는 건지 모름"
 *
 * 여기서 지키는 것:
 *   1) 글에 **동사**가 있다 — 「뒷풀이」 한 단어로는 누르는 것인 줄 모른다
 *   2) 신청 **전**이 꽉 찬 버튼이다 — 예전에는 반대라 눌러야 할 상태가 라벨 같았다
 *   3) 뒷풀이 이야기가 나오는 자리(멤버 블록)에도 버튼이 있다
 *   4) 눈에 띄되 **읽힌다** — 흰 글자는 이 주황 위에서 2.37:1 이었다
 *   5) 뒤에 오는 같은 선택자에 가려지지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');
const cut = (a, b) => {
  const i = view.indexOf(a);
  assert(i >= 0, '시작 표지를 못 찾음: ' + a);
  const j = view.indexOf(b, i + a.length);
  assert(j >= 0, '끝 표지를 못 찾음: ' + b);
  return view.slice(i, j);
};

const box = {console, Object, Set, Number, String, Array, JSON, Date, Math,
  window: {_liveLate: {}, _liveParty: {}}};
vm.createContext(box);
vm.runInContext(`
  ${cut('function esc(s)', '\n')}
  ${cut('function _viewerStatusButtons', 'function buildViewerIdentity')}
  ${cut('function buildPartySpotlight', 'function _teamOfficialOverviewData')}
  var VIEWER = {n:'김민현', team:'red'}, PARTY = [];
  function _viewerInfo(){ return VIEWER; }
  function _partyOn(n){ return PARTY.indexOf(n) >= 0; }
  function _attKey(n){ return String(n || ''); }
  function _isTeamLiveData(){ return true; }
  function _allLiveMembers(d){ return (d.members || []).map(n => ({n})); }
  this.api = {btn:_viewerStatusButtons, spot:buildPartySpotlight,
    set(p, v){ PARTY = p; if(v !== undefined) VIEWER = v; }};
`, box);

const d = {members:['김민현','박서연','이준호'], party:{a:{name:'박서연'}}};

// 1~2) 신청 전: 동사가 있고, 꽉 찬 버튼(cta)입니다.
{
  box.api.set([], {n:'김민현', team:'red'});
  const btn = box.api.btn({n:'김민현', team:'red'});
  assert(/신청하기/.test(btn), `동사가 있어야 누르는 것인 줄 압니다: ${btn}`);
  assert(/viewer-state-btn party cta/.test(btn), '신청 전은 꽉 찬 버튼(cta)이어야 합니다.');
  assert(!/party on/.test(btn), '신청 전에 완료 상태로 보이면 안 됩니다.');

  box.api.set(['김민현']);
  const done = box.api.btn({n:'김민현', team:'red'});
  assert(/신청함/.test(done) && /취소/.test(done),
    `신청 후에는 상태와 되돌리는 법을 알려야 합니다: ${done}`);
  assert(/party on/.test(done) && !/party cta/.test(done),
    '신청 후는 조용한 확인이어야 합니다.');
  console.log('  내 카드: 신청하기(cta) → 신청함(조용)');
}

// 3) 뒷풀이 멤버 블록에도 버튼이 있습니다 — 여기서 처음 알게 되는 사람이 많습니다.
{
  box.api.set([], {n:'김민현', team:'red'});
  const spot = box.api.spot(d);
  assert(/party-join/.test(spot), '멤버 블록에도 신청 버튼이 있어야 합니다.');
  assert(/나도 신청하기/.test(spot), '동사가 있어야 합니다.');
  assert(/toggleMemberParty/.test(spot), '눌러서 신청이 되어야 합니다.');

  // 아무도 없을 때(모집 중)도 버튼이 있어야 첫 사람이 누릅니다.
  const empty = box.api.spot({members:d.members, party:{}});
  assert(/party-join/.test(empty), '아직 아무도 없을 때야말로 버튼이 필요합니다.');

  // 이름을 안 고른 사람에게는 붙이지 않습니다(누구로 신청할지 모릅니다).
  box.api.set([], null);
  assert(!/party-join/.test(box.api.spot(d)), '이름을 고르기 전에는 버튼을 띄우지 않습니다.');
  console.log('  멤버 블록: 신청 버튼 · 빈 상태에도 · 이름 고른 뒤에만');
}

// 4) 눈에 띄되 읽혀야 합니다.
{
  function lum(hex){
    const m = hex.replace('#','').match(/\w\w/g).map(h => {
      const v = parseInt(h, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  }
  const ratio = (f, b) => {
    const x = lum(f), y = lum(b), hi = Math.max(x, y), lo = Math.min(x, y);
    return (hi + 0.05) / (lo + 0.05);
  };
  const ctaRule = (css.match(/\.viewer-state-btn\.party\.cta\{[\s\S]*?\}/) || [''])[0];
  const joinRule = (css.match(/\.party-join\{[\s\S]*?\}/) || [''])[0];
  [['내 카드', ctaRule], ['멤버 블록', joinRule]].forEach(([what, rule]) => {
    // `border-color:` 도 "color:" 를 품고 있습니다 — 앞을 못 박아 글자색만 잡습니다.
    const fg = (rule.match(/(?:^|[;{\s])color:(#[0-9a-f]{6})/i) || [])[1];
    const grad = rule.match(/linear-gradient\(180deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i);
    assert(fg && grad, `${what} CTA 의 글자색·배경을 찾을 수 있어야 합니다.`);
    // 그라디언트의 **어두운 끝**(가장 불리한 조건)으로 잽니다.
    const worst = ratio(fg, grad[2]);
    assert(worst >= 4.5,
      `${what} CTA 대비가 ${worst.toFixed(2)}:1 입니다 — 흰 글자로 두면 2.37 이었습니다.`);
  });
  console.log('  대비: 두 CTA 모두 4.5:1 이상');
}

// 5) 같은 선택자가 파일 뒤쪽에 또 있으면 앞을 고쳐도 안 먹습니다.
{
  const ctaAt = css.indexOf('.viewer-state-btn.party.cta{');
  const lastPlain = css.lastIndexOf('.viewer-state-btn.party{');
  assert(ctaAt > 0, 'cta 규칙이 있어야 합니다.');
  assert(ctaAt > css.indexOf('.viewer-state-btn.party{'),
    'cta 는 기본 규칙보다 뒤에 와야 합니다.');
  // 뒤쪽 공통 규칙이 글자 크기를 다시 줄이면 CTA 가 작아집니다.
  assert(/\.viewer-state-btn\.party:not\(\.cta\):not\(\.on\)\{font-size/.test(css),
    '뒤쪽 글자 크기 규칙은 cta·on 을 건드리면 안 됩니다.');
  console.log('  규칙 순서: 뒤 규칙에 가려지지 않음');
}

console.log('party-cta-regression: OK');
