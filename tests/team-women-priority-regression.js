'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),build=require('./helpers/team-competition-context');
const source=fs.readFileSync('js/women-doubles.js','utf8');
function roster(n,f,gpp){return Array.from({length:n},(_,i)=>({name:'E2E'+i,gender:i<f?'F':'M',team:i%2?'홍팀':'청팀',level:3,skillRating:3+(i%4)*.1,_goal:gpp,gamesPlayed:0,lastRoundPlayed:0,womenDoublesPlayed:0,menDoublesPlayed:0,mixedDoublesPlayed:0,adjustmentPlayed:0,partnerCount:{},opponentCount:{}}));}
for(const [n,f,gpp,courts] of [[16,4,2,3],[24,6,4,3],[20,3,4,3]]){
 const c=build(71),s={teamMode:true,courts,gamesPerPlayer:gpp,mixedDoublesPerPerson:0,targetMixedDoubles:0,targetWomenDoubles:Math.floor(f*gpp/4),targetMenDoubles:Math.floor((n-f)*gpp/4)},p=roster(n,f,gpp),count=c._participationSlotStats(p,s,{}).minimumMatches,m=c.generateMatches(p,s,count);c.fillMissingGames(p,s,m,count);c.compactSchedule(m,s);
 const base={matches:m,participants:p},before=JSON.stringify(m),out=c._teamWomenPriorityChoice(base,p,s,count);
 assert(c.KokWomenDoubles.safe(c,base,out,s));
 if(f>=4)assert.equal(c.KokWomenDoubles.status(out.matches,out.participants,s).covered,f);
 else assert.equal(JSON.stringify(out.matches),before,'sparse women must preserve original bracket');
 for(const round of new Set(out.matches.map(m=>m.round))){const games=out.matches.filter(m=>m.round===round),names=games.flatMap(m=>[m.team1A,m.team1B,m.team2C,m.team2D].map(p=>p.name));assert.equal(new Set(names).size,names.length);assert.equal(new Set(games.map(m=>m.court)).size,games.length);}
 for(const p of out.participants)assert.equal(p.gamesPlayed,out.matches.filter(m=>[m.team1A,m.team1B,m.team2C,m.team2D].some(x=>x.name===p.name)).length);
 console.log('PASS roster',n,f,gpp);
}
const c=build(),p=roster(8,4,4),s={teamMode:true,gamesPerPlayer:4,courts:2};p[0].partnerName=p[4].name;p[4].partnerName=p[0].name;
assert.equal(c.KokWomenDoubles.plan(p,s,c._teamPairBalance,c.effLevel).matches.length,0,'fixed mixed partner cannot be broken');
const a={matches:[{round:1}],participants:[]},b={matches:[{round:1}],participants:[]};const adapter={_qualityAssessment:ms=>({underSlots:ms===a.matches?0:1})};assert(!c.KokWomenDoubles.safe(adapter,a,b,s));
const women=roster(4,4,4),wm={round:1,type:'여복',team1A:women[0],team1B:women[2],team2C:women[1],team2D:women[3]};assert(!c.KokWomenDoubles.preserves([wm,{...wm,round:2}],[wm],women,s),'optimization cannot remove a secured quota');
const quotaMutant={};vm.createContext(quotaMutant);vm.runInContext(source.replace('n.women>=Math.min(p.target,p.women)','true'),quotaMutant);assert(quotaMutant.KokWomenDoubles.preserves([wm,{...wm,round:2}],[wm],women,s),'quota mutation must be detected');
const mutant={};vm.createContext(mutant);vm.runInContext(source.replaceAll("'underSlots',",''),mutant);assert(mutant.KokWomenDoubles.safe(adapter,a,b,s),'mutation must remove under-slot protection and be detected');
assert(fs.readFileSync('js/team.js','utf8').includes('_teamSelectFinalBracket(finalists,_basePlayers,settings,totalMatches)'));
assert(fs.readFileSync('team.html','utf8').includes('js/women-doubles.js'));
assert(fs.readFileSync('sw.js','utf8').includes('/badminton/js/women-doubles.js'));
console.log('PASS women priority, safety fallback, fixed partners, counters, format, court/round integrity and mutation');
