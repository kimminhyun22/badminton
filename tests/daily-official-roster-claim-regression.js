'use strict';

const assert=require('assert');
const crypto=require('crypto');
const {applyOfficialClaimTransaction}=require('../functions/daily-official-claim');

const NOW=1_800_000_000_000;
const TOKEN='a'.repeat(48);
const TOKEN_HASH=crypto.createHash('sha256').update(TOKEN).digest('hex');

function root(){
  return {
    session:{
      commandProtocol:2,
      expiresAt:NOW+60*60_000,
      capabilities:{officialOpsServerV2:true},
      officialInvite:{tokenHash:TOKEN_HASH,expiresAt:NOW+60*60_000,maxClaims:4},
      players:[
        {id:'official',name:'운영임원',status:'wait',isClubOfficial:true},
        {id:'official_b',name:'대체임원',status:'rest',isClubOfficial:true},
        {id:'late_official',name:'지각임원',status:'invited',isClubOfficial:true},
        {id:'member',name:'일반회원',status:'wait',isClubOfficial:false}
      ]
    }
  };
}

function claim(current,extra={}){
  return applyOfficialClaimTransaction(current,{
    clientId:'oc_1234567890abcdef',
    inviteToken:'',
    requestedPlayerId:'official',
    now:NOW,
    maxGrantMs:48*60*60_000,
    ...extra
  });
}

let current=root();
const rosterClaim=claim(current);
assert.strictEqual(rosterClaim.action,'commit','일반 회원 링크에서도 명부 임원은 운영 권한을 연결해야 합니다.');
assert.strictEqual(rosterClaim.officialPlayerId,'official','권한을 선택한 임원 ID에 묶어야 합니다.');
assert.strictEqual(current.officialClaims.oc_1234567890abcdef.claimMode,'roster','명부 기반 연결임을 서버에 기록해야 합니다.');
assert.strictEqual(current.officialClaims.oc_1234567890abcdef.officialPlayerName,'운영임원','임원 이름은 요청값이 아니라 서버 명부에서 가져와야 합니다.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(current.officialClaims.oc_1234567890abcdef,'inviteHash'),false,'명부 기반 권한은 관리자 초대 토큰 교체 때문에 끊기면 안 됩니다.');

const memberClaim=claim(root(),{requestedPlayerId:'member'});
assert.strictEqual(memberClaim.action,'abort','일반 회원은 같은 링크에서 운영 권한을 얻으면 안 됩니다.');
assert.strictEqual(memberClaim.failureCode,'permission-denied');

const lateClaim=claim(root(),{requestedPlayerId:'late_official'});
assert.strictEqual(lateClaim.action,'abort','현장 참가 등록 전 임원은 운영 권한을 얻으면 안 됩니다.');
assert.strictEqual(lateClaim.failureCode,'failed-precondition');

const legacyClaim=claim(root(),{inviteToken:TOKEN,requestedPlayerId:''});
assert.strictEqual(legacyClaim.action,'commit','기존 임원 전용 링크와 관리자 앱 연결은 계속 지원해야 합니다.');
assert.strictEqual(legacyClaim.officialPlayerId,'','기존 초대 토큰 연결은 특정 선수에 강제로 묶지 않아야 합니다.');

const boundLegacyRoot=root();
const boundLegacyClaim=claim(boundLegacyRoot,{inviteToken:TOKEN,requestedPlayerId:'official'});
assert.strictEqual(boundLegacyClaim.action,'commit','기존 임원 링크에서도 이름을 선택하면 정상 연결되어야 합니다.');
assert.strictEqual(boundLegacyClaim.officialPlayerId,'official','토큰과 임원 ID가 함께 오면 무기명 권한이 아니라 본인에게 묶어야 합니다.');
assert.strictEqual(boundLegacyRoot.officialClaims.oc_1234567890abcdef.claimMode,'roster','이름을 확인한 뒤에는 오래된 링크 토큰이 아니라 현재 명부를 권한 기준으로 삼아야 합니다.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(boundLegacyRoot.officialClaims.oc_1234567890abcdef,'inviteHash'),false,'명부 임원 권한은 운영 링크 교체 후에도 유지되어야 합니다.');

const staleTokenClaim=claim(root(),{inviteToken:'b'.repeat(48),requestedPlayerId:'official'});
assert.strictEqual(staleTokenClaim.action,'commit','예전 임원 링크로 들어왔어도 현재 명부 임원 본인 확인이 성공하면 공용 링크 흐름을 막으면 안 됩니다.');

const wrongToken=claim(root(),{inviteToken:'b'.repeat(48),requestedPlayerId:''});
assert.strictEqual(wrongToken.action,'abort','잘못된 기존 임원 토큰은 계속 거절해야 합니다.');

const switched=root();
assert.strictEqual(claim(switched).action,'commit');
const switchedClaim=claim(switched,{requestedPlayerId:'official_b',now:NOW+1000});
assert.strictEqual(switchedClaim.action,'commit','같은 기기에서 임원 이름을 바로잡으면 새 본인 권한으로 교체해야 합니다.');
assert.strictEqual(switched.officialClaims.oc_1234567890abcdef.officialPlayerId,'official_b');

const full=root();
full.officialClaims={};
for(let i=0;i<4;i++)full.officialClaims['other_'+i]={expiresAt:NOW+60_000};
const fullClaim=claim(full);
assert.strictEqual(fullClaim.action,'abort','허용된 임원 기기 수를 넘으면 새 연결을 추가하면 안 됩니다.');
assert.strictEqual(fullClaim.failureCode,'resource-exhausted');

const reconnect=root();
reconnect.officialClaims={
  old_official_device:{officialPlayerId:'official',claimedAt:NOW-5000,refreshedAt:NOW-4000,expiresAt:NOW+60_000},
  other_1:{officialPlayerId:'official_b',claimedAt:NOW-3000,refreshedAt:NOW-3000,expiresAt:NOW+60_000},
  other_2:{claimedAt:NOW-2000,refreshedAt:NOW-2000,expiresAt:NOW+60_000},
  other_3:{claimedAt:NOW-1000,refreshedAt:NOW-1000,expiresAt:NOW+60_000}
};
const reconnectClaim=claim(reconnect,{clientId:'new_official_device'});
assert.strictEqual(reconnectClaim.action,'commit','같은 임원이 브라우저나 홈화면 앱을 바꿔 다시 열 때 오래된 자기 연결을 교체할 수 있어야 합니다.');
assert.strictEqual(reconnect.officialClaims.old_official_device,undefined,'재접속 시 같은 임원의 가장 오래된 연결만 정리해야 합니다.');
assert.strictEqual(reconnect.officialClaims.new_official_device.officialPlayerId,'official');
assert.strictEqual(Object.keys(reconnect.officialClaims).length,4,'재접속으로 전체 연결 제한이 무한히 늘어나면 안 됩니다.');

const expired=root();
expired.session.officialInvite.expiresAt=NOW-1;
assert.strictEqual(claim(expired).action,'abort','종료된 LIVE에서는 명부 임원도 새 권한을 얻으면 안 됩니다.');

console.log('daily official roster claim regression ok');
