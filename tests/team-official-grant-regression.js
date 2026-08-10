'use strict';
/**
 * 팀전 임원 운영 권한 (운영자 2026-08-13 "민턴라이브와 동일한 방식").
 *
 * 이름만 실어 보내면 통하던 단계를 넘어, **서명된 권한**으로만 조작을 받습니다.
 * 여기서 지키는 것:
 *   1) 임원 명단에 있는 이름만 연결된다
 *   2) 연결은 이 팀전·이 기기에 묶이고 만료된다
 *   3) 동시에 연결할 수 있는 인원이 제한된다
 *   4) 권한 없이 보낸 요청은 서버가 거절한다 (배선 고정)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyTeamOfficialClaim, MAX_TEAM_CLAIMS} = require('../functions/team-official-claim');

const NOW = 1_830_000_000_000;

function live(extra){
  return {
    liveId:'TEAMGRANT', isTeam:true,
    expiresAt:NOW + 6 * 60 * 60_000,
    matches:[{round:1,court:1,num:1,t1:['청하나','청두리'],t2:['홍하나','홍두리'],win:null}],
    members:{blue:[],red:[],all:[]},
    officials:{
      clubOfficials:[{memberId:'m1', name:'청하나'}],
      temporaryOperators:[{memberId:'m2', name:'도우미'}]
    },
    ...(extra || {})
  };
}
function claim(current, name, clientId, now){
  return applyTeamOfficialClaim(current, {
    clientId, requestedName:name, now:now || NOW, maxGrantMs:12 * 60 * 60_000, claimNonce:'nonce1'
  });
}

// 1) 임원 명단에 있는 이름만 연결됩니다.
{
  const ok = claim(live(), '청하나', 'client-a');
  assert.strictEqual(ok.action, 'commit', `임원은 연결돼야 합니다: ${ok.failureMessage || ''}`);
  assert.strictEqual(ok.officialName, '청하나');
  assert(ok.grantExpiresAt > NOW, '만료 시각이 있어야 합니다.');

  const helper = claim(live(), '도우미', 'client-b');
  assert.strictEqual(helper.action, 'commit', '운영 도우미도 연결돼야 합니다.');

  const stranger = claim(live(), '홍하나', 'client-c');
  assert.strictEqual(stranger.action, 'abort', '임원이 아닌 사람은 연결되면 안 됩니다.');
  assert(/본인 이름/.test(stranger.failureMessage || ''), `안내가 분명해야 합니다: ${stranger.failureMessage}`);
  console.log('  연결 권한: 임원·도우미 commit · 일반 회원 abort');
}

// 2) 공백·대소문자가 달라도 같은 사람으로 봅니다(현장에서 이름 표기가 흔들립니다).
{
  const spaced = claim(live(), ' 청 하나 ', 'client-d');
  assert.strictEqual(spaced.action, 'commit', '공백이 섞여도 같은 이름으로 봐야 합니다.');
  console.log('  이름 표기 흔들림: commit');
}

// 3) 끝난 팀전·대진 없는 팀전에는 연결하지 않습니다.
{
  const ended = claim(live({expiresAt:NOW - 1000}), '청하나', 'client-e');
  assert.strictEqual(ended.action, 'abort', '끝난 팀전에는 연결되면 안 됩니다.');
  const noBracket = claim({liveId:'X', officials:{clubOfficials:[{name:'청하나'}]}}, '청하나', 'client-f');
  assert.strictEqual(noBracket.action, 'abort', '대진이 없으면 연결되면 안 됩니다.');
  console.log('  종료·미게시: abort');
}

// 4) 같은 기기는 자리를 새로 만들지 않고 갱신합니다.
{
  const first = claim(live(), '청하나', 'client-a');
  const second = claim(first.current, '청하나', 'client-a', NOW + 60_000);
  assert.strictEqual(second.action, 'commit');
  assert.strictEqual(Object.keys(second.current.officialClaims).length, 1, '같은 기기는 자리를 하나만 씁니다.');
  assert.strictEqual(second.current.officialClaims['client-a'].claimedAt, NOW, '처음 연결 시각은 유지돼야 합니다.');
  console.log('  같은 기기 재연결: 자리 1개 유지');
}

// 5) 만료된 연결은 정리되고, 동시 연결 수는 제한됩니다.
{
  let state = live();
  for(let i = 0; i < MAX_TEAM_CLAIMS; i += 1){
    const r = applyTeamOfficialClaim(state, {clientId:'c' + i, requestedName:'청하나',
      now:NOW, maxGrantMs:12 * 60 * 60_000, claimNonce:'n'});
    state = r.action === 'commit' ? r.current : state;
  }
  // 자리가 다 찼을 때: **다른 사람**은 기다려야 합니다(민턴LIVE 와 같은 규칙).
  const other = claim(state, '도우미', 'c-other');
  assert.strictEqual(other.action, 'abort', '자리가 다 차면 다른 임원은 기다려야 합니다.');
  assert(/인원/.test(other.failureMessage || ''), `이유가 분명해야 합니다: ${other.failureMessage}`);
  // 반면 **같은 사람이 기기를 바꿔** 들어오면 그 사람의 옛 연결을 정리하고 받습니다.
  const again = claim(state, '청하나', 'c-newphone');
  assert.strictEqual(again.action, 'commit', '같은 임원이 기기를 바꾸면 옛 연결을 정리하고 받아야 합니다.');
  assert(Object.keys(again.current.officialClaims).length <= MAX_TEAM_CLAIMS,
    '동시 연결 수가 상한을 넘으면 안 됩니다.');

  const expired = live({officialClaims:{old:{clientId:'old', officialName:'청하나', expiresAt:NOW - 1}}});
  const after = claim(expired, '청하나', 'client-new');
  assert(!after.current.officialClaims.old, '만료된 연결은 정리돼야 합니다.');
  console.log(`  동시 연결: 상한 ${MAX_TEAM_CLAIMS} · 타인 대기 · 같은 임원 기기 교체 허용 · 만료 정리`);
}

// 6) 서버 배선 — 권한 없이는 조작을 받지 않아야 합니다.
{
  const index = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert(index.includes('exports.claimTeamOfficialInvite'), '팀전 연결 callable 이 있어야 합니다.');
  assert(index.includes("require('./team-official-claim')"), '연결 모듈을 불러와야 합니다.');
  const submit = index.slice(index.indexOf('exports.submitTeamOfficialRequest'));
  assert(/verifyOfficialGrant\(grantToken/.test(submit), '조작 요청은 서명된 권한을 확인해야 합니다.');
  assert(/sameName\(grantName, actorName\)/.test(submit),
    '연결된 임원 본인 이름으로만 조작할 수 있어야 합니다.');
  assert(/nm:String\(outcome\.officialName/.test(index), '권한에 임원 이름을 실어야 합니다.');

  const liveView = fs.readFileSync(path.join(__dirname, '..', 'js', 'live-view.js'), 'utf8');
  assert(/httpsCallable\('claimTeamOfficialInvite'\)/.test(liveView), '화면이 연결을 요청해야 합니다.');
  assert(/callable\(\{liveId,grantToken,command:\{/.test(liveView), '조작에 권한을 실어 보내야 합니다.');
  assert(/localStorage\.getItem\('kokmatch_team_client'\)/.test(liveView),
    '기기 식별자를 유지해야 같은 기기로 인정됩니다.');
  console.log('  서버·화면 배선: 권한 발급 · 검증 · 본인 확인');
}

console.log('\nteam official grant regression ok');
