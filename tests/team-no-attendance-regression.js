const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const teamSrc = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');
const liveSrc = fs.readFileSync(path.join(root, 'js', 'live-view.js'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const rsvpHtml = fs.readFileSync(path.join(root, 'rsvp.html'), 'utf8');

function functionSource(src, name, nextName) {
  const start = src.indexOf(`function ${name}`);
  const end = src.indexOf(`function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

assert(!teamHtml.includes('출석'), '관리자 화면에서 팀전 출석 개념이 다시 노출되면 안 됩니다.');
assert(!rsvpHtml.includes('출석'), '회원 화면에서 출석 버튼이나 출석 현황이 다시 노출되면 안 됩니다.');
assert(!teamSrc.includes('출석'), '팀전 운영 로직의 사용자 문구에 출석 개념이 남으면 안 됩니다.');
assert(!liveSrc.includes('출석'), '실중계 화면에 출석 버튼이 남으면 안 됩니다.');

assert(rsvpHtml.includes('내 이름을 확인하면 실중계로 바로 들어갈 수 있습니다.'), '회원에게 본인 확인 다음 행동을 알려야 합니다.');
assert(rsvpHtml.includes('실중계 들어가기'), '본인 확인 후 실중계 진입 버튼이 있어야 합니다.');
assert(rsvpHtml.includes('if(!selected)'), '본인 확인 전에는 실중계 링크를 열지 않아야 합니다.');
const enterLiveSource = functionSource(rsvpHtml, 'enterActiveLive', 'selectRsvpIdentity');
const selectIdentitySource = functionSource(rsvpHtml, 'selectRsvpIdentity', 'liveIdFromUrl');
assert(enterLiveSource.includes('!selectedMemberFromLast()'), '선택된 회원이 없으면 실중계로 자동 진입하지 않아야 합니다.');
assert(enterLiveSource.includes("session?.phase!=='live'||!session.liveUrl"), '진행 중인 LIVE와 유효한 주소가 있을 때만 자동 진입해야 합니다.');
assert(enterLiveSource.includes('location.assign(liveUrlWithViewer(session.liveUrl))'), '자동 진입 주소에는 선택한 회원 정보가 포함되어야 합니다.');
assert(selectIdentitySource.indexOf('setLast(') < selectIdentitySource.indexOf('if(enterActiveLive())return;'), '회원 정보를 저장한 뒤 실중계로 이동해야 합니다.');
assert(selectIdentitySource.indexOf('if(enterActiveLive())return;') < selectIdentitySource.indexOf('render();'), '자동 진입에 성공하면 중간 MY PAGE를 다시 그리지 않아야 합니다.');
assert(rsvpHtml.includes('toggleLateStatus'), '회원은 늦음만 예외 상태로 표시할 수 있어야 합니다.');
assert(rsvpHtml.includes("'/late/'" ) || rsvpHtml.includes("+'/late/'"), '회원 늦음은 LIVE late 경로에도 반영되어야 합니다.');
assert(!rsvpHtml.includes('sendSelectedStatus'), '회원 이름 확인이 출석 전송으로 이어지면 안 됩니다.');
const memberCardSource = functionSource(rsvpHtml, 'memberCard', 'responseFor');
assert(!memberCardSource.includes('saveGuest'), '회원이 관리자 확정 명단에 게스트를 추가하면 안 됩니다.');
assert(!memberCardSource.includes('savePartnerRequest'), '회원이 관리자 확정 파트너를 변경하면 안 됩니다.');

const sessionMembersSource = functionSource(teamSrc, '_rsvpSessionMembers', '_rsvpRosterMemberMap');
assert(sessionMembersSource.includes('_rsvpManagedMembers()'), '회원 링크 명단은 관리자 확정 참가자를 사용해야 합니다.');
assert(!sessionMembersSource.includes('_rsvpRosterMembers()'), '회원 링크가 클럽 전체 명부로 되돌아가면 안 됩니다.');
assert(teamSrc.includes("source:'managedParticipants'"), '공유 세션은 관리자 확정 명단임을 기록해야 합니다.');
assert(teamSrc.includes("stage='playerSetup'"), '첫 단계는 관리자 참가자 세팅이어야 합니다.');
assert(!teamSrc.includes("_autoFlowAction('참가자 불러오기'"), '회원 응답자를 참가자로 불러오는 단계가 다시 생기면 안 됩니다.');

assert(teamSrc.includes("lateMode:'explicit'"), '새 LIVE 데이터는 명시적 늦음 방식이어야 합니다.');
assert(teamSrc.includes('late:_liveLate'), '새 LIVE 송출에는 늦음 지도만 포함해야 합니다.');
assert(teamSrc.includes('attendance:null'), '새 LIVE 송출 시 구 출석 데이터를 제거해야 합니다.');
assert(liveSrc.includes("ref=liveDb.ref('live/'+liveId+'/late/'"), '실중계 늦음 토글은 late 경로를 사용해야 합니다.');
assert(liveSrc.includes('function _lateMapFromData'), '구 저장본을 위한 늦음 변환 경로가 있어야 합니다.');

const liveCompatCode = [
  functionSource(liveSrc, '_attKey', '_lateOn'),
  functionSource(liveSrc, '_lateMapFromData', '_normalizeMembers'),
  'this.api={lateMap:_lateMapFromData};'
].join('\n');
const sandbox = {window:{}, Date};
vm.createContext(sandbox);
vm.runInContext(liveCompatCode, sandbox);

const explicit = JSON.parse(JSON.stringify(sandbox.api.lateMap({
  late:{b:{name:'김늦음',team:'blue'}}
})));
assert.deepStrictEqual(explicit, {b:{name:'김늦음',team:'blue'}}, '명시적 늦음 지도는 그대로 사용해야 합니다.');

const legacy = JSON.parse(JSON.stringify(sandbox.api.lateMap({
  attendanceSeeded:true,
  attendance:{[encodeURIComponent('김도착')]:{name:'김도착'}},
  members:{blue:[{n:'김도착'},{n:'이늦음'}],red:[],all:[]},
  updatedAt:1
})));
assert(legacy['%EC%9D%B4%EB%8A%A6%EC%9D%8C'], '구 저장본에서 도착하지 않은 선수는 늦음으로 변환해야 합니다.');
assert(!legacy['%EA%B9%80%EB%8F%84%EC%B0%A9'], '구 저장본의 도착 선수는 늦음으로 변환하면 안 됩니다.');

const inlineScripts = [...rsvpHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
assert(inlineScripts.length >= 2, '회원 페이지 인라인 스크립트를 찾을 수 있어야 합니다.');
inlineScripts.forEach((script, index) => new vm.Script(script, {filename:`rsvp-inline-${index}.js`}));

console.log('team no-attendance regression ok');
