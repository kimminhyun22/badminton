(function(root){
'use strict';
// Experimental common rubric. Scores are policy diagnostics, not win probabilities.
const clamp=x=>Math.max(0,Math.min(1,x));
function average(xs){return xs.reduce((a,b)=>a+b,0)/xs.length;}
function tail(xs,fraction=.2){const sorted=[...xs].sort((a,b)=>b-a),size=xs.length*fraction;return sorted.reduce((s,x,i)=>s+x*clamp(size-i),0)/size;}
function assess(legacy,matches,players,settings,level,diff){
 const c={effLevel:level,_teamBalanceDiff:diff,_qualityAssessment:()=>legacy};
 if(!matches.length||!players.length)throw Error('Empty schedule');
 if(!settings.teamMode)throw Error('This experimental rubric is for team competition');
 const q=c._qualityAssessment(matches,players,settings),eff=p=>{const v=c.effLevel(p);if(!Number.isFinite(v))throw Error('Invalid rating');return v;};
 const sides=['청팀','홍팀'].map(t=>players.filter(p=>p.team===t));if(sides.some(t=>!t.length))throw Error('Missing team');
 const quantile=(xs,t)=>{const a=xs.map(eff).sort((a,b)=>a-b),x=t*(a.length-1),i=Math.floor(x);return a[i]+(a[Math.ceil(x)]-a[i])*(x-i);};
 const meanGap=Math.abs(average(sides[0].map(eff))-average(sides[1].map(eff)));
 const quantileGap=average([0,.2,.5,.8,1].map(t=>Math.abs(quantile(sides[0],t)-quantile(sides[1],t))));
 const genderGap=Math.max(...['M','F'].map(g=>{const ps=sides.map(s=>s.filter(p=>(['F','여'].includes(p.gender)?'F':'M')===g));return ps.every(s=>s.length)?Math.abs(average(ps[0].map(eff))-average(ps[1].map(eff))):0;}));
 const margins=matches.map(m=>{const pair=(a,b)=>eff(a)+eff(b)-.35*Math.abs(eff(a)-eff(b));const sign=m.team1A.team==='청팀'?1:-1;return sign*(pair(m.team1A,m.team1B)-pair(m.team2C,m.team2D));});
 // Preserve original per-match loss including raw sums and partner correction.
 const losses=matches.map(m=>clamp((c._teamBalanceDiff(m)-.25)/1.75));
 const originalGameLoss=.75*average(losses)+.25*tail(losses);
 const adjustedLosses=margins.map(x=>clamp(Math.abs(x)/1.5));
 const closenessLoss=settings._legacyCompetition?average(adjustedLosses):.4*average(adjustedLosses)+.4*tail(adjustedLosses)+.2*Math.max(...adjustedLosses);
 const gameLoss=.75*originalGameLoss+.25*closenessLoss;
 const rosterLoss=.45*clamp(meanGap/.5)+.4*clamp(quantileGap/1)+.15*clamp(genderGap/.5);
 // Continuous signed advantage; no discontinuous bonus at the close threshold.
 const net=average(margins),softBias=average(margins.map(x=>x/(Math.abs(x)+.2)));
 const groups={};matches.forEach((m,i)=>{(groups[m.type||'기타']||=[]).push(margins[i]);});
 const formatBalance=Object.entries(groups).map(([type,ms])=>({type,games:ms.length,blue:ms.filter(x=>x>.2).length,white:ms.filter(x=>x< -.2).length,close:ms.filter(x=>Math.abs(x)<=.2).length,softBias:average(ms.map(x=>x/(Math.abs(x)+.2)))}));
 // Every format contributes; the fourth game must not switch bias on/off.
 const formatWeight=g=>Math.min(1,g.games/4);
 const substantial=formatBalance.filter(g=>g.games>=4);
 const formatBias=settings._legacyCompetition?(substantial.length?average(substantial.map(g=>Math.abs(g.softBias))):Math.abs(softBias)):formatBalance.reduce((s,g)=>s+formatWeight(g)*Math.abs(g.softBias),0)/formatBalance.reduce((s,g)=>s+formatWeight(g),0);
 const overallLoss=settings._legacyCompetition ? .5*clamp(Math.abs(net)/.5)+.5*Math.abs(softBias) : .5*clamp(Math.abs(net)/.5)+.25*Math.abs(softBias)+.25*formatBias;
 const components={games:30*(1-gameLoss),roster:10*(1-rosterLoss),overall:10*(1-overallLoss),participation:q.sFair,diversity:q.sDiversity,rest:q.sInterval};
 const total=Math.round(Object.values(components).reduce((a,b)=>a+b,0)*10)/10;
 const issues=[...q.safetyIssues];
 const diagnostics={meanGap,quantileGap,genderGap,meanAdjustedGap:average(margins.map(Math.abs)),maxAdjustedGap:Math.max(...margins.map(Math.abs)),tailAdjustedGap:tail(margins.map(Math.abs)),netPerGame:net,softBias,formatBias,formatBalance,
  closeSensitivity:[.15,.2,.25,.3].map(t=>({threshold:t,blue:margins.filter(x=>x>t).length,white:margins.filter(x=>x< -t).length,close:margins.filter(x=>Math.abs(x)<=t).length}))};
 return {version:settings._legacyCompetition?4:7,total,components,maxima:{games:30,roster:10,overall:10,participation:20,diversity:20,rest:10},eligible:issues.length===0,issues,diagnostics,legacyTotal:q.total,legacySelection:!!settings._legacyCompetition};
}
// Mandatory validity/participation comes first. A high rest/diversity score
// cannot buy a worse blowout. Directional fairness breaks closeness ties.
function rankKey(q){
 if(q.legacySelection)return [q.eligible?0:1,q.issues.length,-q.total,-q.components.games,-q.components.overall];
 const d=q.diagnostics,c=d.closeSensitivity;
 return [q.eligible?0:1,q.issues.length,d.maxAdjustedGap,d.tailAdjustedGap,d.meanAdjustedGap,
  -c[1].close,Math.abs(c[1].blue-c[1].white),c.reduce((s,x)=>s+Math.abs(x.blue-x.white),0),
  d.formatBias,Math.abs(d.netPerGame),-q.total];
}

function distribution(blue,white,level){
 const average=a=>a.length?a.reduce((s,p)=>s+level(p),0)/a.length:0;
 const quantile=(a,t)=>{const v=a.map(level).sort((a,b)=>a-b),x=t*(v.length-1),i=Math.floor(x);return v[i]+(v[Math.ceil(x)]-v[i])*(x-i);};
 const meanGap=Math.abs(average(blue)-average(white));
 const quantileGap=[0,.2,.5,.8,1].reduce((s,t)=>s+Math.abs(quantile(blue,t)-quantile(white,t)),0)/5;
 const genderGap=Math.max(...['M','F'].map(g=>{const a=blue.filter(p=>(['F','여'].includes(p.gender)?'F':'M')===g),b=white.filter(p=>(['F','여'].includes(p.gender)?'F':'M')===g);return a.length&&b.length?Math.abs(average(a)-average(b)):0;}));
 const gradeSpread=['E','ED'].map(gs=>Math.abs(blue.filter(p=>gs.includes(p.grade||'?')).length-white.filter(p=>gs.includes(p.grade||'?')).length));
 return {meanGap,quantileGap,genderGap,gradeSpread,cost:4*meanGap+2*quantileGap+genderGap};
}
function refine(blue,white,locked,level,offset=0){
 const b=[...blue],w=[...white],initial=distribution(b,w,level),fixed=new Set(locked);
 for(let pass=0;pass<12;pass++){
  let best=distribution(b,w,level).cost,move=null;
  for(let i=0;i<b.length;i++)for(let j=0;j<w.length;j++){
   if(b[i].gender!==w[j].gender||fixed.has(b[i].name)||fixed.has(w[j].name)||b[i].partnerName||w[j].partnerName)continue;
   const nb=[...b],nw=[...w];[nb[i],nw[j]]=[nw[j],nb[i]];const d=distribution(nb,nw,level);
   if(d.gradeSpread.some((n,k)=>n>initial.gradeSpread[k])||d.genderGap>Math.max(.15,initial.genderGap)+1e-9)continue;
   if(d.cost<best-1e-9){best=d.cost;move=[i,j];}
  }
  if(!move)break;const [i,j]=move;[b[i],w[j]]=[w[j],b[i]];
 }
 if(offset){
  const nearby=[];
  for(let i=0;i<b.length;i++)for(let j=0;j<w.length;j++){
   if(b[i].gender!==w[j].gender||fixed.has(b[i].name)||fixed.has(w[j].name)||b[i].partnerName||w[j].partnerName)continue;
   const nb=[...b],nw=[...w];[nb[i],nw[j]]=[nw[j],nb[i]];const d=distribution(nb,nw,level);
   if(d.gradeSpread.some((n,k)=>n>initial.gradeSpread[k])||d.genderGap>Math.max(.15,initial.genderGap)+1e-9)continue;
   nearby.push({blue:nb,white:nw,cost:d.cost});
  }
  nearby.sort((a,b)=>a.cost-b.cost);if(nearby.length)return nearby[Math.min(offset-1,nearby.length-1)];
 }
 return {blue:b,white:w};
}
function opponentStats(matches){const counts={};matches.forEach(m=>[m.team1A,m.team1B].forEach(a=>[m.team2C,m.team2D].forEach(b=>{const k=[a.name,b.name].sort().join('|');counts[k]=(counts[k]||0)+1;})));return {max:Math.max(0,...Object.values(counts)),excess:Object.values(counts).reduce((s,n)=>s+Math.max(0,n-3),0),repeats:Object.values(counts).reduce((s,n)=>s+Math.max(0,n-1),0)};}
function allocationCandidates(blue,white,locked,level){
 const fixed=new Set(locked),female=p=>['F','여'].includes(p.gender),avg=ps=>ps.length?average(ps.map(level)):0;
 const initial=distribution(blue,white,level),limit=Math.max(.2,initial.meanGap+.05),out=[];
 // Roster means are an insufficient surrogate for the actual doubles pairs.
 // Measure each woman's best feasible opposing pair before evaluating complete
 // brackets. This is only a shortlist heuristic; the bracket guard is decisive.
 const potential=(b,w)=>{
  const sides=[b,w].map(ps=>ps.filter(female)),best=new Map(sides.flat().map(p=>[p.name,Infinity]));
  if(sides.some(ps=>ps.length<2))return [0,0];
  for(let i=0;i<sides[0].length;i++)for(let j=i+1;j<sides[0].length;j++)
   for(let k=0;k<sides[1].length;k++)for(let l=k+1;l<sides[1].length;l++){
    const a=[sides[0][i],sides[0][j]],c=[sides[1][k],sides[1][l]],sum=t=>t.reduce((s,p)=>s+level(p),0),gap=t=>Math.abs(level(t[0])-level(t[1]));
    const raw=sum(a)-sum(c),asym=gap(a)-gap(c),d=Math.abs(raw-.35*asym),compound=Math.abs(asym)>1.5&&raw*asym<0;
    if(Math.abs(raw)>2||d>(compound?1.5:2))continue;
    [...a,...c].forEach(p=>best.set(p.name,Math.min(best.get(p.name),d)));
   }
  const values=[...best.values()],missing=values.filter(v=>!Number.isFinite(v)).length;
  return [missing,Math.max(0,...values.filter(Number.isFinite)),average(values.map(v=>Number.isFinite(v)?v:4))];
 };
 const eligible=(p,q)=>female(p)===female(q)&&!fixed.has(p.name)&&!fixed.has(q.name)&&!p.partnerName&&!q.partnerName;
 const consider=pairs=>{
  const b=[...blue],w=[...white];pairs.forEach(([i,j])=>[b[i],w[j]]=[w[j],b[i]]);
  if(Math.abs(avg(b)-avg(w))>limit+1e-9)return;
  const gradeSpread=['E','ED'].map(gs=>Math.abs(b.filter(p=>gs.includes(p.grade||'?')).length-w.filter(p=>gs.includes(p.grade||'?')).length));
  if(gradeSpread.some((v,i)=>v>initial.gradeSpread[i]))return;
  out.push({blue:b,white:w,key:[...potential(b,w),Math.abs(avg(b)-avg(w))]});
 };
 const men=[],women=[];
 for(let i=0;i<blue.length;i++)for(let j=0;j<white.length;j++)if(eligible(blue[i],white[j]))(female(blue[i])?women:men).push([i,j]);
 women.forEach(pair=>{consider([pair]);men.forEach(m=>consider([pair,m]));});
 if(!women.length)men.forEach(pair=>consider([pair]));
 const compare=(a,b)=>{for(let i=0;i<a.key.length;i++)if(a.key[i]!==b.key[i])return a.key[i]-b.key[i];return 0;};
 out.sort(compare);const seen=new Set(),result=[];
 for(const candidate of out){const key=candidate.blue.map(p=>p.name).sort().join('|');if(seen.has(key))continue;seen.add(key);result.push(candidate);if(result.length===4)break;}
 return result;
}
function protects(base,next,bq,nq,baseMatches,nextMatches){
 const keys=['structureErr','genderErr','avoidableUnderSlots','underSlots','avoidableOverSlots','overSlots','balanceHardCount','balanceSevereCount','balanceCautionCount','asymSevereCount','restWorstExcess','avoidablePartnerExcess','excessConsec'];
 if(keys.some(k=>(next[k]||0)>(base[k]||0)))return false;
 if(next.sFair<base.sFair||next.sInterval<base.sInterval)return false;
 // The old aggregate may veto better closeness even with unchanged actual
 // attendance/rest/repeat counts. Keep it only for the preserved old result.
 if(nq.legacySelection&&(next.sDiversity<base.sDiversity||next.total<base.total))return false;
 if(next.avgLD>base.avgLD+.05+1e-9||next.maxLD>Math.max(base.maxLD,Math.min(1.5,base.maxLD+.2))+1e-9)return false;
 const b=bq.diagnostics,n=nq.diagnostics;if(n.meanAdjustedGap>b.meanAdjustedGap+.05+1e-9||Math.abs(n.netPerGame)>Math.abs(b.netPerGame)+1e-9)return false;
 if(!nq.legacySelection&&n.meanAdjustedGap>b.meanAdjustedGap+1e-9)return false;
 if(!nq.legacySelection&&Number.isFinite(b.maxAdjustedGap)&&n.maxAdjustedGap>b.maxAdjustedGap+1e-9)return false;
 const bc=b.closeSensitivity,nc=n.closeSensitivity;
 if(Math.abs(nc[1].blue-nc[1].white)>Math.abs(bc[1].blue-bc[1].white))return false;
 if(nc.reduce((s,x)=>s+Math.abs(x.blue-x.white),0)>bc.reduce((s,x)=>s+Math.abs(x.blue-x.white),0))return false;
 // Keep close games within one appearance quartet, rather than hiding a drop behind a high total.
 if(nc[1].close<bc[1].close-2)return false;
 const bo=opponentStats(baseMatches),no=opponentStats(nextMatches);if(no.max>bo.max||no.excess>bo.excess||(!nq.legacySelection&&no.repeats>bo.repeats))return false;
 return true;
}


// An ordinal score against independently generated, complete feasible schedules.
// It is a bounded comparison, not a probability or a global optimality proof.
function compareCandidates(current,references){
 const usable=references.filter(r=>r.eligible&&r.version===current.version),compare=(a,b)=>{
  const x=rankKey(a),y=rankKey(b);for(let i=0;i<x.length;i++)if(Math.abs(x[i]-y[i])>1e-9)return x[i]<y[i]?-1:1;return 0;
 };
 if(!current.eligible||usable.length<2)return {verified:false,reason:!current.eligible?'필수 조건 확인 필요':'같은 조건의 서로 다른 비교 후보가 부족합니다'};
 const better=usable.filter(r=>compare(r,current)<0).length,worse=usable.filter(r=>compare(r,current)>0).length;
 const score=Math.round(100*(1-better/usable.length));
 const best=usable.reduce((a,b)=>compare(a,b)<=0?a:b,current);
 return {verified:true,version:1,score,rank:better+1,count:usable.length,better,worse,
  best:best.diagnostics,current:current.diagnostics,
  label:better?'더 나은 비교 후보 있음':'검토 후보 중 최선',
  caveat:'검토 후보 내 순위 점수입니다. 전체 최적·최선 달성률·실제 수동 편성 대비 우수성을 증명하지 않습니다'};
}
function reviewContext(players,settings){
 return JSON.stringify({courts:settings.courts,gamesPerPlayer:settings.gamesPerPlayer,teamMode:settings.teamMode,
  players:players.map(p=>[p.name,p.team,p.gender,p.skillRating??null,p.level,p.grade||'',p.ageGroup||'',p.partnerName||'',p._goal??settings.gamesPerPlayer]).sort((a,b)=>a[0].localeCompare(b[0]))});
}
function scheduleKey(matches){return matches.map(m=>[m.round,m.court,m.type,m.team1A.name,m.team1B.name,m.team2C.name,m.team2D.name].join('|')).sort().join(';');}

const api={assess,rankKey,distribution,refine,allocationCandidates,protects,opponentStats,compareCandidates,reviewContext,scheduleKey};if(typeof module==='object'&&module.exports)module.exports=api;root.KokTeamCompetition=api;
})(typeof globalThis!=='undefined'?globalThis:this);
