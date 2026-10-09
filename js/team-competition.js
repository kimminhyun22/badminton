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
 const closenessLoss=average(margins.map(x=>clamp(Math.abs(x)/1.5)));
 const gameLoss=.75*originalGameLoss+.25*closenessLoss;
 const rosterLoss=.45*clamp(meanGap/.5)+.4*clamp(quantileGap/1)+.15*clamp(genderGap/.5);
 // Continuous signed advantage; no discontinuous bonus at the close threshold.
 const net=average(margins),softBias=average(margins.map(x=>x/(Math.abs(x)+.2)));
 const overallLoss=.5*clamp(Math.abs(net)/.5)+.5*Math.abs(softBias);
 const components={games:30*(1-gameLoss),roster:10*(1-rosterLoss),overall:10*(1-overallLoss),participation:q.sFair,diversity:q.sDiversity,rest:q.sInterval};
 const total=Math.round(Object.values(components).reduce((a,b)=>a+b,0)*10)/10;
 const issues=[...q.safetyIssues];
 const diagnostics={meanGap,quantileGap,genderGap,meanAdjustedGap:average(margins.map(Math.abs)),maxAdjustedGap:Math.max(...margins.map(Math.abs)),netPerGame:net,softBias,
  closeSensitivity:[.15,.2,.25,.3].map(t=>({threshold:t,blue:margins.filter(x=>x>t).length,white:margins.filter(x=>x< -t).length,close:margins.filter(x=>Math.abs(x)<=t).length}))};
 return {version:4,total,components,maxima:{games:30,roster:10,overall:10,participation:20,diversity:20,rest:10},eligible:issues.length===0,issues,diagnostics,legacyTotal:q.total};
}
function rankKey(q){return [q.eligible?0:1,q.issues.length,-q.total,-q.components.games,-q.components.overall];}

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
function opponentStats(matches){const counts={};matches.forEach(m=>[m.team1A,m.team1B].forEach(a=>[m.team2C,m.team2D].forEach(b=>{const k=[a.name,b.name].sort().join('|');counts[k]=(counts[k]||0)+1;})));return {max:Math.max(0,...Object.values(counts)),excess:Object.values(counts).reduce((s,n)=>s+Math.max(0,n-3),0)};}
function protects(base,next,bq,nq,baseMatches,nextMatches){
 const keys=['structureErr','genderErr','avoidableUnderSlots','underSlots','avoidableOverSlots','overSlots','balanceHardCount','balanceSevereCount','balanceCautionCount','asymSevereCount','restWorstExcess','avoidablePartnerExcess','excessConsec'];
 if(keys.some(k=>(next[k]||0)>(base[k]||0)))return false;
 if(next.sFair<base.sFair||next.sDiversity<base.sDiversity||next.sInterval<base.sInterval||next.total<base.total)return false;
 if(next.avgLD>base.avgLD+.05+1e-9||next.maxLD>Math.max(base.maxLD,Math.min(1.5,base.maxLD+.2))+1e-9)return false;
 const b=bq.diagnostics,n=nq.diagnostics;if(n.meanAdjustedGap>b.meanAdjustedGap+.05+1e-9||Math.abs(n.netPerGame)>Math.abs(b.netPerGame)+1e-9)return false;
 const bc=b.closeSensitivity,nc=n.closeSensitivity;
 if(Math.abs(nc[1].blue-nc[1].white)>Math.abs(bc[1].blue-bc[1].white))return false;
 if(nc.reduce((s,x)=>s+Math.abs(x.blue-x.white),0)>bc.reduce((s,x)=>s+Math.abs(x.blue-x.white),0))return false;
 // Keep close games within one appearance quartet, rather than hiding a drop behind a high total.
 if(nc[1].close<bc[1].close-2)return false;
 const bo=opponentStats(baseMatches),no=opponentStats(nextMatches);if(no.max>bo.max||no.excess>bo.excess)return false;
 return true;
}

const api={assess,rankKey,distribution,refine,protects,opponentStats};if(typeof module==='object'&&module.exports)module.exports=api;root.KokTeamCompetition=api;
})(typeof globalThis!=='undefined'?globalThis:this);
