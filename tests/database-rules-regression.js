'use strict';
/**
 * 규칙을 조일 때 제일 위험한 것은 "클라이언트가 쓰는 경로를 빠뜨리는 것"입니다.
 * 하나라도 빠지면 그 동작이 조용히 실패합니다(게시 실패, 요청 전송 실패 등).
 *
 * 배경: `live/<id>` 전체가 인증 없이 읽고 쓸 수 있었습니다. 민턴LIVE 세션에는
 * 서버 함수만 쓰는 자리(serverCommands·serverOps·officialClaims)가 있어서,
 * 노드 단위 쓰기를 열어두면 그 장부까지 지우거나 덮어쓸 수 있습니다.
 *
 * Firebase 규칙은 **위에서 허용하면 아래에서 못 막습니다.** 그래서 checkin_* 는
 * 노드 단위 쓰기를 빼고 자식마다 허용을 내렸습니다. 팀전(6자리)·rsvp_* 는
 * 명령 구조가 없어 노드 단위 쓰기를 그대로 둡니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
const session = rules.rules.live.$sessionId;
assert(session, 'live/$sessionId 규칙이 있어야 합니다.');

const CHECKIN = /checkin_/;

// 1) 민턴LIVE 세션은 노드 단위 쓰기를 주면 안 됩니다(삭제만 허용).
const nodeWrite = String(session['.write'] || '');
assert(!CHECKIN.test(nodeWrite) || nodeWrite.includes('!newData.exists()'),
  'checkin_* 에 노드 단위 쓰기를 주면 서버 전용 장부까지 함께 열립니다.');
assert(nodeWrite.includes('!newData.exists()'),
  '세션 정리(노드 삭제)는 계속 되어야 합니다.');
assert(/\[A-Z0-9\]\{6\}/.test(nodeWrite),
  '팀전(6자리) 세션은 노드 단위로 써야 하므로 계속 허용해야 합니다.');
console.log('  노드 단위 쓰기: 팀전·rsvp 만, checkin_* 은 삭제만');

// 2) 서버 함수만 쓰는 자리는 클라이언트 쓰기를 막아야 합니다.
['serverCommands','serverOps','officialClaims'].forEach(key=>{
  assert(session[key] && session[key]['.write'] === false,
    `${key} 는 서버 함수(Admin SDK)만 써야 합니다. Admin SDK 는 규칙을 우회하므로 서버는 영향 없습니다.`);
});
console.log('  서버 전용 장부 3종 쓰기 차단');

// 3) 클라이언트가 실제로 쓰는 자식 경로가 전부 규칙에 있어야 합니다.
//    소스에서 경로를 뽑아 대조합니다 — 새 경로를 쓰기 시작하면 여기서 잡힙니다.
const sources = ['js/daily.js', 'checkin.html']
  .map(f=>fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const used = new Set();
for(const m of sources.matchAll(/(?:_dailyCheckinPath\(\)|checkinPath\(\))\s*\+\s*'\/([a-zA-Z]+)/g)){
  used.add(m[1]);
}
// 관리자 게시가 노드에 얕게 남기는 값들(ref(path).update({...}))
['kind','createdAt','matchStartedAt','expiresAt','updatedAt'].forEach(k=>used.add(k));

assert(used.size >= 4, `클라이언트 쓰기 경로를 못 찾았습니다(${used.size}개). 검사가 헛돌고 있습니다.`);
const missing = [...used].filter(key=>{
  const rule = session[key];
  return !rule || typeof rule['.write'] !== 'string' || !CHECKIN.test(rule['.write']);
});
assert.deepStrictEqual(missing, [],
  `민턴LIVE 화면이 쓰는데 규칙에 없는 경로입니다(그 동작이 조용히 실패합니다): ${missing.join(', ')}`);
console.log(`  민턴LIVE 클라이언트 쓰기 경로 ${used.size}개 전부 허용됨: ${[...used].sort().join(', ')}`);

// 4) 초대 토큰 해시와 세션 id 는 계속 못 바꾸게 남겨야 합니다.
assert(String(session.session['.validate'] || '').includes('officialInvite/tokenHash'),
  '초대 토큰 해시를 바꿔치기하지 못하게 막아야 합니다.');
assert(session.session.serverSessionId && session.session.serverSessionId['.validate'],
  '세션 id 는 한 번 정해지면 바뀌면 안 됩니다.');
console.log('  초대 토큰 해시·세션 id 고정 유지');

console.log('\ndatabase rules regression ok');
