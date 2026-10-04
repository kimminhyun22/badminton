'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),override=process.env.MINTON_FIELD_BASELINE;
const engine=require(override?path.join(override,'daily-official-engine.js'):'../functions/daily-official-engine');
const member=fs.readFileSync(override?path.join(override,'checkin.html'):path.join(root,'checkin.html'),'utf8');
function fn(name){const start=member.indexOf('function '+name+'(');assert(start>=0,name);const end=member.slice(start+1).search(/\n(?:async )?function /);return member.slice(start,end<0?undefined:start+1+end);}
const now=1900000000000,secret='synthetic-field-regression',sid='FIELD004';
const levels=[6.5,1,1,1,1,1,1,1,5,5,4.5,4.5];
const players=levels.map((level,i)=>({id:String(i),name:'합성'+i,level,gender:'M',ageGroup:'20대',status:i>=1&&i<=4?'playing':'wait',currentMatchId:i>=1&&i<=4?'m1':'',games:0,waitFrom:now-60000,joinedAt:now-60000,partnerCount:{},opponentCount:{}}));players[0].fairExpected=2;players[1].isClubOfficial=true;
const queue={id:'prepared',queueId:'prepared',serverGenerated:true,t1Ids:['8','10'],t2Ids:['9','11'],playerIds:['8','10','9','11'],type:'남복'};
const s={serverSessionId:sid,expiresAt:now+3600000,players,reservations:[],serverRuntime:{},capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true},event:{courts:3,operatingCourtIds:[1,2,3],operationStarted:true,active:[{id:'m1',court:1,seq:1,startedAt:now-10000,t1Ids:['1','2'],t2Ids:['3','4'],playerIds:['1','2','3','4'],type:'남복'}],next:[queue],expected:[],serverStandby:[],queuePolicy:{auto:true,official:3}}};
const grant=engine.issueOfficialGrant({v:1,sid,cid:'synthetic',pid:'1',iat:now-1000,exp:now+3600000},secret);
const r=engine.applyOfficialRequest(s,{type:'official-court-complete',operationId:'field-complete',actorPlayerId:'1',officialGrantToken:grant,matchId:'m1',court:1,expectedStartedAt:now-10000,expectedPlayerIds:['1','2','3','4'],createdAt:now,expiresAt:now+60000},{now,requestId:'field-complete',checkinId:sid,grantSecret:secret});
assert.equal(r.status,'applied',r.reason);assert.deepStrictEqual(r.result.autoEnter.playerIds,queue.playerIds,'입장할 때 게시된 다음 대진의 네 선수를 그대로 유지');
console.log('PASS published queue unchanged through actual completion and auto entry');
// Use actual rendered player button and actual re-enable routine, including the mid-request render.
const nodes=[];const c={document:{getElementById:()=>({classList:{toggle(){}},textContent:''}),querySelectorAll:s=>s==='[data-official-action]'?nodes:[]},officialServerReady:()=>true,officialServerCapable:()=>true,operatorConnected:()=>true,eventFlowPaused:()=>false,sendingKey:'pending',claimingOfficial:false,esc:String};vm.createContext(c);vm.runInContext([fn('teamLines'),fn('refreshOfficialConnection'),fn('courtBadge')].join('\n'),c);
const html=c.teamLines({t1:['합성1','합성2'],t2:['합성3','합성4'],t1Ids:['1','2'],t2Ids:['3','4']},{actorId:'op',matchId:'m1',disabled:true,pending:false});
assert(html.includes('data-official-action'),'처리 중 렌더한 선수 버튼도 재활성화 대상');for(const tag of html.match(/<button[^>]*>/g)||[])nodes.push({disabled:true,dataset:{officialPending:tag.includes('data-official-pending="true"')?'true':'false'}});c.sendingKey='';c.refreshOfficialConnection();assert(nodes.every(n=>!n.disabled));nodes[0].dataset.officialPending='true';c.refreshOfficialConnection();assert(nodes[0].disabled,'아직 처리 중인 경기만 잠금 유지');
const cc={officialActor:()=>({id:'helper',isTemporaryOfficial:true}),session:{event:{active:[{id:'m1',court:1}]}},officialOperatingCourtIds:()=>[1,2,3],_officialReplaceCtx:null,_officialReplaceSheetShow:()=>{},toast:m=>{throw Error(m)}};vm.createContext(cc);vm.runInContext(fn('sendOfficialCourtRenumber'),cc);cc.sendOfficialCourtRenumber('helper','m1');assert.equal(cc._officialReplaceCtx.kind,'courtRenumber','서버가 허용하는 운영진도 코트 변경 선택 가능');
const rows={officialOperatingCourtIds:()=>[1,2,3]};vm.createContext(rows);vm.runInContext(fn('eventCourtRows'),rows);const out=rows.eventCourtRows({active:[{id:'a',court:1},{id:'b',court:3}]});assert.deepStrictEqual(Array.from(out,x=>x.court),[1,2,3]);assert.equal(out[1].match,null,'동시 종료 직후 비어도2코트 자리 유지');
console.log('PASS member busy-button recovery, temporary official court picker, and empty operating court visibility');
