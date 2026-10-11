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
  for(const proposal of proposals.slice(0,Math.max(0,Math.min(128,budget)))){const {i,j,fa,fb}=proposal,a=matches[i],b=matches[j],oa={...a},ob={...b};if(proposal.replacement)a[fa]=proposal.replacement;else [a[fa],b[fb]]=[b[fb],a[fa]];update(a);update(b);const next=metrics();evaluations++;
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
// Conditional preference relaxation: one bounded swap, four-game schedules only.
function relax(c,candidate,settings,{budget=128}={}){
const ms=candidate.matches,ps=candidate.participants,policy=c.KokTeamCompetition;
if(!settings.teamMode||settings.gamesPerPlayer!==4||ps.length>64||ms.length>64)return {candidate,evaluations:0,accepted:0};
const evalq=matches=>c._teamCompetitionEvaluation({matches,participants:ps},settings),initial=evalq(ms),base=initial.score.diagnostics;
const female=ps.filter(p=>p.gender==='F');if(!settings.teamMode||settings.gamesPerPlayer!==4||ps.length>64||ms.length>64||female.some(p=>(p._goal??4)!==4)||!initial.score.eligible||initial.legacy.underSlots)return {candidate,evaluations:0,accepted:0};
const w=c.KokWomenDoubles.status(ms,ps,settings).rows,minimum=Object.fromEntries(w.map(p=>[p.name,Math.min(p.women,Math.max(1,p.target-1,p.women-1))])),wd=ms.filter(m=>m.type==='여복').length;
const gap=m=>{const pair=(a,b)=>c.effLevel(a)+c.effLevel(b)-.35*Math.abs(c.effLevel(a)-c.effLevel(b));return Math.abs(pair(m.team1A,m.team1B)-pair(m.team2C,m.team2D));};
const normalize=m=>{const a=[m.team1A,m.team1B].filter(p=>p.gender==='F').length,b=[m.team2C,m.team2D].filter(p=>p.gender==='F').length;m.type=a===2&&b===2?'여복':a===0&&b===0?'남복':a===1&&b===1?'혼복':'보정';m.isAdjustment=m.type==='보정';m.team1Level=c.effLevel(m.team1A)+c.effLevel(m.team1B);m.team2Level=c.effLevel(m.team2C)+c.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;};
const rounds=new Map();ms.forEach(m=>{if(!rounds.has(m.round))rounds.set(m.round,new Set());fields.forEach(k=>rounds.get(m.round).add(m[k].name));});
const schedules=matches=>Object.fromEntries(ps.map(p=>{const rs=matches.filter(m=>fields.some(k=>m[k].name===p.name)).map(m=>m.round).sort((a,b)=>a-b);let run=1,max=rs.length?1:0;rs.slice(1).forEach((r,i)=>{run=r===rs[i]+1?run+1:1;max=Math.max(max,run);});return[p.name,{max,idle:Math.max(0,...rs.slice(1).map((r,i)=>r-rs[i]-1))}];})),bs=schedules(ms);
const womenCount=matches=>Object.fromEntries(c.KokWomenDoubles.status(matches,ps,settings).rows.map(p=>[p.name,p.women]));
const proposals=[];
for(let i=0;i<ms.length;i++)for(let j=i+1;j<ms.length;j++)for(const fa of fields)for(const fb of fields){
 const a=ms[i],b=ms[j],pa=a[fa],pb=b[fb];if(pa.name===pb.name||pa.team!==pb.team||a.win||b.win||a.voided||b.voided||fields.some(k=>a[k].partnerName||b[k].partnerName))continue;
 if(a.round!==b.round&&(rounds.get(a.round).has(pb.name)||rounds.get(b.round).has(pa.name)))continue;
 const na={...a,[fa]:pb},nb={...b,[fb]:pa};normalize(na);normalize(nb);
 if(!c._teamPairBalance([na.team1A,na.team1B],[na.team2C,na.team2D]).allowed||!c._teamPairBalance([nb.team1A,nb.team1B],[nb.team2C,nb.team2D]).allowed)continue;
 const matches=ms.map((m,k)=>k===i?na:k===j?nb:m),max=Math.max(...matches.map(gap));if(base.maxAdjustedGap-max<Math.max(.1,base.maxAdjustedGap*.1)-1e-9)continue;
 const wc=womenCount(matches);if(Object.entries(minimum).some(([n,f])=>wc[n]<f)||matches.filter(m=>m.type==='여복').length<wd-1)continue;
 const as=schedules(matches);if([pa,pb].some(p=>as[p.name].max>Math.max(2,bs[p.name].max)||as[p.name].idle>bs[p.name].idle))continue;
 proposals.push({matches,max,mean:matches.reduce((s,m)=>s+gap(m),0)/matches.length});
}
proposals.sort((a,b)=>a.max-b.max||a.mean-b.mean);let best=null,n=0;
for(const x of proposals.slice(0,Math.max(0,Math.min(128,budget)))){
 const q=evalq(x.matches);n++;const d=q.score.diagnostics,k=['structureErr','genderErr','underSlots','overSlots','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceSevereCount','balanceCautionCount','asymSevereCount','restWorstExcess','restTotalExcess','avoidablePartnerExcess','excessConsec','avoidableSameFour','avoidableExact','sameFourRepeats','exactMatchRepeats','maxPartnerRepeat'];
 if(k.some(k=>(q.legacy[k]||0)>(initial.legacy[k]||0))||q.legacy.sFair<initial.legacy.sFair||q.legacy.sInterval<initial.legacy.sInterval||q.legacy.avgLD>initial.legacy.avgLD+.05+1e-9||q.legacy.maxLD>initial.legacy.maxLD+1e-9||q.legacy.adjustments.length>initial.legacy.adjustments.length+2)continue;
 if(d.meanAdjustedGap>base.meanAdjustedGap+1e-9||d.tailAdjustedGap>base.tailAdjustedGap+1e-9||Math.abs(d.netPerGame)>Math.abs(base.netPerGame)+1e-9||d.closeSensitivity[1].close<base.closeSensitivity[1].close)continue;
 if(Math.abs(d.closeSensitivity[1].blue-d.closeSensitivity[1].white)>Math.max(2,Math.abs(base.closeSensitivity[1].blue-base.closeSensitivity[1].white))||d.closeSensitivity.reduce((s,x)=>s+Math.abs(x.blue-x.white),0)>Math.max(8,base.closeSensitivity.reduce((s,x)=>s+Math.abs(x.blue-x.white),0)))continue;
 const op=policy.opponentStats(x.matches),bop=policy.opponentStats(ms);if(op.max>bop.max||op.excess>bop.excess||op.repeats>bop.repeats)continue;
 if(!best||c._isBetterQualityKey(policy.rankKey(q.score),policy.rankKey(best.q.score)))best={...x,q};
}
return {candidate:best?{participants:ps,matches:best.matches}:candidate,evaluations:n,accepted:best?1:0};
};

// Restore missing women's games only within fixed original safety and rest bounds.
function recoverWomen(c,input,settings,options={}){
 const policy=c.KokTeamCompetition,women=c.KokWomenDoubles,F=['team1A','team1B','team2C','team2D'];
 const limit=Math.min(512,Math.max(0,options.budget??384)),width=Math.min(8,Math.max(1,options.width??6)),depth=Math.min(4,Math.max(1,options.depth??4)),cheapLimit=Math.min(12000,Math.max(0,options.cheapBudget??6000));
 let evaluations=0,examined=0,accepted=0;
 const unchanged=reason=>({candidate:input,evaluations,examined,accepted:0,reason});
 if(!settings.teamMode||settings.gamesPerPlayer!==4||!input?.participants?.length||input.participants.length>64||!input.matches?.length||input.matches.length>64||input.matches.some(m=>m.win||m.voided))return unchanged('unsupported-or-started');
 if(['청팀','홍팀'].some(t=>input.participants.filter(p=>p.team===t&&p.gender==='F').length<2))return unchanged('insufficient-women-on-a-team');
 const origin=c._teamCopyFinalCandidate(options.origin||input.womenRecoveryOrigin||input),working=c._teamCopyFinalCandidate(input);
 if(policy.reviewContext(origin.participants,settings)!==policy.reviewContext(working.participants,settings)||(origin.settings&&['courts','gamesPerPlayer','teamMode'].some(k=>origin.settings[k]!==settings[k]))||origin.matches.some(m=>m.win||m.voided)||origin.matches.length!==working.matches.length)return unchanged('mismatched-origin');
 const initial=c._teamCompetitionEvaluation(origin,settings),workingEvaluation=c._teamCompetitionEvaluation(working,settings),base=initial.score.diagnostics,qs=initial.legacy;
 if(!initial.score.eligible||qs.underSlots)return unchanged('invalid-initial-schedule');
 const status=b=>women.status(b.matches,b.participants,settings).rows;
 const startWomen=status(origin),caps={max:Math.min(1.5,base.maxAdjustedGap+.35),mean:base.meanAdjustedGap+.10,tail:base.tailAdjustedGap+.25,close:Math.max(0,base.closeSensitivity[1].close-2),favored:Math.abs(base.closeSensitivity[1].blue-base.closeSensitivity[1].white)+2};
 const burden=b=>{const out={};for(const p of b.participants){const rs=b.matches.filter(m=>F.some(k=>m[k].name===p.name)).map(m=>m.round).sort((a,b)=>a-b);let longest=0,run=0,idle=0;rs.forEach((r,i)=>{run=i&&r===rs[i-1]+1?run+1:1;longest=Math.max(longest,run);if(i)idle=Math.max(idle,r-rs[i-1]-1);});out[p.name]={games:rs.length,longest,idle};}return out;},bs=burden(origin),bos=policy.opponentStats(origin.matches);
 const wl=b=>{const w=status(b);return [w.filter(p=>p.women===0).length,w.reduce((z,p)=>z+Math.max(0,p.target-p.women),0)];};
 const rank=(b,e)=>[...wl(b),e.score.diagnostics.maxAdjustedGap,e.score.diagnostics.tailAdjustedGap,e.score.diagnostics.meanAdjustedGap,-e.score.diagnostics.closeSensitivity[1].close,-e.score.total];
 const compare=(a,b)=>{for(let i=0;i<a.length;i++){const d=a[i]-b[i];if(Math.abs(d)>1e-9)return d;}return 0;};
 const gap=m=>{const pair=(a,b)=>c.effLevel(a)+c.effLevel(b)-.35*Math.abs(c.effLevel(a)-c.effLevel(b));return Math.abs(pair(m.team1A,m.team1B)-pair(m.team2C,m.team2D));};
 const update=m=>{const a=[m.team1A,m.team1B].filter(p=>p.gender==='F').length,b=[m.team2C,m.team2D].filter(p=>p.gender==='F').length;m.type=a===2&&b===2?'여복':a===0&&b===0?'남복':a===1&&b===1?'혼복':'보정';m.isAdjustment=m.type==='보정';m.team1Level=c.effLevel(m.team1A)+c.effLevel(m.team1B);m.team2Level=c.effLevel(m.team2C)+c.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;};
 // Keep warning counts as well as mandatory validity: preference cannot buy a new warning.
 const protectedKeys=['structureErr','genderErr','underSlots','overSlots','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceCautionCount','balanceSevereCount','asymSevereCount','restWorstExcess','restTotalExcess','avoidablePartnerExcess','excessConsec','avoidableSameFour','avoidableExact','sameFourRepeats','exactMatchRepeats','maxPartnerRepeat'];
 function safe(b,e){if(!e.score.eligible||e.score.total<workingEvaluation.score.total-1e-9||b.matches.length!==origin.matches.length||Math.max(...b.matches.map(m=>m.round))!==Math.max(...origin.matches.map(m=>m.round)))return false;
  if([qs,workingEvaluation.legacy].some(reference=>protectedKeys.some(k=>(e.legacy[k]||0)>(reference[k]||0))))return false;
  const d=e.score.diagnostics,close=d.closeSensitivity[1];if(d.maxAdjustedGap>caps.max+1e-9||d.meanAdjustedGap>caps.mean+1e-9||d.tailAdjustedGap>caps.tail+1e-9||close.close<caps.close||Math.abs(close.blue-close.white)>caps.favored)return false;
  const op=policy.opponentStats(b.matches),currentOp=policy.opponentStats(working.matches);if([bos,currentOp].some(reference=>op.max>reference.max||op.excess>reference.excess||op.repeats>reference.repeats))return false;
  const after=burden(b);if(Object.entries(bs).some(([n,p])=>!after[n]||after[n].games!==p.games||after[n].longest>p.longest||after[n].idle>p.idle))return false;
  const sw=status(b);if(startWomen.some(p=>sw.find(q=>q.name===p.name).women<Math.min(p.women,p.target)))return false;
  return true;
 }
 const pairs=a=>a.flatMap((p,i)=>a.slice(i+1).map(q=>[p,q])),perms=a=>a.length<2?[a]:[a,[a[1],a[0]]];
 function proposals(b){const out=[],seen=new Set(),currentWomen=Object.fromEntries(status(b).map(p=>[p.name,p])),rounds=[...new Set(b.matches.map(m=>m.round))].sort((a,b)=>a-b);
  outer:for(const r of rounds){const ms=b.matches.map((m,i)=>({m,i})).filter(x=>x.m.round===r),female=ms.flatMap(x=>F.map(k=>x.m[k])).filter(p=>p.gender==='F'&&!p.partnerName).sort((a,b)=>currentWomen[a.name].women-currentWomen[b.name].women||a.name.localeCompare(b.name));
   for(const a of pairs(female.filter(p=>p.team==='청팀')))for(const z of pairs(female.filter(p=>p.team==='홍팀'))){if(!c._teamPairBalance(a,z).allowed)continue;for(const target of ms){if(F.some(k=>target.m[k].partnerName))continue;const displacements=[];for(const [desired,side] of [[a,F.slice(0,2)],[z,F.slice(2)]]){const wanted=new Set(desired.map(p=>p.name)),outgoing=side.map(k=>target.m[k]).filter(p=>!wanted.has(p.name)),vacated=ms.filter(x=>x.i!==target.i).flatMap(x=>side.filter(k=>wanted.has(x.m[k].name)).map(k=>({i:x.i,k})));displacements.push({outgoing,vacated});}
    if(displacements.some(x=>x.outgoing.length!==x.vacated.length||x.outgoing.some(p=>p.partnerName)||x.vacated.some(slot=>F.some(k=>b.matches[slot.i][k].partnerName))))continue;
    for(const one of perms(displacements[0].outgoing))for(const two of perms(displacements[1].outgoing)){if(examined>=cheapLimit)break outer;examined++;const matches=b.matches.map(m=>({...m}));[matches[target.i].team1A,matches[target.i].team1B,matches[target.i].team2C,matches[target.i].team2D]=[...a,...z];[one,two].forEach((ps,i)=>displacements[i].vacated.forEach((slot,j)=>matches[slot.i][slot.k]=ps[j]));
     const changed=ms.filter(x=>F.some(k=>matches[x.i][k].name!==x.m[k].name));changed.forEach(x=>update(matches[x.i]));if(!changed.length||changed.some(x=>!c._teamPairBalance([matches[x.i].team1A,matches[x.i].team1B],[matches[x.i].team2C,matches[x.i].team2D]).allowed))continue;
     const candidate={...b,matches},w=wl(candidate);if(compare(w,wl(b))>=0||!women.preserves(b.matches,matches,b.participants,settings))continue;
     const ds=matches.map(gap).sort((a,b)=>b-a),max=ds[0],mean=ds.reduce((x,y)=>x+y,0)/ds.length;if(max>caps.max+1e-9||mean>caps.mean+1e-9)continue;
     const signature=policy.scheduleKey(matches);if(seen.has(signature))continue;seen.add(signature);out.push({candidate,quick:[...w,max,mean],signature});
    }
   }}
  }
  return out.sort((a,b)=>compare(a.quick,b.quick)||a.signature.localeCompare(b.signature));
 }
 if(!safe(working,workingEvaluation))return unchanged('input-outside-origin-protection');
 let best={candidate:working,evaluation:workingEvaluation,rank:rank(working,workingEvaluation),moves:0},beam=[best];const allSeen=new Set([policy.scheduleKey(working.matches)]);
 for(let pass=0;pass<depth&&evaluations<limit&&examined<cheapLimit;pass++){
  const choices=[];for(const node of beam){for(const p of proposals(node.candidate)){if(evaluations>=limit)break;if(allSeen.has(p.signature))continue;allSeen.add(p.signature);const e=c._teamCompetitionEvaluation(p.candidate,settings);evaluations++;if(!safe(p.candidate,e))continue;const n={candidate:p.candidate,evaluation:e,rank:rank(p.candidate,e),moves:node.moves+1};choices.push(n);if(compare(n.rank,best.rank)<0)best=n;}}
  if(!choices.length)break;choices.sort((a,b)=>compare(a.rank,b.rank));beam=choices.slice(0,width);
 }
 if(best.moves===0)return {...unchanged('no-safe-recovery'),caps};accepted=best.moves;
 const candidate=c._teamCopyFinalCandidate(best.candidate);
 // Store a detached, nonrecursive anchor. Callers must persist this alongside
 // the schedule and deep-copy it when copying the schedule.
 candidate.womenRecoveryOrigin=c._teamCopyFinalCandidate({participants:origin.participants,matches:origin.matches,settings:{courts:settings.courts,gamesPerPlayer:settings.gamesPerPlayer,teamMode:settings.teamMode}});
 return {candidate,evaluations,examined,accepted,reason:'women-recovered',before:wl(working),after:wl(best.candidate),caps};
};

return {plan:planWomen,optimize,status,preserves,safe,relax,recover:recoverWomen};
});
