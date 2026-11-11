(function(root){
  'use strict';
  const PREFIX='kokmatch_team_skill_event_v1:';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const text=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>160)throw Error(label+'를 확인해 주세요.');return v;};
  const gender=v=>['F','여'].includes(v)?'여':['M','남'].includes(v)?'남':v;
  function key(player){
    if(!player||player.memberId==null||String(player.memberId)==='')throw Error('신청자 식별자를 확인해 주세요.');
    return JSON.stringify([player.clubId||player.club||'',player.memberId]);
  }
  function memberKey(p){return text(p?.memberKey||key(p),'회원 식별자');}
  function identity(p){
    const name=text(p?.name,'회원 이름').trim(),grade=p.grade,g=gender(p.gender),ageGroup=p.ageGroup||'40대';
    if(!['S','A','B','C','D','E'].includes(grade)||!['남','여'].includes(g)||!['20대','30대','40대','50대','60대+'].includes(ageGroup))throw Error('신청자 프로필을 확인해 주세요.');
    return [memberKey(p),name,grade,g,ageGroup];
  }
  function subjectRows(players){
    if(!Array.isArray(players)||players.length>150)throw Error('신청자 명단을 확인해 주세요.');
    const rows=players.map(identity),seen=new Set();
    for(const row of rows){if(seen.has(row[0]))throw Error('신청자 식별자가 중복됐습니다.');seen.add(row[0]);}
    return rows.sort((a,b)=>a[0].localeCompare(b[0]));
  }
  function signature(context){
    const players=subjectRows(context?.players),seen=new Set();
    if(!Array.isArray(context.evaluators))throw Error('평가자 명단을 확인해 주세요.');
    const evaluators=context.evaluators.map(p=>{const k=memberKey(p);if(seen.has(k))throw Error('평가자 식별자가 중복됐습니다.');seen.add(k);return [k,text(p.name,'평가자 이름').trim()];}).sort((a,b)=>a[0].localeCompare(b[0]));
    return JSON.stringify({players,evaluators});
  }
  function create(storage){
    const batch=()=>{const B=typeof module!=='undefined'&&module.exports?require('./club-skill-batch'):root.KokSkillBatch;if(!B)throw Error('명부 저장 기능을 불러오지 못했습니다. 새로고침해 주세요.');return B;};
    const store=()=>{const s=storage||root.localStorage;if(!s?.getItem||!s?.setItem)throw Error('이 기기에 팀전 정보를 저장할 수 없습니다.');return s;};
    const address=id=>PREFIX+encodeURIComponent(text(id,'팀전 식별자'));
    function readContext(id){
      const raw=store().getItem(address(id));if(raw==null)return null;
      let value;try{value=JSON.parse(raw);}catch(_){throw Error('저장된 팀전 정보를 읽지 못했습니다.');}
      if(!value||value.id!==id)throw Error('저장된 팀전 식별자가 다릅니다.');
      signature(value);return copy(value);
    }
    function write(value){
      const serial=JSON.stringify(value);store().setItem(address(value.id),serial);return copy(value);
    }
    function requireContext(id){const c=readContext(id);if(!c)throw Error('이 기기의 팀전 신청자 정보를 찾지 못했습니다.');return c;}
    function saveContext(input){
      const next=copy(input);text(next.id,'팀전 식별자');signature(next);
      const previous=readContext(next.id),initial={...previous?._initialPlayers};
      for(const p of previous?.players||[])if(!initial[memberKey(p)])initial[memberKey(p)]=copy(p);
      const oldPlayers=new Map(Object.entries(initial));
      next.players=next.players.map(p=>{
        const old=oldPlayers.get(memberKey(p));
        if(!old||!same(identity(old),identity(p)))return p;
        // Applying a result must never silently turn it into the survey's prior.
        const frozen={...p};for(const field of ['level','skillStep','skillRating','base']){if(Object.hasOwn(old,field))frozen[field]=old[field];else delete frozen[field];}return frozen;
      });
      for(const p of next.players)initial[memberKey(p)]=copy(p);
      next._initialPlayers=initial;
      next.bindings={...previous?.bindings,...next.bindings};
      for(const [k,b] of Object.entries(previous?.bindings||{})){
        const incoming=next.bindings[k];
        if(incoming&&(incoming.clubId!==b.clubId||incoming.memberId!==b.memberId||incoming.name!==b.name))throw Error('회원 연결 정보가 변경됐습니다. 새 평가를 준비해 주세요.');
        next.bindings[k]=copy(b);
      }
      if(previous?.assessment)next.assessment=copy(previous.assessment);
      next.applied={...next.applied,...previous?.applied};
      if(previous?.appliedRevision!==undefined)next.appliedRevision=previous.appliedRevision;
      if(previous?.pending)next.pending=copy(previous.pending);
      next._storeRevision=(previous?._storeRevision||0)+1;
      return write(next);
    }
    function updateAssessment(eventId,ownLink){
      const c=requireContext(eventId),own=copy(ownLink);
      if(own.eventId&&own.eventId!==eventId)throw Error('다른 팀전의 평가입니다.');
      text(own.id,'평가 식별자');text(own.key,'관리자 평가 키');
      if(c.assessment&&(c.assessment.id!==own.id||c.assessment.key!==own.key))throw Error('기존 팀전 평가 연결이 변경됐습니다.');
      if(own.scopeSignature!==signature(c))throw Error('평가 대상과 현재 신청자가 다릅니다.');
      if(!Number.isFinite(own.createdAt)||own.createdAt<=0)throw Error('평가 생성 시각을 확인해 주세요.');
      c.assessment={...c.assessment,...own,createdAt:c.assessment?.createdAt||own.createdAt};c._storeRevision=(c._storeRevision||0)+1;return write(c);
    }
    function verifiedSession(c,session){
      if(!session||session.event?.id!==c.id||session.id!==c.assessment?.id||session.supersededBy)throw Error('현재 팀전의 평가 결과가 아닙니다.');
      if(!Number.isSafeInteger(session.event.revision)||session.event.revision<1)throw Error('신청자 변경 기록을 확인해 주세요.');
      text(session.resultRevision,'평가 결과 버전');
      const scope=signature(c);
      if(c.players.length<4||session.players?.length<4)throw Error('신청자 4명 이상일 때 결과를 적용할 수 있습니다.');
      if(c.assessment.scopeSignature!==scope||signature({players:session.players,evaluators:session.evaluators||[]})!==scope)throw Error('신청자 또는 평가자가 변경됐습니다. 최신 신청자를 먼저 반영해 주세요.');
      const originals=new Map(c.players.map(p=>[memberKey(p),p])),byId=new Map();
      for(const p of session.players){
        text(p.id,'평가 선수 식별자');if(byId.has(p.id))throw Error('평가 선수 식별자가 중복됐습니다.');byId.set(p.id,p);
        const original=originals.get(memberKey(p));
        if((Number.isFinite(original.skillRating)&&p.skillRating!==original.skillRating)||Number(p.skillStep||0)!==Number(original.skillStep||0))throw Error('평가 시작 점수가 변경됐습니다. 기존 답안을 새 기준점수에 다시 적용하지 않습니다.');
      }
      if(!Array.isArray(session.proposals))throw Error('평가 결과를 확인해 주세요.');
      const seen=new Set(),proposals=[];
      for(const proposal of session.proposals){
        const player=byId.get(proposal.id);
        if(!player||seen.has(proposal.id))throw Error('평가 대상과 보정안이 일치하지 않습니다.');seen.add(proposal.id);
        if(proposal.ready!==true)continue;
        if(!Number.isFinite(proposal.skillRating)||!proposal.basis||proposal.basis.id!==player.id||!same(identity(proposal.basis),identity(player))||!batch().same(proposal.basis,player))throw Error('보정안의 기준 회원 정보가 다릅니다.');
        if(proposal.eventRevision!==undefined&&proposal.eventRevision!==session.event.revision)throw Error('신청자 변경 전 보정안입니다.');
        const step=proposal.step??player.skillStep??0;if(!Number.isInteger(step)||Math.abs(step)>4)throw Error('보정값을 확인해 주세요.');
        proposals.push({id:proposal.id,memberKey:memberKey(player),skillRating:proposal.skillRating,step,basis:copy(proposal.basis)});
      }
      proposals.sort((a,b)=>a.memberKey.localeCompare(b.memberKey));
      return {sessionId:session.id,revision:session.event.revision,resultRevision:session.resultRevision,scopeSignature:scope,proposals};
    }
    function stageResults(eventId,session){
      const c=requireContext(eventId),pending=verifiedSession(c,session);
      if(!pending.proposals.length)throw Error('추가로 적용할 준비된 점수가 없습니다.');
      c.pending=pending;c._storeRevision=(c._storeRevision||0)+1;write(c);
      return 'team.html?skillEvent='+encodeURIComponent(eventId);
    }
    function locate(state,binding,player){
      if(!binding||!binding.original||binding.name!==binding.original.name||binding.name!==player.name||JSON.stringify([binding.clubId,binding.memberId])!==memberKey(player))throw Error('공식 명부 연결 정보를 확인해 주세요.');
      const clubs=state.clubs.filter(c=>c.id===binding.clubId);if(clubs.length!==1)throw Error('등록된 클럽 명부가 없거나 중복됐습니다.');
      const club=clubs[0];if(!Array.isArray(club.members))throw Error('등록된 회원 명부를 찾을 수 없습니다.');
      let members;
      if(binding.original.memberId!=null&&String(binding.original.memberId)!==''){
        if(binding.original.memberId!==binding.memberId)throw Error('공식 회원 식별자가 변경됐습니다.');
        members=club.members.filter(m=>m.memberId===binding.memberId);
      }else members=club.members.filter(m=>m.name===binding.name);
      if(members.length!==1||members[0].name!==binding.name||club.members.filter(m=>m.name===binding.name).length!==1)throw Error('등록 회원이 없거나 동명이인이 있어 연결을 확인해야 합니다.');
      return {club,member:members[0]};
    }
    function planApply(eventId,latestSession,rosterState,currentPlayers,now=Date.now()){
      const c=requireContext(eventId),pending=c.pending;
      if(!pending)throw Error('적용 대기 중인 평가 결과가 없습니다.');
      const latest=verifiedSession(c,latestSession);
      if(!same(latest,pending))throw Error('평가 답변 또는 신청자가 변경됐습니다. 최신 결과를 다시 확인해 주세요.');
      if(!same(subjectRows(currentPlayers),subjectRows(c.players)))throw Error('현재 팀전 신청자가 변경됐습니다. 최신 신청자를 먼저 반영해 주세요.');
      if(!rosterState||!Array.isArray(rosterState.clubs))throw Error('클럽 명부를 읽을 수 없습니다.');
      if(!Number.isFinite(now)||!Number.isFinite(c.assessment?.createdAt)||c.assessment.createdAt<=0)throw Error('평가 생성 기록을 확인해 주세요.');
      const B=batch(),source={kind:'team-event',createdAt:c.assessment.createdAt},batchId='team-event:'+latest.sessionId+':'+latest.resultRevision;
      if(typeof B.sourceConflict!=='function'||typeof B.currentSource!=='function')throw Error('명부 저장 기능이 이전 버전입니다. 새로고침 후 다시 적용해 주세요.');
      let state=copy(rosterState),count=0,guestCount=0;
      const newContext=copy(c),groups=new Map(),players=new Map(c.players.map(p=>[memberKey(p),p]));newContext.applied={...newContext.applied};
      for(const p of pending.proposals){
        const player=players.get(p.memberKey),binding=c.bindings?.[p.memberKey],prior=c.applied?.[p.memberKey];
        if(!binding){
          let scope;try{scope=JSON.parse(p.memberKey)[0];}catch(_){throw Error('참가자 연결 식별자를 확인해 주세요.');}
          if(scope&&!player.isGuest&&!player.guest)throw Error('등록 회원의 공식 명부 연결을 찾을 수 없습니다.');
          if(!prior||prior.skillRating!==p.skillRating)guestCount++;
          newContext.applied[p.memberKey]={skillRating:p.skillRating,basis:copy(p.basis),guest:true,sessionId:latest.sessionId,resultRevision:latest.resultRevision};continue;
        }
        const {club,member}=locate(state,binding,player),expected=prior?.after||binding.original;
        if(B.sourceConflict(club,member,latest.sessionId,source))throw Error('이 평가보다 최신 점수가 저장됐습니다. 이전 평가로 덮어쓰지 않습니다.');
        // Predict the official writer's exact member result to recover a crash
        // after saveRosters but before commitApplied, without applying twice.
        let after=copy(expected);
        if(expected.skillRating!==p.skillRating){
          const preview=B.prepare({clubs:[{id:binding.clubId,members:[copy(expected)]}]},binding.clubId,[{id:p.id,original:copy(expected),step:p.step,skillRating:p.skillRating}],latest.sessionId,batchId,now,source);
          after=preview.state.clubs[0].members[0];
        }
        if(!same(member,expected)&&!same(member,after))throw Error('명부가 수동 또는 다른 평가로 변경됐습니다. 기존 값을 유지했습니다.');
        if(!same(member,expected)){
          const written=B.currentSource(club,member);
          if(!written||written.reviewId!==latest.sessionId||written.batchId!==batchId)throw Error('같은 점수가 저장돼 있지만 이 평가의 저장 기록과 다릅니다. 현재 명부를 유지했습니다.');
        }
        if(!same(member,after)){
          if(!groups.has(binding.clubId))groups.set(binding.clubId,[]);
          groups.get(binding.clubId).push({id:p.id,original:copy(member),step:p.step,skillRating:p.skillRating});
        }
        newContext.applied[p.memberKey]={skillRating:p.skillRating,basis:copy(p.basis),after:copy(after),guest:false,sessionId:latest.sessionId,resultRevision:latest.resultRevision};
      }
      for(const [clubId,items] of groups){const result=B.prepare(state,clubId,items,latest.sessionId,batchId,now,source);state=result.state;count+=result.count;}
      newContext.appliedRevision=latest.resultRevision;
      newContext.applyGuard={storeRevision:c._storeRevision||0,pending:copy(pending)};
      delete newContext.pending;
      return {state,newContext,count,guestCount};
    }
    function commitApplied(newContext){
      const value=copy(newContext),current=requireContext(value.id),guard=value.applyGuard;
      if(!guard||(current._storeRevision||0)!==guard.storeRevision||!same(current.pending,guard.pending)||signature(current)!==signature(value))throw Error('저장 중 팀전 정보가 변경됐습니다. 현재 결과를 다시 확인해 주세요.');
      delete value.applyGuard;value._storeRevision=(current._storeRevision||0)+1;return write(value);
    }
    return {key,signature,readContext,saveContext,updateAssessment,stageResults,planApply,commitApplied};
  }
  const api={...create(),create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KokTeamEventSkill=api;
})(typeof globalThis!=='undefined'?globalThis:this);
