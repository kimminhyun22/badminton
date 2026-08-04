'use strict';
/**
 * 팀전 회원 화면의 권한 정책 (운영자 판단 2026-08-04).
 *
 * 회원은 기본적으로 보기만 합니다. 회원이 서로의 출결을 켜고 끄면 결국
 * "이거 맞나요?" 확인이 임원에게 몰려 일이 늘어납니다. 그래서
 *
 *   지각·도착 확인 → 단장·부단장·클럽 임원·운영 도우미
 *   뒷풀이 참석    → 본인(의사 표시) 또는 운영진이 대신
 *   승패 입력      → 그 경기 선수 + 운영진 (기존 유지)
 *
 * 민턴LIVE 와 용어도 맞춥니다: '늦음' 이 아니라 '지각'.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'live.css'), 'utf8');

// 1) 권한 판정이 존재하고, 운영진 네 역할을 모두 인정해야 합니다.
assert(live.includes('function _canOperateAttendance'), '출결 권한 판정 함수가 있어야 합니다.');
const canOp = live.slice(live.indexOf('function _canOperateAttendance'),
                         live.indexOf('function _isSelf'));
['isClubOfficial','isLeader','isSub','isTemporaryOperator'].forEach(role=>{
  assert(canOp.includes(role), `${role} 도 출결을 처리할 수 있어야 합니다.`);
});
console.log('  출결 권한: 단장·부단장·클럽 임원·운영 도우미');

// 2) 버튼을 감추는 것만으로는 부족합니다. 저장 함수가 스스로 막아야 합니다.
const lateFn = live.slice(live.indexOf('async function toggleMemberLate'),
                          live.indexOf('async function toggleMemberParty'));
assert(/_canOperateAttendance\(/.test(lateFn),
  '지각 저장 함수가 직접 권한을 확인해야 합니다(버튼만 감추면 우회됩니다).');

const partyStart = live.indexOf('async function toggleMemberParty');
const partyFn = live.slice(partyStart, live.indexOf('\nfunction ', partyStart));
assert(/_isSelf\(/.test(partyFn) && /_canOperateAttendance\(/.test(partyFn),
  '뒷풀이는 본인 또는 운영진만 바꿀 수 있어야 합니다.');
console.log('  저장 함수 자체에서 권한 확인');

// 3) 회원에게는 버튼 대신 상태 표시가 나가야 합니다.
assert(live.includes('team-member-att-view'), '권한 없는 회원에게는 지각 상태만 보여야 합니다.');
assert(live.includes('viewer-state-view'), '본인 카드도 권한이 없으면 상태만 보여야 합니다.');
['team-member-att-view','team-member-party-view','viewer-state-view'].forEach(cls=>{
  assert(css.includes('.'+cls), `${cls} 스타일이 없으면 화면이 깨집니다.`);
});
console.log('  표시 전용 요소와 스타일 확인');

// 4) 용어는 민턴LIVE 와 맞춥니다.
assert(!live.includes('늦음'), "팀전 회원 화면에 '늦음' 이 남아 있으면 민턴LIVE 의 '지각' 과 어긋납니다.");
console.log("  용어 '지각' 으로 통일");

// 5) 승패 입력은 좁히지 않았습니다 — 그 코트에서 뛴 선수가 가장 정확히 압니다.
const canSubmit = live.slice(live.indexOf('function _canSubmitResult'),
                             live.indexOf('function _resultRoleForSubmit'));
assert(/names\.includes\(viewer\.n\)\)\s*return true;/.test(canSubmit),
  '그 경기 선수 본인의 승패 입력 권한을 없애면 임원이 모든 코트를 돌아야 합니다.');
console.log('  승패 입력: 경기 선수 권한 유지');

console.log('\nteam attendance authority regression ok');
