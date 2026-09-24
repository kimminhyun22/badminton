const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'..');
const context={window:{},document:{querySelector:()=>null},localStorage:{getItem:()=>null},console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js/storage.js'),'utf8'),context);
const choose=context.window.KokMatchRosterBridge.preferredClubIndex;
const clubs=[{id:'a',name:'가클럽',members:[{}]},{id:'b',name:'나클럽',members:[{}]}];
const players=[{club:'나클럽'}];
assert.equal(choose(clubs,players),1,'첫 명부가 아닌 등록 명부 선택');
assert.equal(choose(clubs,players,{clubId:'a'}),1,'다른 링크 선택보다 현재 명단 우선');
assert.equal(choose(clubs,players,{clubName:'가클럽'}),0,'확정된 세션 클럽 우선');
assert.equal(choose([...clubs].reverse(),players),0,'명부 순서가 바뀌어도 유지');
assert.equal(choose(clubs,JSON.parse(JSON.stringify(players))),1,'재실행한 명단도 동일');
assert.equal(choose(clubs,[{club:'가클럽',isGuest:true},...players]),1,'게스트 소속 제외');
assert.equal(choose(clubs,[],{clubId:'b'}),1,'선수 없이 저장된 명부만 있으면 복원');
assert.equal(choose([clubs[0]],players),0,'삭제된 명부 대신 사용 가능한 명부');
assert.equal(choose([],players),-1,'명부가 없으면 직접 등록');
for(const [file,start,end] of [['team.js','function openImportModal()','function openImportFromClub'],['daily.js','function dailyImportRoster()','function dailyCapture']]){
  const src=fs.readFileSync(path.join(root,'js',file),'utf8');
  const offset=src.indexOf(start);
  const body=src.slice(offset,src.indexOf(end,offset)>offset?src.indexOf(end,offset):offset+2200);
  assert(body.includes('preferredClubIndex?.('),`${file} 선수 추가에 공통 선택 연결`);
}
console.log('participant source club regression ok');
