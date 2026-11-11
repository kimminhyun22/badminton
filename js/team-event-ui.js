/* Applicant-only individual assessment. Raw participants remain club profiles;
   event-only guest ratings enter copies used for the next team/bracket build. */
(function(){
  'use strict';
  const E=window.KokTeamEventSkill;
  if(!E)return;
  let applying=false;
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}};
  const eventId=()=>_currentBracketRsvpId()||_rsvpId||'';
  const rosterShape=(rows,context)=>(rows||[]).map(p=>[E.key(p),p.name,p.grade,['여','F'].includes(p.gender)?'여':'남',p.ageGroup||'40대',!!p.isGuest,...(context?.bindings?.[E.key(p)]?[]:[p.level??null,p.skillRating??null])]).sort((a,b)=>a[0].localeCompare(b[0]));
  const blocked=()=>!!(_liveOn||_liveId||_teamStoredLiveId()||_liveMatchStartedAt||_teamFinishedAt||_teamAssignmentBusy||currentMatches.some((_,i)=>_isMatchDone(i)));
  function profile(p){
    return {memberKey:E.key(p),name:p.name,grade:p.grade,gender:p.gender==='F'||p.gender==='여'?'여':'남',ageGroup:p.ageGroup||'40대',skillStep:p.skillStep||0,skillRating:effLevel(p),isGuest:!!p.isGuest};
  }
  function capture(){
    if(_directPlayers.length<4)throw Error('참가자를 4명 이상 등록한 뒤 밸런스게임을 준비해 주세요.');
    _rsvpSyncImportedPlayersFromRoster();
    const clubs=_rsvpClubs(),selected=clubs.find(c=>c.id===_rsvpSelectedSource());
    const bindings={},evaluators=new Map(),subjects=[];
    for(const p of _directPlayers){
      _teamEnsureMemberId(p);
      const member=!p.isGuest&&_teamRosterBridge()?.resolveMember(clubs,p,selected?.id||'',_rsvpMemberId);
      if(member){
        p.clubId=member.clubId;p.club=member.club;p.memberId=member.memberId;
        const club=clubs.find(c=>c.id===member.clubId);
        const matches=(club?.members||[]).filter(m=>m.memberId?m.memberId===member.memberId:m.name===member.name);
        if(matches.length!==1)throw Error(p.name+' 님의 명부 정보를 확인해 주세요.');
        bindings[E.key(p)]={clubId:club.id,memberId:member.memberId,name:member.name,original:structuredClone(matches[0])};
      }else if(!p.isGuest&&(p.clubId||p.club))throw Error(p.name+' 님의 원래 클럽 명부를 찾을 수 없습니다.');
      subjects.push(profile(p));
    }
    const clubIds=new Set(Object.values(bindings).map(b=>b.clubId));
    if(selected)clubIds.add(selected.id);
    for(const club of clubs.filter(c=>clubIds.has(c.id)))for(const m of club.members||[]){
      if(!m.name)continue;
      const p={...m,clubId:club.id,club:club.name,memberId:m.memberId||_rsvpMemberId({name:m.name,club:club.name})};
      evaluators.set(E.key(p),{memberKey:E.key(p),name:m.name});
    }
    for(const p of subjects)if(!evaluators.has(p.memberKey))evaluators.set(p.memberKey,{memberKey:p.memberKey,name:p.name});
    const id=rsvpEnsureId();_teamParticipantSourceRsvpId=id;
    if(currentMatches.length)saveState();
    _teamSaveRosterBridge();
    const draft={players:structuredClone(_directPlayers),teamAssignment:structuredClone(teamAssignment),captains:structuredClone(captains),partners:structuredClone(_partners),hasBracket:!!currentMatches.length,courts:document.getElementById('courts').value,gamesPerPlayer:document.getElementById('gamesPerPlayer').value};
    return E.saveContext({id,title:_rsvpTitle(),clubId:selected?.id||[...clubIds][0]||'team-'+id,clubName:selected?.name||'팀전 참가자',players:subjects,evaluators:[...evaluators.values()],bindings,draft});
  }
  window.teamOpenEventBalance=function(){
    try{
      if(blocked())throw Error('진행 중인 경기의 점수는 바꾸지 않습니다. 다음 팀전 준비에서 평가해 주세요.');
      const context=capture();
      location.href='skill-review.html?from=team&event='+encodeURIComponent(context.id);
    }catch(e){showErr(e.message);}
  };
  // Existing generated matches keep their saved rating snapshot. Only a new
  // generation consumes updated club ratings and event-specific guest scores.
  window.teamEventSkillPlayer=function(p){
    const id=eventId();if(!id||!p.memberId)return p;
    const context=E.readContext(id),item=context?.applied?.[E.key(p)];
    if(!item||context.bindings?.[E.key(p)])return p;
    const basis=item.basis;
    if(!basis||['name','grade','ageGroup'].some(k=>String(basis[k]||'')!==String(profile(p)[k]||''))||basis.gender!==profile(p).gender)return p;
    return {...p,skillRating:item.skillRating,level:item.skillRating+(['여','F'].includes(p.gender)?.5:0)-({'20대':0,'30대':-.2,'40대':-.5,'50대':-1.2,'60대+':-2}[p.ageGroup||'40대']||0)};
  };
  window.teamEventProtectsBracket=function(){
    const clubs=_rsvpClubs();
    return _directPlayers.some(p=>{
      const member=_teamRosterBridge()?.resolveMember(clubs,p,'',_rsvpMemberId);
      const club=member&&clubs.find(c=>c.id===member.clubId);
      if(!club)return false;
      const raw=club.members?.find(m=>m.name===member.name);
      return !!window.KokSkillBatch?.currentSource?.(club,raw)?.protected;
    });
  };
  async function latest(context){
    const own=context.assessment;
    if(!own?.id||!own.key)throw Error('평가를 만든 기기에서 결과를 확인해 주세요.');
    const response=await fetch('https://us-central1-kokmatch-23b31.cloudfunctions.net/clubSkillCalibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{action:'read',id:own.id,key:own.key}}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    if(!response.ok||!data.result)throw Error(data.error?.message||'최신 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
    return data.result;
  }
  function notice(text,action){
    let box=document.getElementById('teamEventSkillNotice');
    if(!box){box=document.createElement('div');box.id='teamEventSkillNotice';box.className='team-event-skill-notice';box.setAttribute('role','status');document.getElementById('autoFlowCard').after(box);}
    box.replaceChildren();const p=document.createElement('p');p.textContent=text;box.append(p);
    if(action){const b=document.createElement('button');b.type='button';b.className='sync-btn';b.textContent=action.label;b.onclick=action.run;box.append(b);}
  }
  async function applyPending(id,clearDraft=false){
    if(applying)return;applying=true;
    try{
      const context=E.readContext(id);
      if(!context?.pending)return;
      if(eventId()!==id||localStorage.getItem(RSVP_KEY)!==id||blocked())throw Error('현재 팀전이 바뀌었거나 경기가 진행 중입니다. 보정안을 보관했습니다.');
      if(currentMatches.length&&!clearDraft){
        notice('보정안을 보관했습니다. 명부에 저장하기 전에 기존 미진행 대진을 정리해야 합니다.',{label:'미진행 대진 정리 후 저장',run:()=>applyPending(id,true)});return;
      }
      if(clearDraft&&!confirm('미진행 대진을 정리하고 보정점수를 명부에 저장할까요? 저장 후 청·홍팀과 대진을 다시 생성해 주세요.'))return;
      const session=await latest(context);
      if(eventId()!==id||localStorage.getItem(RSVP_KEY)!==id||blocked())throw Error('팀전 상태가 바뀌었습니다. 다시 확인해 주세요.');
      const storedPlayers=_teamRosterBridge()?.load('team')?.players||[];
      if(JSON.stringify(rosterShape(storedPlayers,context))!==JSON.stringify(rosterShape(_directPlayers,context)))throw Error('다른 화면에서 참가자가 변경됐습니다. 최신 신청자를 확인해 주세요.');
      const raw=localStorage.getItem('badminton_rosters_v1')||'{"clubs":[]}';
      let result=E.planApply(id,session,JSON.parse(raw),_directPlayers.map(profile));
      if(localStorage.getItem('badminton_rosters_v1')!==raw&&!(raw==='{"clubs":[]}'&&!localStorage.getItem('badminton_rosters_v1')))throw Error('명부가 변경됐습니다. 다시 시도해 주세요.');
      if(currentMatches.length){
        // Persist the user's clearing decision first. If either later write
        // fails, reopening can restore the still-saved bracket or the cleared
        // draft and retry the same pending result without losing it.
        E.saveContext({...E.readContext(id),draft:{...context.draft,clearRequested:true}});
        result=E.planApply(id,session,JSON.parse(raw),_directPlayers.map(profile));
      }
      // A failed roster write must leave the existing bracket and its saved
      // copy intact. Clearing is an explicit user action after this succeeds.
      localStorage.setItem('badminton_rosters_v1',JSON.stringify(result.state));
      if(currentMatches.length){
        _rsvpClearUnstartedBracket();
        localStorage.removeItem(SAVE_KEY);
        _teamParticipantSourceRsvpId=id;
      }
      rosters=result.state;
      saveRosters();
      E.commitApplied(result.newContext);
      teamAssignment=null;
      renderClubList();renderDirectPlayerList();updateTeamModeBadge();saveState();
      const url=new URL(location.href);url.searchParams.delete('skillEvent');history.replaceState(null,'',url);
      notice(`명부 ${result.count}명 저장 완료${result.guestCount?' · 미등록 참가자 '+result.guestCount+'명은 이번 팀전에 반영':''}. 이제 청·홍팀을 배정해 주세요.`,{label:'청·홍팀 배정',run:()=>doTeamAssignFromUI()});
    }catch(e){notice(e.message,{label:'평가 결과 다시 확인',run:()=>{location.href='skill-review.html?from=team&event='+encodeURIComponent(id);}});}
    finally{applying=false;}
  }
  function returnFromReview(){
    const id=new URLSearchParams(location.search).get('skillEvent');if(!id)return;
    const context=E.readContext(id);
    if(!context?.draft||_rsvpId!==id){notice('팀전이 바뀌었습니다. 해당 팀전에서 밸런스게임을 다시 열어 주세요.');return;}
    // Restore only the exact draft that left this page, never another tab's roster.
    const shared=_teamRosterBridge()?.load('team');
    if(JSON.stringify(rosterShape(shared?.players,context))!==JSON.stringify(rosterShape(context.draft.players,context))){notice('참가자가 변경됐습니다. 현재 참가자에서 밸런스게임을 다시 열어 명단을 갱신해 주세요.');return;}
    const saved=read(SAVE_KEY,null);
    if(context.draft.hasBracket&&(!context.draft.clearRequested||saved)){
      if(saved?.settings?.rsvpId!==id){notice('기존 대진이 변경됐습니다. 보정안을 보관했습니다.');return;}
      restoreState();
    }else if(!currentMatches.length){
      _directPlayers=structuredClone(context.draft.players);teamAssignment=structuredClone(context.draft.teamAssignment);
      captains=structuredClone(context.draft.captains);_partners=structuredClone(context.draft.partners);
      _teamParticipantSourceRsvpId=id;
      document.getElementById('courts').value=context.draft.courts;
      document.getElementById('gamesPerPlayer').value=context.draft.gamesPerPlayer;
      renderDirectPlayerList();updateTeamModeBadge();
    }
    applyPending(id);
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(returnFromReview,0));
})();
