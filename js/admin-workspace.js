/* Optional Google account. Multiple devices edit field patches, not whole snapshots. */
(async function(){
'use strict';
async function loadScripts(){window.MintonAdminReady=fn=>fn();for(const old of document.querySelectorAll('script[data-admin-src]')){const s=document.createElement('script');s.src=old.dataset.adminSrc;await new Promise((resolve,reject)=>{s.onload=resolve;s.onerror=()=>reject(Error('앱 파일을 읽지 못했습니다. 새로고침해 주세요.'));document.body.append(s);});}}
const dom=new Promise(r=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',r,{once:true}):r());
if(location.pathname.endsWith('/skill-review.html')&&location.hash){await dom;await loadScripts();return;}
const C=MintonWorkspaceCore,M=MintonWorkspaceMerge,raw=window.localStorage,session=window.sessionStorage;
let uid=raw.getItem(C.MODE)||'',device=session.getItem('minton_workspace_device_v2')||crypto.randomUUID().replace(/-/g,'');
document.documentElement.classList.add('account-starting');
if(navigator.locks){let reserved=false;while(!reserved){reserved=await new Promise(resolve=>navigator.locks.request('minton-workspace-tab-'+device,{ifAvailable:true},lock=>{resolve(!!lock);return lock?new Promise(()=>{}):undefined;}));if(!reserved)device=crypto.randomUUID().replace(/-/g,'');}}else device=crypto.randomUUID().replace(/-/g,'');
session.setItem('minton_workspace_device_v2',device);
let store,auth,api,call,rosterCall,gameCall,user,bar,dialog,busy=false,locked=false,hydrating=false,booted=false,saveTimer,games={},closedGames={},authSetup;
const active=()=>!locked&&(!uid||(auth?.currentUser?.uid===uid&&raw.getItem(C.MODE)===uid));
const status=text=>{if(bar)bar.querySelector('span').textContent=text;};
function show(title,message,actions){if(!dialog){dialog=document.createElement('dialog');dialog.className='account-panel';document.body.append(dialog);}dialog.replaceChildren();const h=document.createElement('h2');h.textContent=title;const p=document.createElement('p');p.textContent=message;p.setAttribute('role','status');dialog.append(h,p);for(const [label,fn] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){p.textContent=e.message||'연결을 확인해 주세요.';}finally{b.disabled=false;}};dialog.append(b);}if(!dialog.open)dialog.showModal();}
function freeze(reason){locked=true;store?.lock();document.documentElement.classList.add('account-starting');try{if(window.firebase?.database)firebase.database().goOffline();}catch(e){}status(reason);show('계정 확인',reason,[['다시 열기',()=>location.reload()],['비회원으로 돌아가기',()=>logout()]]);}
function download(values,label){if(uid&&auth?.currentUser?.uid!==uid)throw Error('계정이 변경되었습니다.');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({format:'minton-workspace-v2',values},null,2)],{type:'application/json'}));a.download=label+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function setupAuth(){
 if(authSetup)return authSetup;
 authSetup=(async()=>{const root='https://www.gstatic.com/firebasejs/10.12.0/',appApi=await import(root+'firebase-app.js');api=await import(root+'firebase-auth.js');const f=await import(root+'firebase-functions.js');const app=appApi.getApps().find(a=>a.name==='roster-cloud')||appApi.initializeApp(KokMatchFirebaseConfig,'roster-cloud');auth=api.getAuth(app);await auth.authStateReady();user=auth.currentUser;
 const endpoint=name=>{const fn=f.httpsCallable(f.getFunctions(app,'us-central1'),name);return async data=>{const expected=auth.currentUser?.uid;if(!expected)throw Error('Google로 로그인해 주세요.');const out=(await fn({...data,device:data.device||device})).data;if(auth.currentUser?.uid!==expected)throw Error('계정이 변경되었습니다.');return out;};};
 call=endpoint('adminWorkspace');gameCall=endpoint('adminWorkspaceGameCommand');rosterCall=endpoint('clubRosterCloud');api.onAuthStateChanged(auth,u=>{user=u;if(uid&&u?.uid!==uid)freeze('계정이 변경되어 이전 자료를 잠갔습니다.');});})();
 try{return await authSetup;}catch(e){authSetup=null;throw e;}
}
function editable(values){const out={...values};if(games.daily)delete out.kokmatch_daily_v1;if(games.team)delete out.badminton_team_bracket_v7;return out;}
function capture(){if(booted&&!hydrating)window.MintonCaptureWorkspace?.();}
function install(values){const d=store.read();hydrating=true;try{store.meta({values:{...d.values,...values}});for(const key of Object.keys(d.values))if(!Object.hasOwn(values,key)&&!(key==='kokmatch_daily_v1'&&games.daily)&&!(key==='badminton_team_bracket_v7'&&games.team))store.storage.removeItem(key);}finally{hydrating=false;}}
function render(){if(!booted)return;const focused=document.activeElement,id=focused?.id,value=focused?.value,start=focused?.selectionStart,end=focused?.selectionEnd;hydrating=true;try{window.MintonApplyWorkspace?.(games);}finally{hydrating=false;}if(id){const next=document.getElementById(id);if(next&&value!==undefined&&focused?.matches('input:not([readonly]),textarea')){next.value=value;next.focus({preventScroll:true});try{next.setSelectionRange(start,end);}catch(e){}}}}
function adopt(remote,baseValues,localValues){
 games=remote.games||games;closedGames=remote.closedGames||closedGames;
 const remoteValues=remote.values||store.read().base||{},rebased=M.rebase(M.decode(editable(baseValues)),M.decode(editable(localValues)),M.decode(editable(remoteValues)));
 const oldConflicts=store.read().conflicts||[];
 for(const prior of oldConflicts){const current=M.at(M.decode(editable(remoteValues)),prior.path),after=M.at(M.decode(editable(localValues)),prior.path);if(!M.same(current,after)){M.put(rebased.doc,prior.path,after);if(!rebased.conflicts.some(c=>M.same(c.path,prior.path)))rebased.conflicts.push({...prior,current,after});}}
 const values=M.encode(rebased.doc,{},Date.now());
 store.meta({base:remoteValues,revision:remote.revision,conflicts:rebased.conflicts});install(values);render();
 if(rebased.conflicts.length)status('같은 항목이 변경되었습니다 · 계정 메뉴에서 확인');return rebased.conflicts;
}
let syncTask;
async function sync(){if(syncTask)return syncTask;syncTask=syncOnce();try{return await syncTask;}finally{syncTask=null;}}
async function syncOnce(){
 if(!uid||!active()||busy||hydrating)return;busy=true;
 try{
  capture();let d=store.read();
  if(d.pending){
   const sent=d.pending,out=await call(sent.request);const local=store.snapshot();store.meta({pending:null});
   if(out.receipt.status==='conflict'){store.backup('동시 수정 충돌');adopt(out,d.base||{},local);}
   else adopt(out,sent.snapshot,local);
  }
  const before=store.read(),remote=await call({action:'read',sinceRevision:before.revision});games=remote.games||games;
  if(remote.values)adopt(remote,before.base||{},store.snapshot());
  d=store.read();
  {
   const snapshot=store.snapshot(),changes=M.diff(M.decode(editable(d.base||{})),M.decode(editable(snapshot))).filter(op=>!(d.conflicts||[]).some(c=>c.path.every((k,i)=>op.path[i]===k)||op.path.every((k,i)=>c.path[i]===k)));
   if(changes.length){const request={action:'patch',operationId:crypto.randomUUID().replace(/-/g,''),createdAt:Date.now(),device,changes};store.meta({pending:{request,snapshot}});const out=await call(request),local=store.snapshot();store.meta({pending:null});if(out.receipt.status==='conflict'){store.backup('동시 수정 충돌');adopt(out,d.base||{},local);}else adopt(out,snapshot,local);}
  }
  await window.MintonAccountGames?.refresh();
  status(store.read().gameConflict?'경기 변경 충돌 · 계정 메뉴에서 확인':(store.read().conflicts||[]).length?'동시 수정 확인 필요 · 계정 메뉴':'Google 연결됨 · 서버에 저장됨');
 }catch(e){if(/unauthenticated|permission-denied|resource-exhausted/.test(e.code||''))freeze(e.message||'계정 연결을 다시 확인해 주세요.');else status('기기에 보관됨 · 연결되면 다시 저장');}
 finally{busy=false;}
}
function conflicts(){const d=store.read();if(d.gameConflict){show('경기 요청 확인',d.gameConflict.reason,[['확인',()=>{store.meta({gameConflict:null});dialog.close();}],['기기 자료 백업',()=>download(d,'minton-game-recovery')]]);return;}if(!d.conflicts?.length){show('동기화 상태','충돌한 항목이 없습니다.',[['닫기',()=>dialog.close()]]);return;}
 const item=d.conflicts[0],path=item.path.filter(k=>!['json','$rows','$value'].includes(k)).join(' / ');
 const resolve=async keep=>{capture();store.backup('충돌 항목 선택 전');const current=store.read(),doc=M.decode(editable(current.values));if(!keep)M.put(doc,item.path,item.current);store.meta({conflicts:current.conflicts.filter(c=>!M.same(c.path,item.path))});install(M.encode(doc));render();dialog.close();await sync();};
 if(item.derived){show('대진 생성 조건이 바뀌었습니다','다른 기기에서 참가자나 설정을 변경했습니다. 내 대진은 백업에 보관하고 최신 설정으로 다시 준비해 주세요.',[['최신 설정으로 다시 준비',()=>resolve(false)],['기기 자료 백업',()=>download(d.values,'minton-bracket-conflict')],['나중에 확인',()=>dialog.close()]]);return;}
 show('같은 항목이 변경되었습니다',path+'\n서버 값: '+JSON.stringify(item.current.value??'삭제')+'\n내 수정: '+JSON.stringify(item.after.value??'삭제'),[['서버 값 사용',()=>resolve(false)],['내 수정으로 다시 저장',()=>resolve(true)],['기기 자료 백업',()=>download(d.values,'minton-conflict')],['나중에 확인',()=>dialog.close()]]);
}
async function logout(){if(uid&&store){capture();store.backup('로그아웃 전');if(active()&&navigator.onLine)await sync();store.lock();}locked=true;raw.removeItem(C.MODE);if(auth)await api.signOut(auth);location.reload();}
async function connect(){capture();await setupAuth();if(!auth.currentUser){show('Google로 기기 연결','로그인 없이 쓰던 자료는 그대로 보관합니다.',[['Google로 로그인',async()=>{await api.signInWithPopup(auth,new api.GoogleAuthProvider());await connect();}],['취소',()=>dialog.close()]]);return;}
 const remote=await call({action:'read'}),guest=C.collect(raw);
 let liveCopy=false;try{liveCopy=!!JSON.parse(guest.kokmatch_daily_v1||'{}').checkinId||!!JSON.parse(guest.badminton_team_bracket_v7||'{}').liveOn;}catch(e){}
 if(remote.revision){show('계정 자료 이어서 사용',user.email+' 계정의 자료를 엽니다. 이 기기의 비회원 원본은 그대로 둡니다.',[['계정 자료 열기',()=>{raw.setItem(C.MODE,user.uid);location.reload();}],['취소',()=>dialog.close()]]);return;}
 show('이 기기 자료 연결',user.email+' 계정에 현재 명부·설정·대진을 복사할까요? 본인이 운영하는 자료인지 확인해 주세요.'+(liveCopy?' 현재 공유한 회원 링크는 원본에 남습니다. 계정에서 게시하면 새 회원 링크가 만들어집니다.':''),[['확인하고 연결',async()=>{if(!C.same(guest,C.collect(raw)))throw Error('기기 자료가 변경되었습니다. 다시 연결해 주세요.');raw.setItem(C.PREFIX+'guest-backup',JSON.stringify({at:Date.now(),values:guest}));await call({action:'import',values:guest,operationId:crypto.randomUUID().replace(/-/g,''),createdAt:Date.now()});raw.setItem(C.MODE,user.uid);location.reload();}],['취소',()=>dialog.close()]]);
}
async function legacy(){const docs=(await rosterCall({action:'list'})).clubs||[];show('이전 서버 명부 가져오기','없는 클럽만 추가합니다. 기존 명부는 덮어쓰지 않습니다.',[['없는 명부 추가',async()=>{if(!active())throw Error('계정을 확인해 주세요.');const r=JSON.parse(localStorage.getItem('badminton_rosters_v1')||'{"clubs":[]}');store.backup('이전 명부 가져오기');for(const d of docs)if(!r.clubs.some(c=>c.id===d.club.id))r.clubs.push(d.club);localStorage.setItem('badminton_rosters_v1',JSON.stringify(r));dialog.close();await sync();render();}],['닫기',()=>dialog.close()]]);}
window.MintonAdminWorkspace={get connected(){return !!uid;},get active(){return active();},get hydrating(){return hydrating;},get games(){return games;},get closedGames(){return closedGames;},get device(){return device;},get store(){return store;},setGames:value=>{games=value||{};},gameCall:async data=>{if(!active())throw Error('계정을 확인해 주세요.');return gameCall(data);},flush:sync,open:async()=>{if(!uid)return connect();if(!active())return freeze('계정을 다시 확인해 주세요.');show('Google 계정 · 동기화',user?.email||'같은 계정의 기기에서 함께 사용합니다.',[['지금 동기화',()=>sync()],['동시 수정 확인',()=>conflicts()],['이전 서버 명부 가져오기',()=>legacy()],['자료 백업 받기',()=>download(store.snapshot(),'minton-account-backup')],['로그아웃 · 비회원으로 사용',()=>logout()],['닫기',()=>dialog.close()]]);}};
await dom;bar=document.createElement('div');bar.id='accountBar';const text=document.createElement('span');text.textContent=uid?'계정 자료 확인 중':'이 기기에 저장 · 로그인 없이 사용 중';const button=document.createElement('button');button.textContent=uid?'계정 · 동기화':'Google로 기기 연결';button.onclick=()=>MintonAdminWorkspace.open().catch(e=>show('연결 확인',e.message,[['닫기',()=>dialog.close()]]));bar.append(text,button);document.body.prepend(bar);
try{
 if(uid){await setupAuth();if(user?.uid!==uid)throw Error('로그인 계정을 확인해 주세요.');store=C.createStore(raw,uid+':'+device,()=>{if(booted&&!hydrating&&!busy){status('기기에 저장됨 · 동기화 중');clearTimeout(saveTimer);saveTimer=setTimeout(sync,800);}});Object.defineProperty(window,'localStorage',{value:store.storage});Object.defineProperty(window,'sessionStorage',{value:C.createStore(session,uid+':'+device).storage});const d=store.read();try{const remote=await call({action:'read'});games=remote.games||{};closedGames=remote.closedGames||{};adopt(remote,d.base||{},d.values||{});}catch(e){if(navigator.onLine||!Object.keys(d.values||{}).length)throw e;status('오프라인 · 이 기기에 보관');}if(window.firebase){if(typeof _fbInit==='function')_fbInit();C.guardNetwork(firebase,active,new Set(),(ref,name,args)=>window.MintonAccountGames?.guardWrite(ref,name,args));}}
 await loadScripts();booted=true;document.documentElement.classList.remove('account-starting');if(uid){await window.MintonAccountGames?.refresh();status('Google 연결됨 · 여러 기기에서 함께 사용');setInterval(()=>{if(!document.hidden)sync();},5000);}
}catch(e){freeze(e.message||'자료를 불러오지 못했습니다.');}
window.addEventListener('online',()=>sync());document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
window.addEventListener('storage',e=>{if(e.key===C.MODE&&raw.getItem(C.MODE)!==uid){freeze('다른 탭에서 계정이 바뀌었습니다.');location.reload();}});
window.addEventListener('pageshow',e=>{if(uid&&e.persisted){freeze('계정을 다시 확인합니다.');location.reload();}});
})();
