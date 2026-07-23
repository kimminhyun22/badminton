const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

const buildSource=functionSource(daily,'_dailyOfficialCheckinUrl','_dailyCheckinPath');
const buildSandbox={
  location:{origin:'https://kimminhyun22.github.io',pathname:'/badminton/index.html'},
  encodeURIComponent
};
vm.createContext(buildSandbox);
vm.runInContext(`
let _dailyCheckinId='DG5LFNNK';
let _dailyOfficialInviteToken='${'a'.repeat(48)}';
${buildSource}
this.makeUrl=_dailyOfficialCheckinUrl;
`,buildSandbox);
const officialUrl=buildSandbox.makeUrl();
assert.strictEqual(officialUrl,`https://kimminhyun22.github.io/badminton/checkin.html?official=DG5LFNNK.${'a'.repeat(48)}`,'임원 링크는 메신저가 자르기 어려운 단일 매개변수여야 합니다.');
assert(!officialUrl.includes('&'),'임원 권한 토큰을 두 번째 쿼리 매개변수로 보내면 안 됩니다.');

const parseSource=functionSource(checkin,'officialInviteFromSearch','clearOfficialInviteFromAddress');
const parseSandbox={URLSearchParams};
vm.createContext(parseSandbox);
vm.runInContext(`${parseSource}\nthis.parse=officialInviteFromSearch;`,parseSandbox);
const bundled=parseSandbox.parse(`?official=DG5LFNNK.${'b'.repeat(48)}`);
assert.deepStrictEqual({...bundled},{checkinId:'DG5LFNNK',token:'b'.repeat(48),bundled:true},'새 단일 매개변수 임원 링크를 복원해야 합니다.');
const legacy=parseSandbox.parse(`?id=DG5LFNNK&op=${'c'.repeat(48)}`);
assert.deepStrictEqual({...legacy},{checkinId:'',token:'c'.repeat(48),bundled:false},'기존 임원 링크도 계속 열려야 합니다.');

const claimStart=checkin.indexOf('async function claimOfficialInvite');
const claimEnd=checkin.indexOf('async function retryOfficialInvite',claimStart+1);
assert(claimStart>=0&&claimEnd>claimStart,'claimOfficialInvite 함수 범위를 찾을 수 있어야 합니다.');
const claimSource=checkin.slice(claimStart,claimEnd);
assert(claimSource.includes('clearOfficialInviteFromAddress();'),'권한 교환 성공 후 주소에서 초대 토큰을 지워야 합니다.');
assert(claimSource.indexOf('officialGrantToken=grant.grantToken')<claimSource.indexOf('clearOfficialInviteFromAddress();'),'권한 저장보다 먼저 주소 토큰을 지우면 안 됩니다.');
assert(claimSource.includes('officialGrantError=officialCallableError(e)'),'연결 실패 이유를 임원 화면에 남겨야 합니다.');
assert(claimSource.includes("if(officialClaimPlayerId===String(actor.id))return activeClaim;"),'같은 임원의 자동 연결 중 버튼을 눌러도 같은 권한 교환 작업을 기다려야 합니다.');
assert(claimSource.includes('playerId:actor.id'),'명부에서 선택한 임원 ID를 서버 권한에 묶어야 합니다.');
assert(claimSource.includes("if(String(grant.playerId||'')!==String(actor.id))"),'서버가 선택한 임원 본인에게 묶인 권한을 돌려줬는지 확인해야 합니다.');

const bootStart=checkin.indexOf('function boot()');
const bootEnd=checkin.indexOf('\nboot();',bootStart);
const bootSource=checkin.slice(bootStart,bootEnd);
assert(bootSource.includes('officialInviteFromSearch(location.search)'),'회원 페이지 시작 시 단일 매개변수 임원 링크를 해석해야 합니다.');
assert(!bootSource.includes('history.replaceState'),'서비스워커 재시작 전에 임원 토큰을 주소에서 지우면 안 됩니다.');
assert(checkin.includes('onclick="retryOfficialInvite()"'),'권한 교환 실패 시 화면에서 바로 다시 연결할 수 있어야 합니다.');
const selectSource=functionSource(checkin,'selectPlayerIdentity','isRapidStatusChange');
assert(selectSource.includes('if(p.isClubOfficial)claimOfficialInvite(p)'),'명부 임원이 이름을 선택하면 같은 회원 링크에서 즉시 운영 권한을 연결해야 합니다.');
assert(bootSource.includes('selectedOfficialPlayer()')&&bootSource.includes('claimOfficialInvite(official)'),'앱을 다시 열어도 저장된 임원 본인 이름으로 권한을 자동 복원해야 합니다.');

const commonShareSource=functionSource(daily,'dailyShareCheckinLink','dailyShareOfficialLink');
assert(commonShareSource.includes('회원·임원 공용 링크'),'공유 문구는 링크 하나가 회원과 임원 모두에게 쓰인다는 점을 알려야 합니다.');
assert(commonShareSource.includes("navigator.share({title:'콕매치 민턴LIVE 공용 링크',text,url})"),'공용 링크를 Web Share URL 필드에도 전달해야 합니다.');
assert(commonShareSource.includes('const clipboardText=`${text}\\n\\n${url}`'),'공유 시 URL 필드와 본문이 중복되지 않고 클립보드 대체 경로에만 주소를 붙여야 합니다.');
assert(index.includes('회원·임원 공용 링크 공유'),'관리자 화면에는 공용 링크 공유 동작이 분명히 보여야 합니다.');
assert(!index.includes('onclick="dailyShareOfficialLink()"'),'관리자 화면에 별도 임원 링크 버튼을 남기면 안 됩니다.');

const shareSource=functionSource(daily,'dailyShareOfficialLink','dailyResumeCheckin');
assert(shareSource.includes("navigator.share({title:'콕매치 민턴LIVE 임원 운영',text,url})"),'Web Share에서 URL을 별도 필드로 전달해야 합니다.');
assert(shareSource.includes('await _dailyEnsureAdminGrant(true)'),'공유 직전에 서버 권한 교환이 실제로 작동하는지 확인해야 합니다.');

const pushSource=functionSource(checkin,'pushOfficialRequest','sendOfficialPartnerReservation');
assert(pushSource.includes('if(!claimed&&!officialServerReady())return false;'),'권한 교환 실패의 상세 안내를 일반 재열기 경고가 덮으면 안 됩니다.');
assert(pushSource.includes("e?.code==='functions/permission-denied'"),'만료된 권한 토큰은 반복 전송하지 말고 폐기해야 합니다.');
assert(pushSource.includes('sendingKey||claimingOfficial'),'임원 권한 자동 연결 중에는 운영 명령을 겹쳐 보내면 안 됩니다.');
assert(checkin.includes("official-connect-recovery ${connectingGrant?'connecting':''}"),'정상적인 자동 연결 중 화면을 빨간 오류 상태처럼 보여주면 안 됩니다.');

const claimSandbox={setTimeout};
vm.createContext(claimSandbox);
vm.runInContext(`
let pendingOfficialInvite='';
let session={capabilities:{officialOpsServerV2:true},commandProtocol:2,players:[{id:'official',name:'운영임원',isClubOfficial:true,status:'wait'}]};
let officialClaimPromise=null;
let officialClaimPlayerId='';
let claimingOfficial=false;
let officialGrantError='';
let officialGrantToken='';
let officialGrantPlayerId='';
let checkinId='DG5LFNNK';
let calls=0;
let lastPayload=null;
const localStorage={setItem(){}};
const sessionStorage={removeItem(){}};
const firebase={functions:()=>({httpsCallable:()=>async payload=>{
  calls+=1;
  lastPayload=payload;
  await new Promise(resolve=>setTimeout(resolve,5));
  return {data:{grantToken:'grant',expiresAt:Date.now()+60000,playerId:'official'}};
}})};
function isSampleMode(){return false;}
function render(){}
function selectedOfficialPlayer(){return session.players[0];}
function officialClientId(){return 'oc_1234567890abcdef';}
function officialGrantKey(){return 'grant-key';}
function clearOfficialInviteFromAddress(){}
function toast(){}
function officialCallableError(error){return error.message;}
${claimSource}
this.claim=claimOfficialInvite;
this.callCount=()=>calls;
this.payload=()=>lastPayload;
`,claimSandbox);

const raceSandbox={setTimeout};
vm.createContext(raceSandbox);
vm.runInContext(`
let pendingOfficialInvite='';
let session={capabilities:{officialOpsServerV2:true},commandProtocol:2,players:[
  {id:'official_a',name:'임원A',isClubOfficial:true,status:'wait'},
  {id:'official_b',name:'임원B',isClubOfficial:true,status:'wait'}
]};
let selectedId='official_a';
let officialClaimPromise=null;
let officialClaimPlayerId='';
let claimingOfficial=false;
let officialGrantError='';
let officialGrantToken='';
let officialGrantPlayerId='';
let checkinId='DG5LFNNK';
let calls=[];
let savedPlayerId='';
const localStorage={setItem(key,value){savedPlayerId=JSON.parse(value).playerId||'';}};
const sessionStorage={removeItem(){}};
const firebase={functions:()=>({httpsCallable:()=>payload=>new Promise(resolve=>calls.push({payload,resolve}))})};
function isSampleMode(){return false;}
function render(){}
function selectedOfficialPlayer(){return session.players.find(player=>player.id===selectedId)||null;}
function officialClientId(){return 'oc_1234567890abcdef';}
function officialGrantKey(){return 'grant-key';}
function clearOfficialInviteFromAddress(){}
function toast(){}
function officialCallableError(error){return error.message;}
${claimSource}
this.claim=claimOfficialInvite;
this.select=id=>{selectedId=id;};
this.pendingCount=()=>calls.length;
this.resolveNext=()=>{const call=calls.shift();call.resolve({data:{grantToken:'grant_'+call.payload.playerId,expiresAt:Date.now()+60000,playerId:call.payload.playerId}});};
this.savedPlayer=()=>savedPlayerId;
`,raceSandbox);

(async()=>{
  const results=await Promise.all([claimSandbox.claim(),claimSandbox.claim()]);
  assert.deepStrictEqual(Array.from(results),[true,true],'동시에 시작한 두 호출이 같은 성공 결과를 받아야 합니다.');
  assert.strictEqual(claimSandbox.callCount(),1,'권한 교환 함수는 동시에 한 번만 호출되어야 합니다.');
  assert.strictEqual(claimSandbox.payload().playerId,'official','일반 회원 링크의 임원 선택 ID를 서버로 보내야 합니다.');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(claimSandbox.payload(),'inviteToken'),false,'일반 회원 링크는 별도 임원 토큰 없이 명부 권한을 연결해야 합니다.');

  const firstClaim=raceSandbox.claim();
  await new Promise(resolve=>setTimeout(resolve,0));
  raceSandbox.select('official_b');
  const secondClaim=raceSandbox.claim();
  assert.strictEqual(raceSandbox.pendingCount(),1,'첫 임원 권한 연결 중에는 두 번째 서버 요청을 겹쳐 보내면 안 됩니다.');
  raceSandbox.resolveNext();
  assert.strictEqual(await firstClaim,false,'이름이 바뀐 뒤 도착한 이전 임원 응답은 저장하면 안 됩니다.');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.strictEqual(raceSandbox.pendingCount(),1,'이전 응답 정리 후 현재 선택한 임원의 권한을 새로 연결해야 합니다.');
  raceSandbox.resolveNext();
  assert.strictEqual(await secondClaim,true,'마지막으로 선택한 임원의 권한 연결은 완료해야 합니다.');
  assert.strictEqual(raceSandbox.savedPlayer(),'official_b','빠른 이름 변경 뒤에는 마지막 임원 권한만 기기에 저장해야 합니다.');
  console.log('daily official link regression ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
