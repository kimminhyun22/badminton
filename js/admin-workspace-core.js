/* Storage boundary shared by browser and isolated regression tests. */
(function(root){
  'use strict';
  const PREFIX='minton_workspace_v1:',MODE='minton_workspace_mode_v1';
  const KEYS=new Set(['badminton_rosters_v1','badminton_bracket_v7','badminton_team_bracket_v7','badminton_slots_v1','badminton_team_liveId','badminton_daily_liveId','badminton_liveId','badminton_team_quizId','badminton_team_quizHistory','kokmatch_daily_v1','kokmatch_daily_checkin_id','kokmatch_daily_checkin_created_at','kokmatch_daily_preparation_drafts_v1','kokmatch_club_skill_links_v1','kokmatch_live_roster_daily_v1','kokmatch_live_roster_team_v1','kokmatch_live_roster_shared_v1','kokmatch_rsvp_id','kokmatch_rsvp_title','kokmatch_rsvp_club_id','kokmatch_rsvp_guest_limit','kokmatch_team_rsvp_id','kokmatch_team_rsvp_title','kokmatch_team_rsvp_title_auto','kokmatch_team_rsvp_club_id','kokmatch_team_rsvp_created_at','kokmatch_team_rsvp_history']);
  const syncKey=k=>KEYS.has(k);
  const appKey=k=>/^(badminton_|kokmatch_|minton_roster_|daily_)/.test(k);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const same=(a,b)=>JSON.stringify(Object.entries(a||{}).sort())===JSON.stringify(Object.entries(b||{}).sort());
  function collect(raw){const values={};for(let i=0;i<raw.length;i++){const key=raw.key(i);if(syncKey(key))values[key]=raw.getItem(key);}return values;}
  function createStore(raw,uid,onWrite=()=>{}){
    const key=PREFIX+encodeURIComponent(uid),read=()=>JSON.parse(raw.getItem(key)||'{"values":{},"local":{}}');
    let blocked=false;
    const write=doc=>{if(blocked)throw Error('계정 변경 중에는 저장할 수 없습니다.');raw.setItem(key,JSON.stringify(doc));};
    const storage={getItem(k){if(k.startsWith(PREFIX)||k===MODE)return null;if(!appKey(k))return raw.getItem(k);if(blocked)return null;const d=read();return (syncKey(k)?d.values:d.local||{})[k]??null;},setItem(k,v){if(k.startsWith(PREFIX)||k===MODE)throw Error('Protected key');if(!appKey(k))return raw.setItem(k,v);const d=read(),field=syncKey(k)?'values':'local';d[field]||={};d[field][k]=String(v);write(d);if(syncKey(k))onWrite();},removeItem(k){if(k.startsWith(PREFIX)||k===MODE)throw Error('Protected key');if(!appKey(k))return raw.removeItem(k);const d=read();delete d.values[k];if(d.local)delete d.local[k];write(d);if(syncKey(k))onWrite();},clear(){for(const k of Object.keys(read().values))storage.removeItem(k);},key(i){return Object.keys({...read().values,...read().local})[i]??null;},get length(){return Object.keys({...read().values,...read().local}).length;}};
    return {storage,read,lock(){blocked=true;},replace(values,revision){const d=read();write({...d,values:copy(values),base:copy(values),revision,pending:null});},meta(patch){write({...read(),...patch});},backup(reason){const d=read();const backups=JSON.parse(raw.getItem(key+':backups')||'[]');backups.push({at:Date.now(),reason,values:d.values});raw.setItem(key+':backups',JSON.stringify(backups.slice(-3)));},snapshot:()=>copy(read().values)};
  }
  function guardNetwork(firebase,active,inflight,intercept){
    const proto=firebase.database?.Reference?.prototype;
    if(proto)for(const name of ['set','update','remove','transaction','setWithPriority','setPriority','push']){
      const original=proto[name];if(!original)continue;
      proto[name]=function(...args){if(!active())return Promise.reject(Error('이 기기의 운영 권한이 종료되었습니다.'));const intercepted=intercept?.(this,name,args);if(intercepted!==undefined)return intercepted;const p=original.apply(this,args);if(p?.then){inflight.add(p);p.then(()=>inflight.delete(p),()=>inflight.delete(p));}return p;};
    }
    if(firebase.functions){const instance=firebase.functions();const original=instance.httpsCallable.bind(instance);instance.httpsCallable=(...args)=>{const fn=original(...args);return (...input)=>{if(!active())return Promise.reject(Error('이 기기의 운영 권한이 종료되었습니다.'));const p=fn(...input);inflight.add(p);p.then(()=>inflight.delete(p),()=>inflight.delete(p));return p;};};}
  }
  const api={PREFIX,MODE,syncKey,appKey,collect,createStore,same,copy,guardNetwork};if(typeof module==='object'&&module.exports)module.exports=api;else root.MintonWorkspaceCore=api;
})(typeof window==='undefined'?globalThis:window);
