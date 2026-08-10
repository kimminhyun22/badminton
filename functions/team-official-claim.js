'use strict';
/**
 * 팀전 임원 운영 연결 (운영자 2026-08-13 "민턴라이브와 동일한 방식").
 *
 * 민턴LIVE 와 같은 구조입니다: 게시된 임원 명단에서 **본인 이름을 고르면**
 * 서버가 **서명된 권한(grant)** 을 내주고, 이후 모든 조작은 그 권한으로만
 * 받습니다. 이름만 실어 보내면 통하던 이전 단계보다 강한 것은 —
 *   · 권한이 **이 팀전·이 기기**에 묶이고 만료된다
 *   · 동시에 연결할 수 있는 임원 수가 제한된다
 *   · 화면 코드를 고쳐도 서버가 서명을 확인한다
 *
 * 팀전 라이브는 `live/<liveId>` 에 페이로드가 통째로 있습니다(민턴LIVE 는
 * `session` 하위) — 그래서 별도 파일로 둡니다.
 */

const MAX_TEAM_CLAIMS = 8;

function text(value){ return String(value == null ? '' : value); }
function number(value, fallback = 0){
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nameKey(value){ return text(value).replace(/\s+/g, '').toLowerCase(); }
function abort(failureCode, failureMessage){
  return {action:'abort', failureCode, failureMessage};
}

/**
 * 운영할 수 있는 사람 = 클럽 임원 · 운영 도우미 · **단장/부단장**.
 *
 * 단장·부단장은 `officials.leaders` 로도 실리지만, 그 필드가 없던 시절에 시작한
 * 팀전도 있습니다. 그때는 팀원 명단의 `isLeader`/`isSub` 표시가 유일한 근거라
 * 여기서 함께 봅니다 — 안 그러면 **정작 팀전을 이끄는 사람이 자기 폰에서
 * 아무것도 못 합니다.**
 */
function officialRows(session){
  const officials = session?.officials || {};
  const members = session?.members || {};
  const captains = [...(members.blue || []), ...(members.red || []), ...(members.all || [])]
    .filter(m => m && (m.isLeader || m.isSub))
    .map(m => ({name:m.name || m.n || '', memberId:m.memberId || m.id || ''}));
  return [
    ...(officials.clubOfficials || []),
    ...(officials.temporaryOperators || []),
    ...(officials.leaders || []),
    ...captains
  ].filter(row => row && text(row.name));
}

/**
 * 이름으로 임원을 확인하고 연결 자리를 잡습니다.
 * 반환: {action:'commit'|'abort', current, grantExpiresAt, claimNonce, officialName}
 */
function applyTeamOfficialClaim(current, input){
  const {clientId, requestedName, now, maxGrantMs, claimNonce} = input;
  if(!current || typeof current !== 'object')return abort('not-found', '종료되었거나 없는 팀전입니다.');
  if(!Array.isArray(current.matches))return abort('failed-precondition', '아직 대진이 게시되지 않았습니다.');

  const expiresAt = number(current.expiresAt);
  if(expiresAt && now >= expiresAt)return abort('permission-denied', '팀전 운영 시간이 끝났습니다.');

  const key = nameKey(requestedName);
  if(!key)return abort('invalid-argument', '명단에서 본인 이름을 선택해 주세요.');
  const official = officialRows(current).find(row => nameKey(row?.name) === key) || null;
  if(!official)return abort('permission-denied', '단장·부단장·클럽 임원 본인 이름을 선택해 주세요.');
  if(!text(clientId))return abort('invalid-argument', '기기 확인에 실패했습니다. 화면을 새로 고쳐 주세요.');

  const claims = {...(current.officialClaims || {})};
  Object.keys(claims).forEach(id => {
    if(now >= number(claims[id]?.expiresAt))delete claims[id];
  });
  const existing = claims[clientId];
  if(!existing && Object.keys(claims).length >= MAX_TEAM_CLAIMS){
    // 같은 사람이 기기를 바꿔 다시 들어온 경우, 그 사람의 옛 연결을 정리합니다.
    const stale = Object.keys(claims)
      .filter(id => nameKey(claims[id]?.officialName) === key)
      .sort((a, b) => number(claims[a]?.claimedAt) - number(claims[b]?.claimedAt))[0];
    if(stale)delete claims[stale];
  }
  if(!existing && Object.keys(claims).length >= MAX_TEAM_CLAIMS){
    return abort('resource-exhausted', '임원 운영 연결 가능 인원을 넘었습니다. 잠시 후 다시 시도해 주세요.');
  }

  const grantExpiresAt = Math.min(
    now + Math.max(60_000, number(maxGrantMs, 12 * 60 * 60_000)),
    expiresAt || (now + 12 * 60 * 60_000)
  );
  claims[clientId] = {
    clientId:text(clientId),
    officialName:text(official.name),
    officialMemberId:text(official.memberId || ''),
    claimedAt:number(existing?.claimedAt, now),
    refreshedAt:now,
    expiresAt:grantExpiresAt,
    claimNonce:text(claimNonce)
  };
  const next = {...current, officialClaims:claims};
  return {
    action:'commit',
    current:next,
    grantExpiresAt,
    claimNonce:text(claimNonce),
    officialName:text(official.name),
    officialMemberId:text(official.memberId || '')
  };
}

module.exports = {applyTeamOfficialClaim, MAX_TEAM_CLAIMS};
