'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=process.env.DAILY_PLAYER_INLINE_REMOVE_SOURCE_ROOT
  ? path.resolve(process.env.DAILY_PLAYER_INLINE_REMOVE_SOURCE_ROOT)
  : path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css','app.css'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾지 못했습니다.`);
  return src.slice(start,end);
}

const adminCode=functionSource(daily,'_dailyPlayerRemoveButton','setDailyPlayerTool');
const admin={
  _dailyPaused:false,
  _dailyNormalizeStatus:value=>String(value||''),
  esc:value=>String(value),
  _dailyIcon:name=>`<svg data-icon="${name}"></svg>`
};
vm.createContext(admin);
vm.runInContext(`${adminCode}\nthis.renderRemove=_dailyPlayerRemoveButton;`,admin);
assert(admin.renderRemove({id:'p1',name:'선수가',status:'wait'}).includes("dailyRemovePlayer('p1')"),
  '관리자 선수 이름 옆에서 삭제를 바로 실행해야 합니다.');
assert(admin.renderRemove({id:'p1',name:'선수가',status:'playing'}).includes('disabled'),
  '경기중 선수 삭제 버튼은 비활성화해야 합니다.');
admin._dailyPaused=true;
assert(admin.renderRemove({id:'p1',name:'선수가',status:'wait'}).includes('disabled'),
  '진행 일시정지 중에는 선수 삭제를 막아야 합니다.');

const officialCode=functionSource(checkin,'officialPlayerRemoveButton','setOfficialPartnerPick');
const official={
  sendingKey:'',claimingOfficial:false,
  eventFlowPaused:()=>false,
  esc:value=>String(value),
  obIcon:name=>`<svg data-icon="${name}"></svg>`
};
vm.createContext(official);
vm.runInContext(`${officialCode}\nthis.renderRemove=officialPlayerRemoveButton;`,official);
const actor={id:'o1',name:'임원',isClubOfficial:true};
const target={id:'p1',name:'선수가',status:'wait'};
assert(official.renderRemove(actor,target,'current').includes("sendOfficialPlayerRemove('o1','p1')"),
  '임원 선수 명단에서도 이름 옆 삭제를 바로 실행해야 합니다.');
assert(official.renderRemove({id:'h1',isClubOfficial:false},target,'current')==='',
  '임시 도우미나 일반 회원에게 선수 삭제 권한을 넘기면 안 됩니다.');
assert(official.renderRemove(actor,target,'party')==='',
  '뒷풀이 명단에는 선수 삭제 버튼을 중복 노출하면 안 됩니다.');
assert(official.renderRemove(actor,{...target,status:'playing'},'current').includes('disabled'),
  '임원 화면에서도 경기중 선수 삭제 버튼은 비활성화해야 합니다.');

assert(daily.includes('${_dailyPlayerRemoveButton(p)}'),'관리자 선수 이름 옆에 삭제 버튼을 그려야 합니다.');
assert(checkin.includes('${officialPlayerRemoveButton(player,item,selected.key)}'),'임원 명단 이름 옆에도 삭제 버튼을 그려야 합니다.');
assert(!daily.includes("mode('remove'")&&!checkin.includes("setOfficialOverviewMode('remove')"),
  '인라인 삭제와 상단 삭제 모드를 둘 다 두면 안 됩니다.');
assert(functionSource(daily,'dailyRemovePlayer','dailySetTemporaryOfficial').includes('confirm('),
  '관리자 삭제는 확인창을 거쳐야 합니다.');
assert(functionSource(checkin,'sendOfficialPlayerRemove','sendOfficialSettingsCourts').includes('confirm('),
  '임원 삭제는 확인창을 거쳐야 합니다.');
assert(css.includes('.daily-player-remove-inline')&&checkin.includes('.official-player-remove-inline'),
  '관리자·임원 삭제 버튼 모두 모바일 크기 스타일이 있어야 합니다.');

console.log('daily player inline remove regression ok');
