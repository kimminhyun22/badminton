#!/usr/bin/env node
'use strict';
// Offline research only. These candidates are not imported by the app or server.
// node scripts/compare-partner-gap-policies.js before.json finished.json > report.json
const fs=require('fs');
const age={'20대':0,'30대':-.2,'40대':-.5,'50대':-1.2,'60대+':-2};
const policies=Object.freeze({
  current:g=>.35*g,
  capped:g=>Math.min(.35*g,.7),
  softcap:g=>.35*g/(1+g/2),
  deadbandCapped:g=>Math.min(.35*Math.max(0,g-1.25),.7),
  noCorrection:()=>0
});
function level(p){
  if(Number.isFinite(p.skillRating))return p.skillRating;
  if(!Number.isFinite(p.l)||!['M','F'].includes(p.g)||!Object.hasOwn(age,p.a))throw Error('Missing rating/profile');
  return Math.round((p.l-(p.g==='F'?.5:0)+age[p.a])*10)/10;
}
function category(margin){return margin>.2+1e-9?'blue':margin<-.2-1e-9?'red':'close';}
function prepare(before,after){
  const members=new Map();
  for(const side of ['blue','red']){
    if(!Array.isArray(before?.members?.[side]))throw Error('Missing team roster');
    for(const p of before.members[side]){
      if(!p.n||members.has(p.n))throw Error('Missing/duplicate player');
      members.set(p.n,{side,level:level(p),estimated:!Number.isFinite(p.skillRating)});
    }
  }
  if(!Array.isArray(before.matches)||!Array.isArray(after.matches))throw Error('Missing matches');
  if(before.matches.length!==after.matches.length)throw Error('Changed match count');
  const results=new Map(after.matches.map(m=>[m.num,m]));
  if(results.size!==after.matches.length||new Set(before.matches.map(m=>m.num)).size!==before.matches.length)throw Error('Duplicate match number');
  return before.matches.map(m=>{
    const a=results.get(m.num);
    if(!a||['t1','t2','round','court','type'].some(k=>JSON.stringify(m[k])!==JSON.stringify(a[k])))throw Error('Changed match arrangement');
    if(!Array.isArray(m.t1)||!Array.isArray(m.t2)||m.t1.length!==2||m.t2.length!==2||new Set([...m.t1,...m.t2]).size!==4)throw Error('Invalid doubles match');
    const pair=(names,side)=>names.map(n=>{const p=members.get(n);if(!p||p.side!==side)throw Error('Missing/wrong-side player');return p;});
    const b=pair(m.t1,'blue'),r=pair(m.t2,'red'),sum=ps=>ps[0].level+ps[1].level,gap=ps=>Math.abs(ps[0].level-ps[1].level);
    const raw=sum(b)-sum(r),blueGap=gap(b),redGap=gap(r);
    const actual=a.voided?null:a.win==='t1'?'blue':a.win==='t2'?'red':null;
    return {num:m.num,round:m.round,court:m.court,raw,blueGap,redGap,actual,estimated:[...b,...r].some(p=>p.estimated),originalDecision:category(raw-policies.current(blueGap)+policies.current(redGap))};
  });
}
function compare(before,after){
  const rows=prepare(before,after),settled=rows.filter(r=>r.actual);
  if(!settled.length)throw Error('No completed results');
  const original=settled.filter(r=>r.originalDecision!=='close');
  const analyses=Object.entries(policies).map(([id,penalty])=>{
    const tally={correct:0,wrong:0,abstain:0},fixed={...tally};
    const matches=settled.map(r=>{
      const margin=r.raw-penalty(r.blueGap)+penalty(r.redGap),decision=category(margin);
      const outcome=decision==='close'?'abstain':decision===r.actual?'correct':'wrong';
      tally[outcome]++;if(r.originalDecision!=='close')fixed[outcome]++;
      return {...r,margin,decision,outcome};
    });
    const decided=tally.correct+tally.wrong;
    return {id,...tally,decided,accuracy:decided?tally.correct/decided:null,originalDecisionSet:{size:original.length,...fixed},matches};
  });
  return {kind:'retrospective-policy-comparison',settled:settled.length,excluded:rows.length-settled.length,closeBand:.2,
    limitation:'Same-event retrospective comparison; abstentions are not correct predictions. No independent predictive validation.',analyses};
}
module.exports={policies,category,prepare,compare};
if(require.main===module){
  try{
    if(process.argv.length!==4)throw Error('Usage: compare-partner-gap-policies.js before.json finished.json');
    const [before,after]=process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p,'utf8')));
    process.stdout.write(JSON.stringify(compare(before,after),null,2)+'\n');
  }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
