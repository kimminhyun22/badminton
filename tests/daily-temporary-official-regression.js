'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {
  canonicalJson,
  issueOfficialGrant
}=require('../functions/daily-official-engine');
const {applyCommandTransaction}=require('../functions/daily-official-command');
const {applyOfficialClaimTransaction}=require('../functions/daily-official-claim');

const NOW=1_800_000_000_000;
const CHECKIN_ID='DTEMP222';
const SECRET='temporary-official-test-secret-32-bytes';
const INVITE_TOKEN='a'.repeat(48);
const INVITE_HASH=crypto.createHash('sha256').update(INVITE_TOKEN).digest('hex');
const OFFICIAL_CLIENT='official_client_1234567890abcdef';
const HELPER_CLIENT='helper_client_1234567890abcdef';
const ADMIN_CLIENT='admin_client_1234567890abcdef';

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function player(id,options={}){
  return {
    id,
    name:options.name||id.toUpperCase(),
    grade:'C',
    level:4,
    gender:'M',
    ageGroup:'40대',
    status:options.status||'wait',
    statusLabel:'참가',
    games:0,
    fairExpected:0,
    lastStatusAt:NOW-1000,
    waitFrom:NOW-60_000,
    currentMatchId:'',
    afterMatchStatus:'',
    locked:false,
    isGuest:!!options.isGuest,
    isClubOfficial:!!options.isClubOfficial,
    isTemporaryOfficial:!!options.isTemporaryOfficial
  };
}

function root(){
  return {
    session:{
      serverSessionId:CHECKIN_ID,
      commandProtocol:2,
      serverRevision:0,
      expiresAt:NOW+48*60*60_000,
      capabilities:{officialOpsServerV2:true,temporaryOfficialV1:true},
      officialInvite:{tokenHash:INVITE_HASH,expiresAt:NOW+48*60*60_000,maxClaims:12},
      players:[
        player('official',{name:'정식임원',isClubOfficial:true}),
        player('helper',{name:'도우미후보'}),
        player('member2',{name:'일반회원2'}),
        player('member3',{name:'일반회원3'}),
        player('member4',{name:'일반회원4'}),
        player('member5',{name:'일반회원5'}),
        player('member6',{name:'일반회원6'}),
        player('guest',{name:'게스트',isGuest:true})
      ],
      reservations:[],
      arrivalCandidates:[],
      serverRuntime:{holds:{},nextSeq:1},
      event:{
        courts:3,
        completed:0,
        active:[],
        next:[],
        expected:[],
        serverStandby:[],
        queuePolicy:{official:0}
      }
    },
    officialClaims:{
      [OFFICIAL_CLIENT]:{
        clientId:OFFICIAL_CLIENT,
        claimMode:'roster',
        officialPlayerId:'official',
        officialPlayerName:'정식임원',
        claimedAt:NOW-1000,
        expiresAt:NOW+60*60_000
      },
      [ADMIN_CLIENT]:{
        clientId:ADMIN_CLIENT,
        claimMode:'invite',
        inviteHash:INVITE_HASH,
        claimedAt:NOW-1000,
        expiresAt:NOW+60*60_000
      }
    }
  };
}

function grantToken(clientId,playerId='',claimNonce=''){
  return issueOfficialGrant({
    v:1,
    sid:CHECKIN_ID,
    cid:clientId,
    iat:NOW-1000,
    exp:NOW+60*60_000,
    ...(claimNonce?{cn:claimNonce}:{}),
    ...(playerId?{pid:playerId}:{})
  },SECRET);
}

function command(type,operationId,actorPlayerId,extra={}){
  return {
    type,
    operationId,
    commandProtocol:2,
    actorPlayerId,
    actorPlayerName:actorPlayerId==='official'?'정식임원':actorPlayerId==='helper'?'도우미후보':'관리자',
    createdAt:NOW,
    expiresAt:NOW+30*60_000,
    source:'temporary-official-regression',
    ...extra
  };
}

function submit(current,stored,clientId,playerId=''){
  const claimNonce=String(current.officialClaims?.[clientId]?.claimNonce||'');
  const token=grantToken(clientId,playerId,claimNonce);
  return applyCommandTransaction(current,{
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:token},
    operationId:stored.operationId,
    payloadHash:hash(stored),
    clientId,
    grantPlayerId:playerId,
    grantClaimNonce:claimNonce,
    now:NOW,
    checkinId:CHECKIN_ID,
    grantSecret:SECRET
  });
}

let current=root();
const grant=submit(current,command(
  'official-temporary-grant',
  'operation_temp_grant_001',
  'official',
  {playerId:'helper',playerName:'도우미후보',expectedIsTemporaryOfficial:false}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(grant.terminal.status,'applied','정식 임원은 운영 도우미를 즉시 지정할 수 있어야 합니다.');
current=grant.current;
assert.strictEqual(current.session.players.find(item=>item.id==='helper').isTemporaryOfficial,true);
assert.strictEqual(grant.terminal.serverResult.temporaryOfficial.enabled,true);

const helperClaim=applyOfficialClaimTransaction(current,{
  clientId:HELPER_CLIENT,
  inviteToken:'',
  requestedPlayerId:'helper',
  now:NOW+1,
  maxGrantMs:48*60*60_000
});
assert.strictEqual(helperClaim.action,'commit','지정된 운영 도우미는 같은 회원 링크에서 권한을 연결해야 합니다.');
assert.strictEqual(helperClaim.officialPlayerId,'helper');
const firstHelperClaimNonce=helperClaim.claimNonce;

const helperStatus=submit(current,command(
  'official-player-status',
  'operation_temp_status_001',
  'helper',
  {
    playerId:'member2',
    playerName:'일반회원2',
    status:'rest',
    expectedStatus:'wait',
    expectedCurrentMatchId:'',
    expectedLastStatusAt:NOW-1000
  }
),HELPER_CLIENT,'helper');
assert.strictEqual(helperStatus.terminal.status,'applied','운영 도우미는 경기 운영 명령을 정식 임원처럼 처리할 수 있어야 합니다.');
current=helperStatus.current;
assert.strictEqual(current.session.players.find(item=>item.id==='member2').status,'rest');

const delegatedByHelper=submit(current,command(
  'official-temporary-grant',
  'operation_temp_chain_001',
  'helper',
  {playerId:'member3',playerName:'일반회원3',expectedIsTemporaryOfficial:false}
),HELPER_CLIENT,'helper');
assert.strictEqual(delegatedByHelper.terminal.status,'rejected','운영 도우미가 다른 도우미를 지정하는 권한 연쇄를 허용하면 안 됩니다.');
assert.match(delegatedByHelper.terminal.reason,/관리자 또는 정식 클럽 임원/);

const adminGrant=submit(current,command(
  'official-temporary-grant',
  'operation_temp_admin_001',
  '',
  {playerId:'member3',playerName:'일반회원3',expectedIsTemporaryOfficial:false}
),ADMIN_CLIENT,'');
assert.strictEqual(adminGrant.terminal.status,'applied','관리자 앱의 무기명 관리자 권한도 운영 도우미를 지정할 수 있어야 합니다.');
current=adminGrant.current;
assert.strictEqual(current.session.players.find(item=>item.id==='member3').isTemporaryOfficial,true);

const concurrentDuplicateGrant=submit(current,command(
  'official-temporary-grant',
  'operation_temp_concurrent_grant_001',
  'official',
  {playerId:'member3',playerName:'일반회원3',expectedIsTemporaryOfficial:false}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(concurrentDuplicateGrant.terminal.status,'rejected','두 운영자가 같은 회원을 동시에 지정해도 한 번만 적용되어야 합니다.');
assert.match(concurrentDuplicateGrant.terminal.reason,/이미 바뀌었습니다/);

const guestGrant=submit(current,command(
  'official-temporary-grant',
  'operation_temp_guest_001',
  'official',
  {playerId:'guest',playerName:'게스트',expectedIsTemporaryOfficial:false}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(guestGrant.terminal.status,'rejected','게스트에게 세션 운영 권한을 부여하면 안 됩니다.');

for(const id of ['member4','member5']){
  const outcome=submit(current,command(
    'official-temporary-grant',
    `operation_temp_limit_${id}`,
    'official',
    {playerId:id,playerName:id.toUpperCase(),expectedIsTemporaryOfficial:false}
  ),OFFICIAL_CLIENT,'official');
  assert.strictEqual(outcome.terminal.status,'applied');
  current=outcome.current;
}
assert.strictEqual(current.session.players.filter(item=>item.isTemporaryOfficial&&!item.isClubOfficial).length,4);
const overLimit=submit(current,command(
  'official-temporary-grant',
  'operation_temp_limit_fifth',
  'official',
  {playerId:'member6',playerName:'일반회원6',expectedIsTemporaryOfficial:false}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(overLimit.terminal.status,'rejected','운영 도우미는 현장 보조에 필요한 소수 인원으로 제한해야 합니다.');
assert.match(overLimit.terminal.reason,/최대 4명/);

const revoke=submit(current,command(
  'official-temporary-revoke',
  'operation_temp_revoke_001',
  'official',
  {playerId:'helper',playerName:'도우미후보',expectedIsTemporaryOfficial:true}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(revoke.terminal.status,'applied','정식 임원은 운영 도우미 권한을 즉시 해제할 수 있어야 합니다.');
current=revoke.current;
assert.strictEqual(current.session.players.find(item=>item.id==='helper').isTemporaryOfficial,false);
assert.strictEqual(current.officialClaims[HELPER_CLIENT],undefined,'해제 시 이미 발급된 도우미 기기 연결도 즉시 폐기해야 합니다.');

const concurrentDuplicateRevoke=submit(current,command(
  'official-temporary-revoke',
  'operation_temp_concurrent_revoke_001',
  'official',
  {playerId:'helper',playerName:'도우미후보',expectedIsTemporaryOfficial:true}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(concurrentDuplicateRevoke.terminal.status,'rejected','두 운영자가 같은 권한을 동시에 해제해도 두 번째 요청은 현재 상태를 보고 멈춰야 합니다.');
assert.match(concurrentDuplicateRevoke.terminal.reason,/이미 바뀌었습니다/);

const revokedReuse=submit(current,command(
  'official-player-status',
  'operation_temp_reuse_001',
  'helper',
  {
    playerId:'member3',
    playerName:'일반회원3',
    status:'rest',
    expectedStatus:'wait',
    expectedCurrentMatchId:'',
    expectedLastStatusAt:NOW-1000
  }
),HELPER_CLIENT,'helper');
assert.strictEqual(revokedReuse.action,'abort','해제된 도우미가 기존 서명 토큰을 재사용해도 명령을 실행하면 안 됩니다.');
assert.strictEqual(revokedReuse.failureCode,'permission-denied');

const regrant=submit(current,command(
  'official-temporary-grant',
  'operation_temp_regrant_001',
  'official',
  {playerId:'helper',playerName:'도우미후보',expectedIsTemporaryOfficial:false}
),OFFICIAL_CLIENT,'official');
assert.strictEqual(regrant.terminal.status,'applied');
current=regrant.current;
const helperReclaim=applyOfficialClaimTransaction(current,{
  clientId:HELPER_CLIENT,
  inviteToken:'',
  requestedPlayerId:'helper',
  claimNonce:'new_helper_claim_nonce',
  now:NOW+2000,
  maxGrantMs:48*60*60_000
});
assert.strictEqual(helperReclaim.action,'commit');
const staleStored=command(
  'official-player-status',
  'operation_temp_stale_token_001',
  'helper',
  {
    playerId:'member3',
    playerName:'일반회원3',
    status:'rest',
    expectedStatus:'wait',
    expectedCurrentMatchId:'',
    expectedLastStatusAt:NOW-1000
  }
);
const staleToken=grantToken(HELPER_CLIENT,'helper',firstHelperClaimNonce);
const staleAfterRegrant=applyCommandTransaction(current,{
  storedCommand:staleStored,
  engineCommand:{...staleStored,officialGrantToken:staleToken},
  operationId:staleStored.operationId,
  payloadHash:hash(staleStored),
  clientId:HELPER_CLIENT,
  grantPlayerId:'helper',
  grantClaimNonce:firstHelperClaimNonce,
  now:NOW+2000,
  checkinId:CHECKIN_ID,
  grantSecret:SECRET
});
assert.strictEqual(staleAfterRegrant.action,'abort','재지정 뒤에는 해제 전 오래된 권한 토큰을 다시 사용할 수 없어야 합니다.');
assert.match(staleAfterRegrant.failureMessage,/연결이 갱신/);

const ordinaryClaim=applyOfficialClaimTransaction(root(),{
  clientId:'ordinary_client_1234567890abcdef',
  inviteToken:'',
  requestedPlayerId:'member2',
  now:NOW,
  maxGrantMs:48*60*60_000
});
assert.strictEqual(ordinaryClaim.action,'abort','지정되지 않은 일반 회원은 운영 권한을 얻으면 안 됩니다.');

const checkinSource=fs.readFileSync(path.join(__dirname,'..','checkin.html'),'utf8');
const dailySource=fs.readFileSync(path.join(__dirname,'..','js','daily.js'),'utf8');
assert(checkinSource.includes('isLiveOperatorPlayer'),'회원 화면은 정식 임원과 운영 도우미를 같은 운영 권한 경로로 판단해야 합니다.');
assert(checkinSource.includes('officialTemporaryToolsHtml'),'정식 임원 화면에 운영 도우미 지정 도구가 있어야 합니다.');
assert(checkinSource.includes("if(!actor?.isClubOfficial)return toast('정식 클럽 임원만 운영 도우미"),'도우미 화면에서 재위임 기능을 사용할 수 없어야 합니다.');
assert(dailySource.includes('dailySetTemporaryOfficial'),'관리자 화면에서도 운영 도우미를 즉시 지정·해제할 수 있어야 합니다.');
assert(dailySource.includes('isTemporaryOfficial:!!p.isTemporaryOfficial'),'임시 권한이 현재 민턴라이브 세션에만 게시되어야 합니다.');
assert(dailySource.split('_dailyClearTemporaryOfficials()').length-1>=4,'링크 종료·만료·교체 시 임시 권한을 지워 다음 세션으로 넘기면 안 됩니다.');
assert(dailySource.includes('if(player.isClubOfficial&&player.isTemporaryOfficial){'),'정식 임원으로 승격된 회원의 임시 권한 표시는 정리해야 합니다.');

console.log('daily temporary official regression ok');
