'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=process.env.DAILY_GUEST_INLINE_RENAME_SOURCE_ROOT
  ? path.resolve(process.env.DAILY_GUEST_INLINE_RENAME_SOURCE_ROOT)
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

const adminCode=functionSource(daily,'_dailyGuestRenameButton','setDailyPlayerTool');
const admin={
  _dailyPaused:false,
  esc:value=>String(value),
  _dailyIcon:name=>`<svg data-icon="${name}"></svg>`
};
vm.createContext(admin);
vm.runInContext(`${adminCode}\nthis.renderGuest=_dailyGuestRenameButton;`,admin);
assert(admin.renderGuest({id:'g1',name:'게스트가',isGuest:true}).includes("dailyRenamePlayer('g1')"),
  '관리자 게스트 카드에서 이름 수정을 바로 실행해야 합니다.');
assert(admin.renderGuest({id:'m1',name:'회원가',isGuest:false})==='',
  '명부 회원에게는 당일 이름 수정 버튼을 보이면 안 됩니다.');
admin._dailyPaused=true;
assert(admin.renderGuest({id:'g1',name:'게스트가',isGuest:true}).includes('disabled'),
  '진행 일시정지 중에는 이름 수정도 막아야 합니다.');

const officialCode=functionSource(checkin,'officialGuestRenameButton','setOfficialPartnerPick');
const official={
  sendingKey:'',claimingOfficial:false,
  eventFlowPaused:()=>false,
  esc:value=>String(value),
  obIcon:name=>`<svg data-icon="${name}"></svg>`
};
vm.createContext(official);
vm.runInContext(`${officialCode}\nthis.renderGuest=officialGuestRenameButton;`,official);
const actor={id:'o1',name:'임원',isClubOfficial:true};
const guest={id:'g1',name:'게스트가',isGuest:true};
assert(official.renderGuest(actor,guest,'current').includes("sendOfficialPlayerRename('o1','g1')"),
  '임원 명단도 게스트 이름 옆에서 바로 수정해야 합니다.');
assert(official.renderGuest({id:'h1',isClubOfficial:false},guest,'current')==='',
  '임시 도우미나 일반 회원에게 이름 수정 권한을 넘기면 안 됩니다.');
assert(official.renderGuest(actor,{id:'m1',name:'회원가',isGuest:false},'current')==='',
  '임원 화면에서도 명부 회원은 인라인 수정 대상이 아닙니다.');
assert(official.renderGuest(actor,guest,'party')==='',
  '뒷풀이 명단에는 운영용 이름 수정 버튼을 중복 노출하면 안 됩니다.');

assert(daily.includes('${_dailyGuestRenameButton(p)}'),'관리자 선수 이름 옆에 수정 버튼을 그려야 합니다.');
assert(checkin.includes('${officialGuestRenameButton(player,item,selected.key)}'),'임원 명단 이름 옆에도 수정 버튼을 그려야 합니다.');
assert(!daily.includes("mode('rename'")&&!checkin.includes("setOfficialOverviewMode('rename')"),
  '게스트 인라인 수정과 상단 이름 변경 모드를 둘 다 두면 안 됩니다.');
assert(css.includes('.daily-guest-rename')&&checkin.includes('.official-guest-rename'),
  '관리자·임원 수정 버튼 모두 모바일 크기 스타일이 있어야 합니다.');

console.log('daily guest inline rename regression ok');
