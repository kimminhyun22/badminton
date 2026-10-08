'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');
function build(file,seed,old=false){
 const src=fs.readFileSync(path.join(root,'js',file),'utf8');
 const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
 const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const c={Math:math};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'js/match-quality.js'),'utf8'),c);
 const setup=src.split('let _currentRound=1;')[0];
 // daily.js has a different bootstrap; reuse the common team rating helpers.
 const team=fs.readFileSync(path.join(root,'js/team.js'),'utf8').split('let _currentRound=1;')[0];
 let allocation=cut('function balanceTeams(all','/* ═══ GENERATE ═══ */');
 // Reconstruct the old allocator, including absence of the new final refinement.
 // Removing only the old 0.5 weight no longer disables gender balancing.
 if(old){
   allocation=allocation.replace('genderD*0.5','genderD*0');
   const a=allocation.indexOf('  // Refine the complete roster:');
   const b=allocation.indexOf('  return best || {blue:[],white:[]};',a);
   if(a>=0&&b>a)allocation=allocation.slice(0,a)+allocation.slice(b);
 }
 vm.runInContext((file==='team.js'?setup:team)+cut('function fisherYates(arr)','\n')+allocation,c);
 return c;
}
function metrics(c,result){
 const avg=a=>a.reduce((s,p)=>s+c.effLevel(p),0)/a.length;
 const gender=[false,true].reduce((s,f)=>{const b=result.blue.filter(p=>(p.gender==='F')===f),w=result.white.filter(p=>(p.gender==='F')===f);return s+(b.length&&w.length?Math.abs(avg(b)-avg(w)):0);},0);
 return {gender,gap:Math.abs(avg(result.blue)-avg(result.white))};
}
let oldGap=0,newGap=0,cases=0;
for(const size of [16,29,32,36])for(const seed of [7,19,43]){
 const roster=Array.from({length:size},(_,i)=>({name:'E2E'+i,level:1+(i*7+i%3)%6,gender:i%3===0?'F':'M',ageGroup:['20대','30대','40대','50대'][i%4]}));
 const old=build('team.js',seed,true),fresh=build('team.js',seed),copy=build('daily.js',seed);
 const before=old.balanceTeams(roster),after=fresh.balanceTeams(roster),daily=copy.balanceTeams(roster);
 assert.equal(JSON.stringify(after),JSON.stringify(daily),'Both allocation paths must agree');
 assert.equal(after.blue.length+after.white.length,size);
 assert.equal(new Set([...after.blue,...after.white].map(p=>p.name)).size,size);
 assert(Math.abs(after.blue.length-after.white.length)<=1);
 assert(Math.abs(after.blue.filter(p=>p.gender==='F').length-after.white.filter(p=>p.gender==='F').length)<=1);
 const a=metrics(old,before),b=metrics(fresh,after);oldGap+=a.gender;newGap+=b.gender;cases++;
 assert(b.gap<=0.3,'Preserve whole-team balance');
}
assert(newGap<oldGap*0.95,'Removing gender cost must lose the aggregate improvement');
console.log(JSON.stringify({cases,oldGenderGap:oldGap/cases,newGenderGap:newGap/cases}));
// Fixed leaders are not returned in movable pools or reassigned.
const c=build('team.js',7),seedB={name:'E2E固定B',gender:'F',level:4},seedW={name:'E2E固定W',gender:'F',level:3};
const result=c.balanceTeams([{name:'E2EA',gender:'M',level:3},{name:'E2EB',gender:'M',level:3}],[seedB],[seedW]);
assert(![...result.blue,...result.white].some(p=>p===seedB||p===seedW));
console.log('PASS gender distribution, headcounts, shared parity, fixed seeds');
