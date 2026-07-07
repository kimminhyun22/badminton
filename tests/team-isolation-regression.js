const assert = require('assert');
const fs = require('fs');
const path = require('path');

function eventPayload({ rsvpId, currentMatches, currentSettings, sourceRsvpId, liveOn, liveId }) {
  const currentBracketRsvpId = (currentSettings && currentSettings.rsvpId) || sourceRsvpId || null;
  const ownsEvent = !!(rsvpId && currentMatches.length && currentBracketRsvpId === rsvpId);
  const liveActive = !!(ownsEvent && liveOn && liveId);
  return {
    phase: liveActive ? 'live' : (ownsEvent ? 'bracket' : 'rsvp'),
    bracketReady: !!ownsEvent,
    matchCount: ownsEvent ? currentMatches.length : 0,
    liveId: liveActive ? liveId : null,
  };
}

function filterCurrentNames(map, participants) {
  const names = new Set((participants || []).map(p => String(p && p.name || '').trim()).filter(Boolean));
  const out = {};
  Object.values(map || {}).forEach(v => {
    const name = String(v && v.name || '').trim();
    if (!name || !names.has(name)) return;
    out[name] = { ...v, name };
  });
  return out;
}

function mergeParty({ ownerRsvpId, activeRsvpId, prevData, rsvpParty, participants }) {
  const activeRsvpOwns = !!(activeRsvpId && ownerRsvpId && activeRsvpId === ownerRsvpId);
  const sameRsvp = !!(ownerRsvpId && prevData.rsvpId === ownerRsvpId);
  return {
    ...(sameRsvp ? filterCurrentNames(prevData.party || {}, participants) : {}),
    ...(activeRsvpOwns ? rsvpParty : {}),
  };
}

function viewerPartyNames({ members, party }) {
  const all = [...(members.blue || []), ...(members.red || [])];
  const rosterNames = new Set(all.map(p => String(p && p.n || '').trim()).filter(Boolean));
  const seen = new Set();
  const names = [];
  const push = name => {
    const clean = String(name || '').trim();
    if (!clean || !rosterNames.has(clean) || seen.has(clean)) return;
    seen.add(clean);
    names.push(clean);
  };
  all.forEach(p => {
    if (party[p.n]) push(p.n);
  });
  Object.values(party || {}).forEach(v => {
    if (v && typeof v === 'object') push(v.name);
  });
  return names;
}

const matches = [{ round: 1 }, { round: 1 }];

assert.deepStrictEqual(
  eventPayload({
    rsvpId: 'B',
    currentMatches: matches,
    currentSettings: { rsvpId: 'A' },
    sourceRsvpId: 'A',
    liveOn: true,
    liveId: 'LIVEA',
  }),
  { phase: 'rsvp', bracketReady: false, matchCount: 0, liveId: null },
  '다른 RSVP 링크에는 현재 대진/LIVE가 송출되면 안 됩니다.'
);

assert.deepStrictEqual(
  eventPayload({
    rsvpId: 'A',
    currentMatches: matches,
    currentSettings: { rsvpId: 'A' },
    sourceRsvpId: 'A',
    liveOn: true,
    liveId: 'LIVEA',
  }),
  { phase: 'live', bracketReady: true, matchCount: 2, liveId: 'LIVEA' },
  '같은 RSVP 링크에는 LIVE 정보가 정상 송출되어야 합니다.'
);

const participants = [{ name: '김민현' }, { name: '곽유진' }];
const mergedOther = mergeParty({
  ownerRsvpId: 'B',
  activeRsvpId: 'B',
  prevData: { rsvpId: 'A', party: { old1: { name: '이전멤버' }, old2: { name: '천희주' } } },
  rsvpParty: { cur1: { name: '김민현' } },
  participants,
});
assert.deepStrictEqual(Object.values(mergedOther).map(v => v.name), ['김민현'], '다른 RSVP의 뒷풀이 멤버가 섞이면 안 됩니다.');

const mergedSame = mergeParty({
  ownerRsvpId: 'A',
  activeRsvpId: 'A',
  prevData: { rsvpId: 'A', party: { old1: { name: '곽유진' }, old2: { name: '이전멤버' } } },
  rsvpParty: { cur1: { name: '김민현' } },
  participants,
});
assert.deepStrictEqual(Object.values(mergedSame).map(v => v.name).sort(), ['곽유진', '김민현'].sort(), '같은 RSVP라도 현재 참가자가 아닌 이름은 제외해야 합니다.');

const visible = viewerPartyNames({
  members: { blue: [{ n: '김민현' }], red: [{ n: '곽유진' }] },
  party: { a: { name: '김민현' }, b: { name: '이전멤버' }, c: { name: '천희주' } },
});
assert.deepStrictEqual(visible, ['김민현'], '회원 화면 뒷풀이 카드도 현재 팀 명단만 보여야 합니다.');

const teamJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');
const loadSavedBody = teamJs.match(/function rsvpLoadSaved\(id\)\{([\s\S]*?)\n\}/)?.[1] || '';
assert(loadSavedBody.includes('_teamResetLocalLiveState'), '이전 팀전LIVE 열기 시 현재 LIVE 연결을 먼저 끊어야 합니다.');
assert(!loadSavedBody.includes('rsvpPushSession()'), '이전 팀전LIVE 열기만으로 현재 대진/LIVE 세션을 덮어쓰면 안 됩니다.');
assert(teamJs.includes('function _rsvpOwnsCurrentEvent()'), 'RSVP 링크와 현재 대진의 소유권 확인 함수가 필요합니다.');
assert(teamJs.includes('상단 운영 보드의 "중계 종료" 버튼'), '불러오기 차단 안내에서 종료 버튼 위치를 알려야 합니다.');
assert(teamJs.includes("['liveStopTopBtn','mobLiveStopBtn','liveStopManageBtn']"), 'LIVE 중에는 여러 위치의 종료 버튼을 동기화해야 합니다.');
assert(teamJs.includes('function _teamHasResumeLiveHint()'), '앱 재시작 후 이어 켤 LIVE가 있음을 감지해야 합니다.');
assert(teamJs.includes('resumeTeamLiveBroadcast'), '사용자가 직접 팀전LIVE 중계를 이어 켤 수 있어야 합니다.');
assert(teamJs.includes('if(shouldResume)'), '자동 재개 확인을 취소해도 복구 정보를 즉시 지우지 않아야 합니다.');
assert(teamJs.includes("'live-start'"), '팀전LIVE 시작/이어 켜기 주요 액션은 눈에 띄는 전용 스타일을 써야 합니다.');
assert(teamJs.includes('function _teamSavedLiveRestoreInfo()'), '앱 재실행 첫 화면에서 저장된 LIVE 대진을 감지해야 합니다.');
assert(teamJs.includes('function restoreTeamLiveAndResume()'), '첫 화면에서 대진 불러오기와 중계 재개를 한 번에 실행해야 합니다.');
assert(teamJs.includes("stage='restoreLive'"), '저장된 LIVE가 있으면 운영 보드가 바로 이어가기 단계로 전환되어야 합니다.');
assert(teamJs.includes('restoreState({resumeLive:true})'), '바로 이어가기는 복원 후 수동 재개 흐름으로 연결되어야 합니다.');

const teamHtml = fs.readFileSync(path.join(__dirname, '..', 'team.html'), 'utf8');
assert(teamHtml.includes('id="liveStopTopBtn"'), '운영 보드에 팀전LIVE 종료 버튼이 있어야 합니다.');
assert(teamHtml.includes('id="liveStopManageBtn"'), '저장·관리 영역에 팀전LIVE 종료 버튼이 있어야 합니다.');
assert(teamHtml.includes('id="liveResumeTopBtn"'), '운영 보드에 팀전LIVE 이어 켜기 버튼이 있어야 합니다.');
assert(teamHtml.includes('id="mobLiveResumeBtn"'), '모바일 저장 바에 팀전LIVE 이어 켜기 버튼이 있어야 합니다.');
const teamCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'team.css'), 'utf8');
assert(teamCss.includes('.auto-flow-btn.live-start'), '운영 보드의 팀전LIVE 시작 버튼은 레드 전용 스타일이어야 합니다.');
assert(teamCss.includes('.live-btn.resume'), '결과 영역의 팀전LIVE 이어 켜기 버튼도 시작 버튼과 같은 계열이어야 합니다.');

console.log('team isolation regression ok');
