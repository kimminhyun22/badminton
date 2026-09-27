'use strict';
const fs=require('fs'),assert=require('assert');
function pageContract(html){
  assert(html.includes('css/minton-ui.css?v='),'shared visual layer');
  assert(html.includes('class="km-brand-icon"'),'shared brand asset');
  assert(html.includes('favicon-32.png?v='),'versioned tab icon');
  assert(html.includes('apple-touch-icon.png?v='),'versioned iOS icon');
}
for(const file of ['index.html','team.html','checkin.html','rsvp.html','view.html'])pageContract(fs.readFileSync(file,'utf8'));
for(const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['favicon-32.png',32]]){
  const png=fs.readFileSync(file);assert.equal(png.toString('ascii',1,4),'PNG');
  assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
}
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
assert.equal(manifest.short_name,'민턴LIVE');assert(manifest.start_url.startsWith('/badminton/'),'existing shared URLs stay valid');
const css=fs.readFileSync('css/minton-ui.css','utf8');
assert(css.includes('prefers-reduced-motion:reduce'));
assert(css.includes(':focus-visible'));assert(css.includes('font-size:16px'));
assert(css.includes('.event-row.event-active .event-active-meta{flex:1 1 100%;'),'tablet card actions below names');
assert(css.includes('score-team.blue .score-num{color:var(--ui-blue)'));
assert(css.includes('score-team.red .score-num{color:var(--ui-red)'));
assert(!/\bfont-size:[^;}]*vw/.test(css),'no viewport-scaled text');
assert(fs.readFileSync('sw.js','utf8').includes("'/badminton/css/minton-ui.css'"));
assert.throws(()=>pageContract(fs.readFileSync('team.html','utf8').replace('css/minton-ui.css','css/missing.css')),'missing shared layer mutation');
console.log('shared UI: five surfaces, four PNG sizes, PWA URL preservation, focus/motion, team semantics and mutation passed');
