(function(root){
  'use strict';
  const KEY='badminton_rosters_v1';
  function validate(data){
    if(data?._lvVersion!==2||!Array.isArray(data.clubs)||!data.clubs.length||data.clubs.length>10)throw Error('명부 형식을 확인해 주세요.');
    const names=new Set();
    for(const c of data.clubs){
      if(typeof c.name!=='string'||!c.name.trim()||c.name.length>80||names.has(c.name)||typeof c.id!=='string'||!Array.isArray(c.members)||c.members.length>500)throw Error('클럽 명부를 확인해 주세요.');
      names.add(c.name);
      for(const m of c.members){
        if(typeof m.name!=='string'||!m.name.trim()||m.name.length>80||!['S','A','B','C','D','E'].includes(m.grade)||!['남','여','M','F'].includes(m.gender)||!Number.isFinite(m.level)||!Number.isInteger(m.skillStep||0)||Math.abs(m.skillStep||0)>4)throw Error('회원 정보를 확인해 주세요.');
      }
    }
    return data;
  }
  function merge(current,incoming){
    validate(incoming);
    if(current&&(!Array.isArray(current.clubs)||current._lvVersion!==2))throw Error('기존 명부를 먼저 백업해 주세요.');
    const clubs=[...(current?.clubs||[])];
    for(const c of incoming.clubs){
      const i=clubs.findIndex(old=>old.name===c.name);
      if(i<0)clubs.push(c);else clubs[i]={...c,id:clubs[i].id};
    }
    if(clubs.length>10)throw Error('클럽은 최대 10개까지 복구할 수 있습니다.');
    return {...(current||{}),_lvVersion:2,clubs};
  }
  function save(storage,incoming,expected){
    const raw=storage.getItem(KEY);
    if(raw!==expected)throw Error('명부가 변경됐습니다. 다시 확인해 주세요.');
    const merged=merge(raw?JSON.parse(raw):null,incoming),serialized=JSON.stringify(merged);
    if(raw)storage.setItem(KEY+'_before_recovery',raw);
    storage.setItem(KEY,serialized);
    if(storage.getItem(KEY)!==serialized)throw Error('기기에 저장하지 못했습니다.');
    return merged;
  }
  const api={validate,merge,save};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!root.document)return;
  root.openRosterRecovery=function(initial=''){
    let incoming=null,expected=null;
    const dialog=document.createElement('dialog');
    dialog.style.cssText='width:min(440px,calc(100% - 32px));box-sizing:border-box;border:1px solid #dce4e0;border-radius:8px;padding:20px;color:#24332f;';
    dialog.innerHTML='<h2 style="margin:0 0 12px;font-size:20px">명부 복구</h2><p style="font-size:14px;line-height:1.6">현재 열린 앱에 명부를 저장합니다. 설치한 앱에 복구하려면 그 앱의 명부 → 복구에서 이 링크를 붙여 넣으세요.</p><label style="display:block;font-size:14px">복구 링크<input aria-label="복구 링크" style="box-sizing:border-box;width:100%;font-size:16px;padding:12px;margin:8px 0;border:1px solid #bdccc5;border-radius:8px"></label><p role="status" style="white-space:pre-line;font-size:14px;line-height:1.7"></p><div style="display:flex;gap:8px"><button type="button" data-close style="min-height:44px;flex:1">닫기</button><button type="button" data-read style="min-height:44px;flex:2;background:#245e50;color:white;border:0;border-radius:8px">명부 확인</button></div>';
    const input=dialog.querySelector('input'),status=dialog.querySelector('[role=status]'),button=dialog.querySelector('[data-read]');
    input.value=initial;
    input.oninput=()=>{incoming=null;button.textContent='명부 확인';};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.onclose=()=>dialog.remove();
    button.onclick=async()=>{
      button.disabled=true;
      try{
        if(incoming){
          if(localStorage.getItem(KEY)!==expected)throw Error('명부가 변경됐습니다. 링크를 다시 확인해 주세요.');
          const conflicts=(expected?JSON.parse(expected).clubs:[]).filter(c=>incoming.clubs.some(n=>n.name===c.name));
          if(conflicts.length&&!confirm('같은 이름의 클럽 명부를 복구본으로 교체합니다. 기존 명부는 기기에 백업됩니다.\n'+conflicts.map(c=>c.name).join(', ')+'\n계속할까요?'))return;
          save(localStorage,incoming,expected);
          if(typeof loadRosters==='function')loadRosters();
          if(typeof renderClubList==='function')renderClubList();
          if(typeof switchNav==='function')switchNav('roster');
          status.textContent=incoming.clubs.map(c=>c.name+' '+c.members.length+'명').join('\n')+'\n복구 완료 · 이 기기에 저장됐습니다.';
          input.disabled=true;button.hidden=true;
          return;
        }
        const value=input.value.trim();
        const url=new URL(value);
        if(url.origin!==location.origin||!url.pathname.startsWith('/badminton/'))throw Error('민턴LIVE 복구 링크를 넣어 주세요.');
        const match=/^#roster-recovery=(rsvp_[A-F0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(url.hash);
        if(!match)throw Error('복구 링크를 확인해 주세요.');
        const response=await fetch('https://kokmatch-23b31-default-rtdb.firebaseio.com/live/'+match[1]+'.json',{cache:'no-store'});
        if(!response.ok)throw Error('복구 자료를 불러오지 못했습니다.');
        const packet=await response.json();
        if(packet?.kind!=='roster-recovery'||packet.expiresAt<Date.now())throw Error('복구 링크가 만료됐거나 자료가 없습니다.');
        const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        const key=await crypto.subtle.importKey('raw',bytes(match[2]),'AES-GCM',false,['decrypt']);
        const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(packet.iv)},key,bytes(packet.ciphertext));
        const payload=JSON.parse(new TextDecoder().decode(plain));
        if(!Number.isFinite(payload.expiresAt)||payload.expiresAt<Date.now())throw Error('복구 링크가 만료됐습니다.');
        incoming=validate(payload.roster);expected=localStorage.getItem(KEY);
        status.textContent=incoming.clubs.map(c=>c.name+' '+c.members.length+'명').join('\n')+'\n기존 경기와 참가자 상태는 변경하지 않습니다.';
        button.textContent='명부 복구하기';
      }catch(e){incoming=null;button.textContent='명부 확인';status.textContent=e.name==='OperationError'?'복구 키가 맞지 않거나 자료가 손상됐습니다.':e.message;}
      finally{button.disabled=false;}
    };
    document.body.append(dialog);dialog.showModal();
  };
  if(location.hash.startsWith('#roster-recovery=')){
    const link=location.href;history.replaceState(null,'',location.pathname+location.search);
    root.openRosterRecovery(link);
  }
})(typeof window==='undefined'?globalThis:window);
