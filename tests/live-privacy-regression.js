const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const dailySrc=read('js/daily.js');
const teamSrc=read('js/team.js');
const liveSrc=read('js/live-view.js');
const checkin=read('checkin.html');
const rsvp=read('rsvp.html');
const view=read('view.html');

// 2026-08-03 실측: 인증 없이 GET /live.json?shallow=true 로 전 세션 ID 를 훑고,
// 그 ID 로 남의 클럽 실명 명단을 읽을 수 있었습니다. 원인은 클라이언트가 오래된
// 데이터를 지우려고 live 전체를 내려받던 경로였습니다.
[['js/daily.js',dailySrc],['js/team.js',teamSrc],['js/live-view.js',liveSrc],
 ['checkin.html',checkin],['rsvp.html',rsvp],['view.html',view]]
  .forEach(([name,src])=>{
    assert(!/ref\(\s*['"`]live['"`]\s*\)/.test(src),`${name} 에서 live 전체를 읽으면 모든 클럽의 명단이 열립니다.`);
  });
assert(!dailySrc.includes('_cleanupOldLive')&&!teamSrc.includes('_cleanupOldLive'),'전수 청소는 서버로 옮겼습니다. 클라이언트에 남기면 안 됩니다.');

// 정리는 서버가 맡습니다.
const functionsSrc=read('functions/index.js');
assert(functionsSrc.includes('exports.cleanupExpiredLive'),'만료 세션 정리를 담당하는 예약 함수가 있어야 합니다.');
assert(functionsSrc.includes("require('firebase-functions/v2/scheduler')"),'예약 실행 모듈을 가져와야 합니다.');
assert(/LIVE_RETAIN_AFTER_EXPIRY_MS\s*=\s*7\s*\*/.test(functionsSrc),'만료 직후 즉시 삭제하지 말고 보관 기간을 두어야 합니다.');

// 보안 규칙이 배포 대상에 묶여 있어야 합니다.
const firebaseJson=JSON.parse(read('firebase.json'));
assert(firebaseJson.database&&firebaseJson.database.rules==='database.rules.json','firebase.json 에 데이터베이스 규칙 경로가 있어야 배포됩니다.');

const rules=JSON.parse(read('database.rules.json'));
const live=rules.rules.live;
assert(rules.rules['.read']===false&&rules.rules['.write']===false,'최상위는 닫혀 있어야 합니다.');
assert(live['.read']===false,'live 목록 조회가 열려 있으면 세션 ID 를 전부 훑을 수 있습니다.');
const node=live.$sessionId;
assert(node&&typeof node['.read']==='string'&&node['.read'].includes('matches('),'세션 노드는 ID 형식을 검사해야 합니다.');
assert(typeof node['.write']==='string'&&node['.write'].includes('matches('),'아무 이름의 노드나 만들 수 있으면 안 됩니다.');
assert(/checkin\|rsvp/.test(node['.read']),'checkin·rsvp 세션을 허용해야 합니다.');
// 실시간 중계 노드는 _genLiveId() 가 만든 접두어 없는 6자 코드입니다. 규칙에서 빠지면 중계가 죽습니다.
const relayIdPattern=/\[A-Z0-9\]\{6\}/;
assert(relayIdPattern.test(node['.read'])&&relayIdPattern.test(node['.write']),'6자 실시간 중계 코드를 허용해야 합니다.');
[['js/daily.js',dailySrc],['js/team.js',teamSrc]].forEach(([name,src])=>{
  const gen=src.slice(src.indexOf('function _genLiveId'),src.indexOf('function _genLiveId')+200);
  assert(/i<6;/.test(gen),`${name} 의 중계 코드 길이가 바뀌면 보안 규칙의 6자 허용도 함께 고쳐야 합니다.`);
});
assert(node.session&&/officialInvite\/tokenHash/.test(node.session['.validate']),'이미 발급된 임원 초대 해시를 덮어써 세션을 가로챌 수 없어야 합니다.');

console.log('live privacy regression ok');
