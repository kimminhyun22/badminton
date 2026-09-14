'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const root=process.env.MINTON_PERMISSION_ROOT
  ? path.resolve(process.env.MINTON_PERMISSION_ROOT)
  : path.resolve(__dirname,'..');
const {
  canonicalJson,
  issueOfficialGrant
}=require(path.join(root,'functions','daily-official-engine.js'));
const {applyCommandTransaction}=require(path.join(root,'functions','daily-official-command.js'));

const NOW=1_840_000_000_000;
const CHECKIN_ID='DPERM222';
const SECRET='player-create-permission-regression-secret';
const INVITE_HASH='a'.repeat(64);
const CLIENTS={admin:'admin_client',official:'official_client',helper:'helper_client'};

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function player(id,extra={}){
  return {
    id,name:id,grade:'C',level:4,gender:'M',ageGroup:'40대',status:'wait',statusLabel:'참가',
    games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    lastStatusAt:NOW-1000,waitFrom:NOW-60_000,currentMatchId:'',afterMatchStatus:'',
    locked:false,partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
    isGuest:false,isClubOfficial:false,isTemporaryOfficial:false,...extra
  };
}

function makeRoot(){
  return {
    session:{
      serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,
      expiresAt:NOW+30*24*60*60_000,
      officialInvite:{tokenHash:INVITE_HASH,expiresAt:NOW+30*24*60*60_000},
      capabilities:{officialOpsServerV2:true},
      players:[
        player('official',{isClubOfficial:true}),
        player('helper',{isTemporaryOfficial:true}),
        player('member')
      ],
      reservations:[],arrivalCandidates:[],serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
      event:{courts:1,nextTarget:0,completed:0,finishMode:false,operationStarted:false,
        queuePolicy:{official:0,auto:true},active:[],next:[],expected:[],serverStandby:[]}
    },
    requests:{},serverCommands:{},serverOps:{},
    officialClaims:{
      [CLIENTS.admin]:{clientId:CLIENTS.admin,claimMode:'invite',inviteHash:INVITE_HASH,
        claimNonce:'admin_nonce',expiresAt:NOW+60*60_000},
      [CLIENTS.official]:{clientId:CLIENTS.official,claimMode:'roster',officialPlayerId:'official',
        claimNonce:'official_nonce',expiresAt:NOW+60*60_000},
      [CLIENTS.helper]:{clientId:CLIENTS.helper,claimMode:'roster',officialPlayerId:'helper',
        claimNonce:'helper_nonce',expiresAt:NOW+60*60_000}
    }
  };
}

function submit(role,playerId){
  const current=makeRoot();
  const clientId=CLIENTS[role];
  const actorPlayerId=role==='admin'?'':role;
  const operationId=`permission_create_${role}`;
  const stored={
    type:'official-player-create',operationId,commandProtocol:2,
    actorPlayerId,actorPlayerName:role,playerId,
    name:`추가_${role}`,grade:'B',level:5,gender:'M',ageGroup:'40대',
    isGuest:false,isClubOfficial:true,status:'planned',
    createdAt:NOW,expiresAt:NOW+30*60_000,source:'permission-regression'
  };
  const claimNonce=current.officialClaims[clientId].claimNonce;
  const token=issueOfficialGrant({
    v:1,sid:CHECKIN_ID,cid:clientId,iat:NOW-1000,exp:NOW+60*60_000,cn:claimNonce,
    ...(actorPlayerId?{pid:actorPlayerId}:{})
  },SECRET);
  return applyCommandTransaction(current,{
    storedCommand:stored,engineCommand:{...stored,officialGrantToken:token},
    operationId,payloadHash:hash(stored),clientId,
    grantPlayerId:actorPlayerId,grantClaimNonce:claimNonce,
    now:NOW,checkinId:CHECKIN_ID,grantSecret:SECRET
  });
}

for(const role of ['official','helper']){
  const outcome=submit(role,`created_${role}`);
  assert.strictEqual(outcome.action,'commit',`${role}의 선수 추가 자체는 허용되어야 합니다.`);
  assert.strictEqual(outcome.terminal.status,'applied');
  const created=outcome.current.session.players.find(row=>row.id===`created_${role}`);
  assert(created,`${role}가 추가한 선수를 찾아야 합니다.`);
  assert.strictEqual(created.isClubOfficial,false,`${role}가 요청 필드로 임원 자격을 만들면 안 됩니다.`);
  assert.strictEqual(outcome.terminal.serverResult.playerCreate.isClubOfficial,false,
    '관리자 추종 화면에도 서버가 확정한 비임원 값이 전달되어야 합니다.');
}

const adminOutcome=submit('admin','created_admin');
assert.strictEqual(adminOutcome.action,'commit','관리자 연결의 선수 추가가 적용되어야 합니다.');
assert.strictEqual(adminOutcome.terminal.status,'applied');
assert.strictEqual(adminOutcome.current.session.players.find(row=>row.id==='created_admin').isClubOfficial,true,
  '관리자 연결은 명부의 임원 자격을 도착 전 선수에게 옮길 수 있어야 합니다.');
assert.strictEqual(adminOutcome.terminal.serverResult.playerCreate.isClubOfficial,true,
  '관리자 추종 화면에 서버가 확정한 임원 값이 전달되어야 합니다.');

function extractFunction(source,name){
  const match=new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert(match,`${name} 함수를 찾아야 합니다.`);
  const start=match.index;
  const open=source.indexOf('{',start);
  let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`${name} 함수의 끝을 찾지 못했습니다.`);
}

const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const bulkRegister=extractFunction(daily,'_dailyRegisterPreArrivalsViaServer');
assert(bulkRegister.includes('isClubOfficial:!!m.isClubOfficial'),
  '관리자 도착 전 일괄 등록은 명부의 임원 표시를 서버에 보내야 합니다.');
const adminFollower=extractFunction(daily,'_dailyApplyAdminOperation');
const createBranch=adminFollower.slice(adminFollower.indexOf("if(req.type==='official-player-create')"),
  adminFollower.indexOf("if(req.type==='official-manual-match')"));
assert(createBranch.includes('isClubOfficial:info.isClubOfficial===true'),
  '관리자 추종 화면은 요청값이 아니라 서버가 확정한 임원 값을 적용해야 합니다.');
assert(!createBranch.includes('isClubOfficial:req.isClubOfficial'),
  '관리자 추종 화면이 조작 가능한 요청값을 다시 살리면 안 됩니다.');
assert(!/\bisClubOfficial\s*:/.test(extractFunction(checkin,'sendOfficialPlayerCreate')),
  '임원 화면의 선수 추가 전송기는 임원 자격 필드를 제공하지 않아야 합니다.');

console.log('daily player create permission regression ok');
