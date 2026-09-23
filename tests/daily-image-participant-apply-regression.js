'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js/daily.js'),'utf8');
function extractFunction(name){
  const start=daily.indexOf(`async function ${name}(`);
  assert(start>=0,`${name} 함수를 찾지 못했습니다.`);
  const brace=daily.indexOf('{',start);
  let depth=0,quote='',escaped=false;
  for(let i=brace;i<daily.length;i++){
    const char=daily[i];
    if(quote){
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char===quote)quote='';
      continue;
    }
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    if(char==='}'&&--depth===0)return daily.slice(start,i+1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

(async()=>{
  const roster=[
    {memberId:'m1',name:'회원가',grade:'B',gender:'남',ageGroup:'40대',level:5,isClubOfficial:false},
    {memberId:'m2',name:'회원나',grade:'C',gender:'여',ageGroup:'30대',level:3,isClubOfficial:true}
  ];
  const alerts=[];
  const sandbox={
    _dailyBlockServerSync:()=>false,_dailyCanChangeRoster:()=>true,
    rosters:{clubs:[{name:'테스트클럽',members:roster}]},_dailyImportClubIdx:0,
    _dailySessionClubName:'',_dailyCheckinId:'',_dailyPlayers:[],_dailyNext:{old:true},
    _dailyNormalizeStatus:value=>value,
    _dailyGender:value=>value==='여'?'F':'M',_dailyGenderLabel:value=>value==='F'?'여':'남',
    gradeToLevel:grade=>({S:7,A:6,B:5,C:4,D:3,E:2})[grade]||4,
    _rsvpMemberId:row=>`id:${row.name}`,
    _dailyNormalize:row=>({id:`p:${row.name}`,...row}),
    _dailyMarkLiveAddition:()=>{},dailySave:()=>{},dailyRender:()=>{},dailyMaybeAutoAssign:()=>{},
    _dailySyncArrivalCandidates:()=>{},document:{getElementById:()=>({classList:{add:()=>{}}})},
    alert:message=>alerts.push(message),console
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction('dailyApplyImageImportResult')};this.apply=dailyApplyImageImportResult;`,sandbox);
  await sandbox.apply({
    members:[{...roster[0],status:'wait'},{...roster[1],status:'planned'}],
    guests:[{name:'게스트가',grade:'A',gender:'남',ageGroup:'50대',isGuest:true,status:'wait'}],
    counts:{vote:1,comment:1,guest:1,total:3}
  });
  assert.strictEqual(sandbox._dailyPlayers.length,3,'캡처 확정 회원과 게스트를 모두 등록해야 합니다.');
  assert.strictEqual(sandbox._dailyPlayers.find(row=>row.name==='회원나').status,'planned','지각 회원은 도착 전이어야 합니다.');
  assert.strictEqual(sandbox._dailyPlayers.find(row=>row.name==='게스트가').isGuest,true,'게스트 표시는 유지해야 합니다.');
  assert(alerts[0].includes('3명을 등록')&&alerts[0].includes('투표 1 · 댓글 추가 1 · 게스트 1'),'등록 결과 집계를 한 번에 알려야 합니다.');
  console.log('daily image participant apply regression ok');
})().catch(error=>{console.error(error);process.exit(1);});
