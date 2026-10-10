/* Women's doubles preference; separate from the v4 quality score. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.KokWomenDoubles=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

// Fixed teams, bounded beam search, unchanged skill safety limits.
function planWomen(players,settings,pairBalance,eff){
 const f=players.filter(p=>p.gender==='F'),teams=['청팀','홍팀'];
 const goal=p=>Math.ceil((p._goal??settings.gamesPerPlayer)*(settings.womenShare??.5));
 const pools=teams.map(t=>f.filter(p=>p.team===t));
 if(pools.some(a=>a.length<2))return {matches:[],reason:'fewer-than-two-women-on-a-side',targets:f.map(goal)};
 const pairs=a=>a.flatMap((p,i)=>a.slice(i+1).filter(q=>(!p.partnerName||p.partnerName===q.name)&&(!q.partnerName||q.partnerName===p.name)).map(q=>[p,q]));
 let candidates=[];
 for(const a of pairs(pools[0]))for(const b of pairs(pools[1])){const q=pairBalance(a,b);if(q.allowed)candidates.push({names:[...a,...b].map(p=>p.name),gap:q.adjustedDiff,cost:q.adjustedDiff+Math.max(0,Math.abs(Math.abs(eff(a[0])-eff(a[1]))-Math.abs(eff(b[0])-eff(b[1])))-1.5)*2});}
 // Bound the search while retaining safe choices for every woman.
 if(candidates.length>192){const selected=new Set();for(const person of f)candidates.filter(q=>q.names.includes(person.name)).sort((a,b)=>a.cost-b.cost).slice(0,6).forEach(q=>selected.add(q));candidates.sort((a,b)=>a.cost-b.cost).slice(0,96).forEach(q=>selected.add(q));candidates=[...selected];}
 if(!candidates.length)return {matches:[],reason:'no-safe-women-quartet',targets:f.map(goal)};
 const cap=Math.min(...pools.map(a=>Math.floor(a.reduce((s,p)=>s+(p._goal??settings.gamesPerPlayer),0)/2)));
 const requested=Math.ceil(Math.max(...pools.map(a=>a.reduce((s,p)=>s+goal(p),0)))/2);
 const limit=Math.min(cap,requested+1);
 const rank=s=>[f.reduce((z,p)=>z+Math.max(0,goal(p)-(s.count[p.name]||0)),0),-f.filter(p=>(s.count[p.name]||0)>=goal(p)).length,
  ...(settings._closePriority?[s.worst,s.plan.length?s.gapSum/s.plan.length:0,s.cost,s.plan.length]:[s.plan.length,s.cost])];
 const compare=(a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
 let beam=[{count:{},partners:{},opponents:{},plan:[],cost:0,worst:0,gapSum:0}],best=beam[0];
 for(let step=0;step<limit;step++){
  const next=[],seen=new Set();
  for(const s of beam)for(let k=0;k<candidates.length;k++){
   const q=candidates[k];if(q.names.some(n=>(s.count[n]||0)>=(players.find(p=>p.name===n)._goal??settings.gamesPerPlayer)))continue;
   const op=q.names.slice(0,2).flatMap(a=>q.names.slice(2).map(b=>[a,b].sort().join('|'))),pa=[q.names.slice(0,2).sort().join('|'),q.names.slice(2).sort().join('|')];
   if(op.some(n=>(s.opponents[n]||0)>=3))continue;
   const key=[...s.plan,k].sort((a,b)=>a-b).join(',');if(seen.has(key))continue;seen.add(key);
   const n={count:{...s.count},partners:{...s.partners},opponents:{...s.opponents},plan:[...s.plan,k],cost:s.cost+q.cost+pa.reduce((z,n)=>z+(s.partners[n]||0)*.4,0),worst:Math.max(s.worst,q.gap),gapSum:s.gapSum+q.gap};
   q.names.forEach(p=>n.count[p]=(n.count[p]||0)+1);pa.forEach(p=>n.partners[p]=(n.partners[p]||0)+1);op.forEach(p=>n.opponents[p]=(n.opponents[p]||0)+1);next.push(n);
  }
  if(!next.length)break;next.sort(compare);beam=next.slice(0,72);if(compare(beam[0],best)<0)best=beam[0];if(rank(best)[0]===0&&!settings._closePriority)break;
 }
 return {matches:best.plan.map(k=>candidates[k].names),reason:rank(best)[0]?'limited-safe-coverage':'target-covered',shortfall:rank(best)[0],candidateCount:candidates.length,targets:f.map(goal)};
};

const fields=['team1A','team1B','team2C','team2D'];
function optimize(c,candidate,settings,{joint=false,passes=6,budget=48}={}){
 const {matches,participants:p}=candidate;const goal=n=>Math.ceil((p.find(p=>p.name===n)._goal??settings.gamesPerPlayer)/2);
 const counts=()=>{const w={};matches.forEach(m=>{if(m.type==='여복')fields.forEach(k=>w[m[k].name]=(w[m[k].name]||0)+1);});return w;};
 const initialWomen=counts(),minimum=Object.fromEntries(p.filter(p=>p.gender==='F').map(p=>[p.name,Math.min(goal(p.name),initialWomen[p.name]||0)]));
 const metrics=()=>{const q=c._qualityAssessment(matches,p,settings),v=c._teamCompetitionEvaluation(candidate,settings).score;return {q,v,opponents:c.KokTeamCompetition.opponentStats(matches)};};let current=metrics(),initial=current,evaluations=0,accepted=0;
 const update=m=>{const f1=[m.team1A,m.team1B].filter(p=>p.gender==='F').length,f2=[m.team2C,m.team2D].filter(p=>p.gender==='F').length;m.type=f1===2&&f2===2?'여복':f1===0&&f2===0?'남복':f1===1&&f2===1?'혼복':'보정';m.isAdjustment=m.type==='보정';m.team1Level=c.effLevel(m.team1A)+c.effLevel(m.team1B);m.team2Level=c.effLevel(m.team2C)+c.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;};
 const cost=m=>{const b=c._teamPairBalance([m.team1A,m.team1B],[m.team2C,m.team2D]);return Math.max(b.rawDiff,b.adjustedDiff)**2+Math.max(0,b.adjustedDiff-.2)*.15;};
 const protectedKeys=['structureErr','genderErr','underSlots','overSlots','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceSevereCount','asymSevereCount'];
 for(let pass=0;pass<passes;pass++){
  const wc=counts(),roundNames=new Map();matches.forEach(m=>{if(!roundNames.has(m.round))roundNames.set(m.round,new Map());fields.forEach(k=>{const n=m[k].name,z=roundNames.get(m.round);z.set(n,(z.get(n)||0)+1);});});
  const proposals=[];
  for(let i=0;i<matches.length;i++)for(let j=i+1;j<matches.length;j++)for(const fa of fields)for(const fb of fields){
   const a=matches[i],b=matches[j],pa=a[fa],pb=b[fb];if(pa.name===pb.name||pa.team!==pb.team||pa.partnerName||pb.partnerName||a.win||b.win||a.voided||b.voided)continue;
   if(!joint&&(a.round!==b.round||pa.gender!==pb.gender))continue;
   if(a.round!==b.round&&(roundNames.get(a.round).has(pb.name)||roundNames.get(b.round).has(pa.name)))continue;
   if(fields.some(k=>k!==fa&&a[k].name===pb.name)||fields.some(k=>k!==fb&&b[k].name===pa.name))continue;
   const oa={...a},ob={...b},before=cost(a)+cost(b);a[fa]=pb;b[fb]=pa;update(a);update(b);
   const qa=c._teamPairBalance([a.team1A,a.team1B],[a.team2C,a.team2D]),qb=c._teamPairBalance([b.team1A,b.team1B],[b.team2C,b.team2D]);
   const changedWomen={};for(const [m,sign] of [[oa,-1],[ob,-1],[a,1],[b,1]])if(m.type==='여복')fields.forEach(k=>changedWomen[m[k].name]=(changedWomen[m[k].name]||0)+sign);
   const quotaSafe=Object.entries(changedWomen).every(([n,v])=>(wc[n]||0)+v>=(minimum[n]||0));
   if(qa.allowed&&qb.allowed&&quotaSafe){let restDelta=0;if(a.round!==b.round){for(const [person,from,to] of [[pa,a.round,b.round],[pb,b.round,a.round]]){const old=[from-1,from+1].filter(r=>roundNames.get(r)?.has(person.name)).length,newc=[to-1,to+1].filter(r=>r!==from&&roundNames.get(r)?.has(person.name)).length;restDelta+=newc-old;}}proposals.push({i,j,fa,fb,gain:before-cost(a)-cost(b)-restDelta*.12});}
   Object.assign(a,oa);Object.assign(b,ob);
  }
  if(joint){
   const played={};matches.forEach(m=>fields.forEach(k=>played[m[k].name]=(played[m[k].name]||0)+1));
   const under=p.filter(a=>(played[a.name]||0)<(a._goal??settings.gamesPerPlayer));
   for(const person of under)for(let i=0;i<matches.length;i++)for(const fa of fields){const a=matches[i],old=a[fa];if(old.team!==person.team||old.partnerName||person.partnerName||(played[old.name]||0)<=(old._goal??settings.gamesPerPlayer)||roundNames.get(a.round).has(person.name))continue;
    const oa={...a},before=cost(a);a[fa]=person;update(a);const q=c._teamPairBalance([a.team1A,a.team1B],[a.team2C,a.team2D]),delta={};if(oa.type==='여복')fields.forEach(k=>delta[oa[k].name]=(delta[oa[k].name]||0)-1);if(a.type==='여복')fields.forEach(k=>delta[a[k].name]=(delta[a[k].name]||0)+1);
    if(q.allowed&&Object.entries(delta).every(([n,v])=>(wc[n]||0)+v>=(minimum[n]||0)))proposals.push({i,j:i,fa,fb:fa,replacement:person,gain:100+before-cost(a)});Object.assign(a,oa);
   }
  }
  proposals.sort((a,b)=>b.gain-a.gain);let best=null;
  for(const proposal of proposals.slice(0,budget)){const {i,j,fa,fb}=proposal,a=matches[i],b=matches[j],oa={...a},ob={...b};if(proposal.replacement)a[fa]=proposal.replacement;else [a[fa],b[fb]]=[b[fb],a[fa]];update(a);update(b);const next=metrics();evaluations++;
   const safe=protectedKeys.every(k=>(next.q[k]||0)<=(initial.q[k]||0))&&next.q.restWorstExcess<=initial.q.restWorstExcess&&next.q.excessConsec<=current.q.excessConsec&&next.q.avgLD<=(next.q.underSlots<current.q.underSlots?initial.q.avgLD:current.q.avgLD)+1e-9&&next.q.maxLD<=initial.q.maxLD+1e-9&&next.opponents.max<=Math.max(3,initial.opponents.max)&&next.q.avoidablePartnerExcess<=initial.q.avoidablePartnerExcess+1&&next.v.diagnostics.meanAdjustedGap<=(next.q.underSlots<current.q.underSlots?initial.v.diagnostics.meanAdjustedGap:current.v.diagnostics.meanAdjustedGap)+1e-9;
   if(safe&&(next.q.underSlots<current.q.underSlots||next.v.total>current.v.total+.00001)&&(!best||next.q.underSlots<best.next.q.underSlots||(next.q.underSlots===best.next.q.underSlots&&next.v.total>best.next.v.total)))best={...proposal,next};Object.assign(a,oa);Object.assign(b,ob);
  }
  if(!best)break;const {i,j,fa,fb}=best;if(best.replacement)matches[i][fa]=best.replacement;else [matches[i][fa],matches[j][fb]]=[matches[j][fb],matches[i][fa]];update(matches[i]);update(matches[j]);current=best.next;accepted++;
 }
 return {candidate,evaluations,accepted,initialScore:initial.v.total,finalScore:current.v.total};
};

function status(matches,players,settings){
 const played={},women={};
 matches.filter(m=>!m.voided).forEach(m=>fields.forEach(k=>{const n=m[k].name;played[n]=(played[n]||0)+1;if(m.type==='여복')women[n]=(women[n]||0)+1;}));
 const rows=players.filter(p=>p.gender==='F').map(p=>({name:p.name,total:played[p.name]||0,women:women[p.name]||0,target:Math.ceil(Math.max(settings.gamesPerPlayer||0,played[p.name]||0)/2)}));
 return {rows,covered:rows.filter(p=>p.women>=p.target).length,total:rows.length};
}
function preserves(before,after,players,settings){
 const a=status(before,players,settings),b=status(after,players,settings);
 return a.rows.every(p=>{const n=b.rows.find(q=>q.name===p.name);return n.women>=Math.min(p.target,p.women);});
}
function safe(c,base,next,settings){
 const a=c._qualityAssessment(base.matches,base.participants,settings),b=c._qualityAssessment(next.matches,next.participants,settings);
 return ['structureErr','genderErr','underSlots','overSlots','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceSevereCount','asymSevereCount'].every(k=>(b[k]||0)<=(a[k]||0))&&next.matches.length===base.matches.length&&Math.max(...next.matches.map(m=>m.round))<=Math.max(...base.matches.map(m=>m.round));
}
return {plan:planWomen,optimize,status,preserves,safe};
});
