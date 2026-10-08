'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function build(file,old=false){
  let src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  if(old){const a=src.indexOf('  // Refine the complete roster:');const b=src.indexOf('  return best || {blue:[],white:[]};',a);src=src.slice(0,a)+src.slice(b);}
  const cut = (a, b) => {
    const i = src.indexOf(a);
    assert(i >= 0, `${file}: 시작 표지를 못 찾음: ${a}`);
    const j = src.indexOf(b, i + a.length);
    assert(j > i, `${file}: 끝 표지를 못 찾음: ${b}`);
    return src.slice(i, j);
  };
  // Math.random 을 씨앗 고정 LCG 로 바꿔 결과를 결정적으로 만듭니다.
  let _seed = 20260814;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    _seed = (_seed * 1103515245 + 12345) % 2147483648;
    return _seed / 2147483648;
  };
  const sandbox = {console, Object, Number, String, Array, JSON, Math: seededMath, Infinity};
  vm.createContext(sandbox);
  vm.runInContext(`
const MATCH_QUALITY = null;
function effLevel(p){
  const isF = p.gender==='F' || p.gender==='여';
  const _AGE_BONUS={'20대':0,'30대':-0.2,'40대':-0.5,'50대':-1.2,'60대+':-2.0};
  const ageMod = _AGE_BONUS[p.ageGroup] || 0;
  return Math.round((p.level - (isF ? 0.5 : 0) + ageMod) * 10) / 10;
}
${cut('function levelToGrade(level,gender)', 'function effLevel(p){')}
${cut('function fisherYates(arr)', '\n')}
${src.includes('function _teamRosterAverageBalance(')?cut('function _teamRosterAverageBalance(', 'const BALANCE_PARTNER_GAP_OK'):''}
${cut('function balanceTeams(all', '\n/* ═══ GENERATE ═══ */')}
this.api = {balanceTeams, effLevel};
`, sandbox);
  return sandbox.api;
}


const rows=[[5, "F", "A", "40대"], [5, "F", "A", "50대"], [5, "F", "A", "50대"], [2, "F", "D", "40대"], [5, "M", "B", "30대"], [4.6, "M", "C", "30대"], [3.6, "M", "C", "30대"], [4.8, "M", "C", "50대"], [3.8, "M", "C", "40대"], [4.4, "M", "C", "50대"], [3, "M", "D", "50대"], [2.4, "M", "E", "40대"], [2.2, "M", "D", "30대"], [2.6, "M", "D", "40대"], [2.6, "M", "D", "40대"], [2.4, "M", "D", "40대"], [2.4, "M", "D", "40대"], [2, "M", "E", "50대"], [2.8, "F", "D", "30대"], [3.4, "F", "C", "30대"], [1, "F", "E", "50대"], [4, "M", "C", "30대"], [4, "M", "C", "30대"], [4.2, "M", "C", "30대"], [4, "M", "C", "40대"], [4.6, "M", "C", "50대"], [4.4, "M", "C", "50대"], [3.6, "M", "C", "40대"], [3.2, "M", "C", "30대"], [2.8, "M", "D", "40대"], [2.6, "M", "D", "30대"], [2.8, "M", "D", "40대"], [3.6, "M", "D", "50대"], [2.4, "M", "D", "30대"], [2.8, "M", "D", "30대"], [2.8, "M", "D", "30대"]];

const players=()=>rows.map(([level,gender,grade,ageGroup],i)=>({name:'E2E'+i,level,gender,grade,ageGroup}));
for(const file of ['team.js','daily.js']){
 const api=build(file),roster=players(),before=JSON.stringify(roster),split=api.balanceTeams(roster);
 const avg=ps=>ps.reduce((s,p)=>s+api.effLevel(p),0)/ps.length;
 const gap=s=>Math.max(...['M','F'].map(g=>Math.abs(avg(s.blue.filter(p=>p.gender===g))-avg(s.white.filter(p=>p.gender===g)))));
 assert(gap(split)<=0.15,'Do not hide sex-specific imbalance in overall averages');
 assert.equal(split.blue.length,18);assert.equal(split.white.length,18);
 assert.equal(new Set([...split.blue,...split.white]).size,36);
 assert(Math.abs(avg(split.blue)-avg(split.white))<=0.15);
 assert.equal(JSON.stringify(roster),before,'No participant mutation');
 const old=build(file,true);assert(gap(old.balanceTeams(players()))>0.3,'Mutation must restore the reproduced gender imbalance');
 const seedBlue=roster.slice(0,2),seedWhite=roster.slice(18,20),free=roster.filter(p=>!seedBlue.includes(p)&&!seedWhite.includes(p));
 const frozen=JSON.stringify([seedBlue,seedWhite]);const locked=api.balanceTeams(free,seedBlue,seedWhite);
 assert.equal(JSON.stringify([seedBlue,seedWhite]),frozen);
 assert(![...locked.blue,...locked.white].some(p=>seedBlue.includes(p)||seedWhite.includes(p)),'Return only unseeded players; fixed captains/partners stay put');
 assert.equal(new Set([...locked.blue,...locked.white,...seedBlue,...seedWhite]).size,36);
 console.log(file+' PASS gender balance, total balance, headcount, seeds, participant immutability, mutation');
}
