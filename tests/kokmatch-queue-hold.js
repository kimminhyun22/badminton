'use strict';
const assert=require('assert'), crypto=require('crypto');
const path=require('path');
const REPO=process.env.SIM_ENGINE_ROOT||path.join(__dirname,'..');
const {canonicalJson,issueOfficialGrant,refreshEvent}=require(`${REPO}/functions/daily-official-engine`);
const {replenishPrepared}=require(`${REPO}/functions/daily-server-matchmaker`);
const {applyCommandTransaction}=require(`${REPO}/functions/daily-official-command`);
const NOW=1_830_000_000_000,CHECKIN='DHOLD002',CLIENT='c',SECRET='s2';
const hash=v=>crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');
const mk=(id,name)=>({id,name,gender:'M',level:4,ageGroup:'40대',grade:'C',status:'wait',statusLabel:'wait',
  locked:false,currentMatchId:'',afterMatchStatus:'',games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,
  lastPlayedSeq:0,partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
  joinedAt:NOW,waitFrom:NOW,lastStatusAt:NOW-1000,restPausedMs:0,preArrivalVisible:false,
  registrationCancelled:false,isClubOfficial:id==='o',isTemporaryOfficial:false,isGuest:false,partnerName:'',partnerId:''});
const players=[mk('o','임원')]; for(let i=1;i<=15;i++)players.push(mk('p'+i,'선수'+i));
const grant=issueOfficialGrant({v:1,sid:CHECKIN,cid:CLIENT,pid:'o',iat:NOW-1000,exp:NOW+48*3600_000},SECRET);
let state={session:{serverSessionId:CHECKIN,commandProtocol:2,serverRevision:0,matchStartedAt:NOW,
  expiresAt:NOW+48*3600_000,officialInvite:{tokenHash:'a'.repeat(64),expiresAt:NOW+48*3600_000},
  capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true,officialQueueHoldV1:true},
  players,reservations:[],arrivalCandidates:[],serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
  event:{courts:2,nextTarget:2,serverExpectedGoal:0,completed:0,finishMode:false,operationStarted:true,
    queuePolicy:{official:2,auto:true},active:[],next:[],expected:[],serverStandby:[]}},
  officialClaims:{[CLIENT]:{clientId:CLIENT,expiresAt:NOW+48*3600_000,claimMode:'roster',officialPlayerId:'o'}}};
let i=1; const s=()=>state.session;
const submit=(extra,now)=>{const operationId=`h${i++}`;
  const stored={actorPlayerId:'o',actorPlayerName:'임원',createdAt:now,expiresAt:now+30*60_000,source:'t',operationId,...extra};
  const out=applyCommandTransaction(state,{storedCommand:stored,engineCommand:{...stored,officialGrantToken:grant},
    operationId,payloadHash:hash(stored),clientId:CLIENT,grantPlayerId:'o',now,checkinId:CHECKIN,grantSecret:SECRET});
  assert.strictEqual(out.action,'commit',out.failureMessage||''); state=out.current; return out;};
const nm=ids=>ids.map(id=>s().players.find(p=>p.id===id)?.name).join('+');
replenishPrepared(s(),{now:NOW,requestId:'i'}); refreshEvent(s(),NOW);
console.log('빈 코트 2개 · 대기열:', s().event.next.map(r=>`${r.idx}:${nm(r.playerIds)}[${r.cueState}]`).join(' | '));
const q0=s().event.next[0];
submit({type:'official-queue-hold',queueId:q0.queueId||q0.id,expectedPlayerIds:[...q0.playerIds]},NOW+1000);
refreshEvent(s(),NOW+1000);
console.log('\n1순위 일시정지 후');
console.log('  진행 중:', s().event.active.map(m=>`${m.court}코트 ${nm(m.playerIds)}`).join(' | ')||'없음');
console.log('  대기열:', s().event.next.map(r=>`${r.idx}:${nm(r.playerIds)}[${r.cueState}${r.restPass?'/일시정지':''}]`).join(' | '));
const heldStill=s().event.next.find(r=>r.restPass);
assert(heldStill,'일시정지 대진은 대기열에 남아야 합니다');
assert.strictEqual(heldStill.idx,1,'자리는 그대로여야 합니다');
assert(!s().event.active.some(m=>m.playerIds.some(id=>heldStill.playerIds.includes(id))),'일시정지 대진이 코트에 들어가면 안 됩니다');
assert(s().event.active.length>=1,'다음 순위가 자동 투입되어야 합니다');
console.log('\n재시작');
submit({type:'official-queue-resume',queueId:heldStill.queueId||heldStill.id,expectedPlayerIds:[...heldStill.playerIds]},NOW+2000);
refreshEvent(s(),NOW+2000);
console.log('  진행 중:', s().event.active.map(m=>`${m.court}코트 ${nm(m.playerIds)}`).join(' | '));
// 재시작하면 일시정지가 풀립니다. 코트가 이미 차 있으면 순서를 기다렸다 들어갑니다.
const resumed=s().event.next.find(r=>heldStill.playerIds.every(id=>(r.playerIds||[]).includes(id)));
const onCourt=s().event.active.some(m=>heldStill.playerIds.every(id=>m.playerIds.includes(id)));
assert(onCourt||(resumed&&!resumed.restPass),'재시작하면 일시정지가 풀려야 합니다.');
console.log('\nqueue hold regression ok');
