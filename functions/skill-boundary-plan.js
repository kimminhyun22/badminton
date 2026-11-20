(function(root){
  'use strict';
  const ranks={E:2,D:3,C:4,B:5,A:6,S:7};
  const canonical=(a,b)=>{const ids=[a,b].sort((x,y)=>Number(x.slice(1))-Number(y.slice(1)));return {id:ids.join('_'),a:ids[0],b:ids[1],kind:'cross-grade'};};
  function permutations(a){return a.length? a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(rest=>[v,...rest])):[[]];}
  function recommend(session,{initialOnly=false}={}){
    if(!session?.players?.length||!session.proposals?.length)throw Error('관리자 비교 근거가 필요합니다.');
    const players=session.players,byId=new Map(players.map(p=>[p.id,p])),metrics=new Map(session.proposals.map(p=>[p.id,p]));
    const graph=new Map(players.map(p=>[p.id,new Set()]));let disputed=0,answered=0;
    for(const q of session.questions){const e=session.evidence?.[q.id];if(!e?.count)continue;if(e.needsReview){disputed++;continue;}if(!graph.has(q.a)||!graph.has(q.b))continue;answered++;graph.get(q.a).add(q.b);graph.get(q.b).add(q.a);}
    const seen=new Set(),components=[],componentOf=new Map();
    for(const p of players){if(seen.has(p.id))continue;const ids=[p.id];seen.add(p.id);for(let i=0;i<ids.length;i++)for(const id of graph.get(ids[i]))if(!seen.has(id)){seen.add(id);ids.push(id);}const component={ids,grades:[...new Set(ids.map(id=>byId.get(id).grade))]};components.push(component);for(const id of ids)componentOf.set(id,component);}
    const m=id=>metrics.get(id)||{},score=id=>Number.isFinite(m(id).skillRating)?m(id).skillRating:(byId.get(id).skillRating??byId.get(id).base),resolved=id=>graph.get(id).size;
    const uncertainty=id=>(m(id).conflicts||0)/Math.max(1,m(id).opponents||0),poorShare=id=>componentOf.get(id).ids.filter(v=>resolved(v)<3).length/componentOf.get(id).ids.length;
    const grades=[...new Set(players.map(p=>p.grade))].sort((a,b)=>ranks[a]-ranks[b]);
    const selected=[],reasons={};
    for(const grade of grades){const members=players.filter(p=>p.grade===grade).map(p=>p.id),chosen=[];
      const parts=[...new Set(members.map(id=>componentOf.get(id)))].sort((a,b)=>b.ids.length-a.ids.length);
      for(const part of parts.slice(0,3)){const ids=part.ids.filter(id=>byId.get(id).grade===grade),reliable=ids.filter(id=>resolved(id)>=3),pool=reliable.length?reliable:ids;
        pool.sort((a,b)=>reliable.length?score(b)-score(a)||resolved(b)-resolved(a):resolved(b)-resolved(a)||(m(b).experts||0)-(m(a).experts||0)||score(b)-score(a));
        chosen.push(pool[0]);reasons[pool[0]]=parts.length>1?'분리된 비교 집단을 연결할 대표 후보':reliable.length?'동급 근거가 있는 상단 후보':'근거 부족을 확인할 탐색 후보';}
      if(chosen.length===1&&members.length>1){const reliable=members.filter(id=>!chosen.includes(id)&&resolved(id)>=3),pool=reliable.length?reliable:members.filter(id=>!chosen.includes(id));pool.sort((a,b)=>score(a)-score(b)||resolved(b)-resolved(a));chosen.push(pool[0]);reasons[pool[0]]=reliable.length?'동급 근거가 있는 하단 후보':'낮은 추정값의 탐색 후보';}
      while(chosen.length<Math.min(3,members.length)){const pool=members.filter(id=>!chosen.includes(id));pool.sort((a,b)=>Math.max(0,3-resolved(b))-Math.max(0,3-resolved(a))||poorShare(b)-poorShare(a)||uncertainty(b)-uncertainty(a)||(m(a).experts||0)-(m(b).experts||0)||Number(a.slice(1))-Number(b.slice(1)));chosen.push(pool[0]);reasons[pool[0]]=resolved(pool[0])<3?'상대 수가 부족한 회원을 교차 확인':'의견 분산이 큰 회원을 교차 확인';}
      selected.push(...chosen);}
    const initial=[],pilot=[],confirm=[];
    for(let i=0;i<grades.length-1;i++){const left=selected.filter(id=>byId.get(id).grade===grades[i]),right=selected.filter(id=>byId.get(id).grade===grades[i+1]),boundary=grades[i]+'–'+grades[i+1];
      if(left.length===3&&right.length===3){const choices=permutations(right),cost=a=>left.reduce((n,id,j)=>n+Math.abs(score(id)-score(a[j])),0);choices.sort((a,b)=>cost(a)-cost(b));const first=choices[0],second=choices.filter(a=>a.every((id,j)=>id!==first[j])).sort((a,b)=>cost(a)-cost(b))[0];
        for(const [phase,match] of [['pilot',first],['confirm',second]])for(let j=0;j<left.length;j++){const q={...canonical(left[j],match[j]),boundary,phase};initial.push(q);(phase==='pilot'?pilot:confirm).push(q);}}
      else{for(const a of left)for(const b of right){const q={...canonical(a,b),boundary,phase:'pilot'};initial.push(q);pilot.push(q);}}
    }
    if(initialOnly){
      if(players.length>=4)addSparseCoverage(initial,players,grades,score);
      return {initial};
    }
    const used=new Set(initial.map(q=>q.id)),degree=new Map(players.map(p=>[p.id,resolved(p.id)]));initial.forEach(q=>{degree.set(q.a,degree.get(q.a)+1);degree.set(q.b,degree.get(q.b)+1);});
    const afterInitial=[...degree].filter(([,n])=>n<3).map(([id,n])=>({id,missing:3-n})),supplement=[];
    for(let k=0;k<150&&[...degree.values()].some(n=>n<3);k++){const candidates=[];for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){const a=players[i],b=players[j];if(Math.abs(grades.indexOf(a.grade)-grades.indexOf(b.grade))!==1)continue;const q=canonical(a.id,b.id);if(used.has(q.id)||session.evidence?.[q.id]?.count)continue;const benefit=Number(degree.get(a.id)<3)+Number(degree.get(b.id)<3);if(!benefit)continue;candidates.push({...q,benefit,gap:Math.abs(score(a.id)-score(b.id))});}candidates.sort((a,b)=>b.benefit-a.benefit||a.gap-b.gap||a.id.localeCompare(b.id));if(!candidates.length)break;const {benefit,gap,...q}=candidates[0];q.phase='coverage';q.boundary=[byId.get(q.a).grade,byId.get(q.b).grade].sort((a,b)=>ranks[a]-ranks[b]).join('–');supplement.push(q);used.add(q.id);degree.set(q.a,degree.get(q.a)+1);degree.set(q.b,degree.get(q.b)+1);}
    return {version:'boundary-plan-v1',sourceId:session.id,sourceCount:session.count,gradeCounts:Object.fromEntries(grades.map(g=>[g,players.filter(p=>p.grade===g).length])),components:components.length,resolvedQuestions:answered,disputedQuestions:disputed,selectedIds:selected,candidates:selected.map(id=>({id,grade:byId.get(id).grade,resolved:resolved(id),experts:m(id).experts||0,conflicts:m(id).conflicts||0,componentSize:componentOf.get(id).ids.length,reason:reasons[id],exploratory:resolved(id)<3})),pilot,confirm,initial,supplement,insufficientAfterInitialIfResolved:afterInitial,remainingDeficitsAfterSupplement:[...degree].filter(([,n])=>n<3).map(([id,n])=>({id,missing:3-n})),recommendedJudgmentsPerQuestion:3,initialResponses:initial.length*3,fullResponses:(initial.length+supplement.length)*3,requiresRealAnswers:true};
  }
  // A new club pool also contains every same-grade pair. Only players with
  // fewer than three *possible* same/adjacent opponents need distant coverage.
  function addSparseCoverage(initial,players,grades,score){
    const size=new Map(grades.map(g=>[g,players.filter(p=>p.grade===g).length]));
    const degree=new Map(players.map(p=>[p.id,size.get(p.grade)-1]));
    for(const q of initial)for(const id of [q.a,q.b])degree.set(id,degree.get(id)+1);
    const deficit=new Set(players.filter(p=>{
      const i=grades.indexOf(p.grade);
      return size.get(p.grade)-1+(size.get(grades[i-1])||0)+(size.get(grades[i+1])||0)<3;
    }).map(p=>p.id));
    const needs=id=>deficit.has(id)&&degree.get(id)<3;
    if(!deficit.size)return;
    const options=[];
    for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
      const a=players[i],b=players[j],distance=Math.abs(grades.indexOf(a.grade)-grades.indexOf(b.grade));
      if(distance<=1||!needs(a.id)&&!needs(b.id))continue;
      options.push({...canonical(a.id,b.id),distance,gap:Math.abs(score(a.id)-score(b.id))});
    }
    while(options.length){
      const useful=q=>Number(needs(q.a))+Number(needs(q.b)),candidates=options.filter(q=>useful(q)>0);
      candidates.sort((a,b)=>a.distance-b.distance||useful(b)-useful(a)||a.gap-b.gap||a.id.localeCompare(b.id));
      if(!candidates.length)break;
      const q=candidates[0];options.splice(options.indexOf(q),1);
      initial.push({id:q.id,a:q.a,b:q.b,kind:q.kind,phase:'sparse-coverage'});
      for(const id of [q.a,q.b])degree.set(id,degree.get(id)+1);
    }
  }
  // Bring one pair on each neighboring grade boundary to a directional
  // majority from two named judges. Leases only reserve work, never count as
  // evidence. A split or a tie leaves the boundary open for another candidate.
  function boundaryChecks(session,by,grades,available,limit){
    const selected=[],pending=new Set();
    if(!session.namedConfirmation)return {selected,pending};
    const boundaries=new Map();
    for(const q of session.questions||[]){
      const ga=by.get(q.a)?.grade,gb=by.get(q.b)?.grade;
      if(!ga||!gb||Math.abs(grades.indexOf(ga)-grades.indexOf(gb))!==1)continue;
      const key=[ga,gb].sort((a,b)=>ranks[a]-ranks[b]).join('–');
      if(!boundaries.has(key))boundaries.set(key,[]);
      const e=session.evidence?.[q.id]||{},n=e.namedJudgments||0,support=e.directionalSupport||0,res=session.namedReservations?.[q.id]||0;
      boundaries.get(key).push({id:q.id,n,support,res});
    }
    const choices=[];
    for(const records of boundaries.values()){
      let covered=false;
      for(const {id,n,support,res} of records){
        if(support>=2&&support>n/2)covered=true;
        if(res>=2)pending.add(id);
        if(res>0&&support+res>=2&&support+res>(n+res)/2){pending.add(id);covered=true;}
      }
      if(covered)continue;
      const candidates=records.filter(r=>available.has(r.id)&&r.res<2);
      candidates.sort((a,b)=>(b.support+b.res)-(a.support+a.res)||a.n-b.n||a.id.localeCompare(b.id));
      if(candidates.length)choices.push(candidates[0]);
    }
    choices.sort((a,b)=>(b.support+b.res)-(a.support+a.res)||a.n-b.n||a.id.localeCompare(b.id));
    for(const r of choices.slice(0,Math.min(2,Math.floor(limit/5))))selected.push(r.id);
    return {selected,pending};
  }
  // A bounded next batch, not a promise that more votes establish accuracy.
  function nextQuestions(session,limit=12){
    if(!session?.players?.length||!Array.isArray(session.proposals))return [];
    limit=Math.max(0,Math.min(20,Math.floor(limit)));const ps=session.players,by=new Map(ps.map(p=>[p.id,p])),metrics=new Map(session.proposals.map(p=>[p.id,p]));
    const reused=new Set(session.reusedQuestionIds||[]);
    const allowed=session.allowedQuestionIds?new Set(session.allowedQuestionIds):null;
    const answered=session.ownerAnswers||session.answers||{},grades=[...new Set(ps.map(p=>p.grade))].sort((a,b)=>ranks[a]-ranks[b]);
    const score=id=>metrics.get(id)?.skillRating??by.get(id).skillRating??by.get(id).base;
    const parent=new Map(ps.map(p=>[p.id,p.id])),find=id=>{let r=id;while(parent.get(r)!==r)r=parent.get(r);return r;},join=(a,b)=>parent.set(find(a),find(b));
    const degree=new Map(ps.map(p=>[p.id,metrics.get(p.id)?.resolved||0]));
    for(const q of session.questions||[])if(session.evidence?.[q.id]?.count&&!session.evidence[q.id].needsReview&&by.has(q.a)&&by.has(q.b))join(q.a,q.b);
    const sparse=new Set((session.questions||[]).filter(q=>q.phase==='sparse-coverage').map(q=>q.id));
    const late=new Set(session.latePlayerIds||[]);
    const pool=[];
    for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
      const a=ps[i],b=ps[j],gap=Math.abs(grades.indexOf(a.grade)-grades.indexOf(b.grade));
      const q=canonical(a.id,b.id);if(gap>1&&!session.eventOnly&&!sparse.has(q.id))continue;if(Object.hasOwn(answered,q.id)||reused.has(q.id))continue;
      if(allowed&&!allowed.has(q.id))continue;
      const e=session.evidence?.[q.id]||{},c=metrics.get(a.id)?.comparisons?.find(c=>c.name===b.name),diff=score(a.id)-score(b.id);
      const contradiction=!!c?.agree&&(c.outcome==='higher'?diff<0:c.outcome==='lower'?diff>0:Math.abs(diff)>.2);
      // Well-covered, consistent pairs add little to this reviewer's next batch.
      const wellCovered=(e.count||0)>=3&&!e.needsReview&&!contradiction&&degree.get(a.id)>=3&&degree.get(b.id)>=3&&find(a.id)===find(b.id);
      if(wellCovered&&(!session.namedConfirmation||gap!==1))continue;
      pool.push({...q,wellCovered,kind:gap?'cross-grade':'same-grade',boundary:a.grade===b.grade?a.grade:[a.grade,b.grade].sort((a,b)=>ranks[a]-ranks[b]).join('–'),contradiction,mixed:!!e.needsReview,count:e.count||0,gradeDistance:gap,gap:Math.abs(diff)});
    }
    const exposure=new Map(ps.map(p=>[p.id,0])),gradeExposure=new Map(grades.map(g=>[g,0])),cap=Math.max(3,Math.ceil(2*limit/ps.length)+1),chosen=[];
    const needsAnchor=session.eventOnly&&session.proposals.some(p=>p.assessment?.waitingForAnchor);
    const anchored=new Set(needsAnchor?session.proposals.filter(p=>!p.assessment?.waitingForAnchor).map(p=>find(p.id)):[]);
    const anchorBridge=q=>needsAnchor&&anchored.has(find(q.a))!==anchored.has(find(q.b));
    const available=new Map(pool.map(q=>[q.id,q]));
    const {selected,pending}=boundaryChecks(session,by,grades,available,limit);
    const take=(q,reason)=>{
      pool.splice(pool.indexOf(q),1);
      chosen.push({id:q.id,a:q.a,b:q.b,kind:q.kind,boundary:q.boundary,phase:'adaptive',reason});
      const connects=anchorBridge(q);join(q.a,q.b);if(connects)anchored.add(find(q.a));
      for(const id of [q.a,q.b]){
        exposure.set(id,exposure.get(id)+1);gradeExposure.set(by.get(id).grade,gradeExposure.get(by.get(id).grade)+1);
        if(!q.count)degree.set(id,degree.get(id)+1);
      }
    };
    for(const id of selected)take(available.get(id),'급수 간 비교 확인');
    // Three resolved opponents qualify. A fourth independent opponent provides
    // a little room for a later split or a skipped question. A pending distinct
    // opponent counts half for scheduling only; it never qualifies a player.
    const pendingDegree=new Map(ps.map(p=>[p.id,0]));
    for(const q of session.questions||[]){
      if(!session.reservationCounts?.[q.id]||session.evidence?.[q.id]?.count)continue;
      for(const id of [q.a,q.b])pendingDegree.set(id,(pendingDegree.get(id)||0)+1);
    }
    const missingCoverage=id=>Math.max(0,4-degree.get(id)-.5*pendingDegree.get(id));
    const coverageBenefit=q=>!session.reservationCounts||q.count?0:3*(missingCoverage(q.a)+missingCoverage(q.b));
    const deficit=id=>Math.max(0,3-degree.get(id));
    const newOpponentNeed=q=>q.count?0:Math.max(deficit(q.a),deficit(q.b));
    const lateNeed=q=>q.count?0:Number(late.has(q.a)&&deficit(q.a)>0)+Number(late.has(q.b)&&deficit(q.b)>0);
    while(pool.length&&chosen.length<limit){
      const eligible=pool.filter(q=>!q.wellCovered&&!pending.has(q.id)&&exposure.get(q.a)<cap&&exposure.get(q.b)<cap);
      if(!eligible.length)break;
      const benefit=q=>coverageBenefit(q)+5*Number(find(q.a)!==find(q.b))+4*Number(q.contradiction)+3*Number(q.mixed)+3*(Number(degree.get(q.a)<3)+Number(degree.get(q.b)<3))+1/(1+q.gap);
      const urgent=q=>Number(q.contradiction||q.mixed||find(q.a)!==find(q.b)||degree.get(q.a)<3||degree.get(q.b)<3);
      const seenPlayers=q=>exposure.get(q.a)+exposure.get(q.b);
      const seenGrades=q=>gradeExposure.get(by.get(q.a).grade)+gradeExposure.get(by.get(q.b).grade);
      const compare=(a,b)=>(session.reservationCounts?urgent(b)-urgent(a):0)
        ||(session.reservationCounts?.[a.id]||0)-(session.reservationCounts?.[b.id]||0)
        ||Number(anchorBridge(b))-Number(anchorBridge(a))||lateNeed(b)-lateNeed(a)
        ||(session.eventOnly?Number(a.gradeDistance>1)-Number(b.gradeDistance>1):0)
        ||benefit(b)-benefit(a)||newOpponentNeed(b)-newOpponentNeed(a)
        ||seenPlayers(a)-seenPlayers(b)||seenGrades(a)-seenGrades(b)||a.count-b.count||a.id.localeCompare(b.id);
      const q=eligible.reduce((best,candidate)=>compare(candidate,best)<0?candidate:best);
      const reason=anchorBridge(q)?'기존 참가자와 비교':lateNeed(q)?'추가 신청자 비교':q.contradiction?'판단과 추정 순서의 상충 확인':q.mixed?'의견이 나뉜 비교 확인':find(q.a)!==find(q.b)?'분리된 비교 집단 연결':degree.get(q.a)<3||degree.get(q.b)<3?'상대 수 부족 보충':'근접한 실력 추정 확인';
      take(q,reason);
    }
    return chosen;
  }
  const api={recommend,nextQuestions};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KokSkillPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this);
