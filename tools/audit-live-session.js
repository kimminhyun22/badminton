'use strict';
/* 실전 세션 사후 감사 — 세션 JSON 하나로 운영 품질 리포트를 만든다.
   사용: node tools/audit-live-session.js <세션JSON파일>
   (관리자 ⬆️ 내보내기 파일, 또는 RTDB에서 받은 {session:{...}} / {...세션} 모두 허용)
   측정: 인당 게임 분포·공정성 잔차, 실제 게임 소요시간(21점제 검증),
        팀 밸런스·페어 비대칭, 파트너/상대 반복, 게임 간 대기. */
const fs = require('fs');
const path = require('path');
const {effectiveLevel} = require(path.join(__dirname, '..', 'functions', 'daily-server-matchmaker'));

const file = process.argv[2];
if (!file){ console.error('사용: node tools/audit-live-session.js <세션JSON>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const session = raw.session || raw;
const players = session.players || [];
const log = session.completedLog || [];
const r1 = x => Math.round(x * 10) / 10;

console.log(`세션 감사: 선수 ${players.length}명 · 완료 로그 ${log.length}경기`);
if (!log.length) console.log('⚠ completedLog 없음 — startAt·completedLog 도입(1.10.631) 이전에 시작한 세션이거나 경기 전');

/* ① 인당 게임 수 + 공정성 잔차 */
const games = players.filter(p => p.name).map(p => ({
  name: p.name + (p.gender === 'F' ? '♀' : ''), n: Number(p.games || 0),
  gap: r1(Math.max(0, Number(p.fairExpected || 0)) - Number(p.games || 0)),
  status: String(p.status || 'wait')
})).sort((a, b) => a.n - b.n);
const counts = games.map(g => g.n).filter(n => n > 0 || true);
const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
const dist = {};
counts.forEach(c => dist[c] = (dist[c] || 0) + 1);
console.log(`\n① 게임 수: 평균 ${r1(avg)} · 분포 ` + Object.keys(dist).sort((a, b) => a - b).map(k => `${k}게임×${dist[k]}명`).join(' · '));
const short = games.filter(g => g.gap >= 0.75);
console.log('   공정성 잔차(기대−실제 ≥0.75): ' + (short.length ? short.map(g => `${g.name} −${g.gap}`).join(', ') : '없음'));

/* ② 실제 게임 소요시간 — 21점제 검증의 원데이터 */
const durs = log.filter(m => m.startAt && m.endAt && m.endAt > m.startAt)
  .map(m => ({min: (m.endAt - m.startAt) / 60000, type: m.type || ''}))
  .filter(d => d.min > 3 && d.min < 90);
if (durs.length){
  const ms = durs.map(d => d.min).sort((a, b) => a - b);
  const q = f => r1(ms[Math.min(ms.length - 1, Math.floor(ms.length * f))]);
  console.log(`\n② 게임 소요: 중앙값 ${q(.5)}분 · 25% ${q(.25)} ~ 75% ${q(.75)}분 · 최장 ${r1(ms[ms.length - 1])}분 (${durs.length}경기)`);
  const byType = {};
  durs.forEach(d => (byType[d.type] = byType[d.type] || []).push(d.min));
  console.log('   종목별 중앙값: ' + Object.keys(byType).map(t => {
    const s = byType[t].sort((a, b) => a - b);
    return `${t || '?'} ${r1(s[Math.floor(s.length / 2)])}분(${s.length})`;
  }).join(' · '));
}else console.log('\n② 게임 소요: startAt 데이터 없음(completedLog 도입 이전 시작 세션)');

/* ③ 밸런스·비대칭 (이름→선수 매칭; 동명이인 있으면 첫 일치) */
const byName = new Map();
players.forEach(p => { if (p.name && !byName.has(p.name)) byName.set(p.name, p); });
const lv = n => { const p = byName.get(String(n).replace(/♀$/, '')); return p ? effectiveLevel(p) : null; };
let even = 0, mid = 0, hard = 0, asym = 0, scored = 0;
const hardList = [];
for (const m of log){
  const t1 = (m.t1 || []).map(lv), t2 = (m.t2 || []).map(lv);
  if (t1.length !== 2 || t2.length !== 2 || [...t1, ...t2].some(v => v == null)) continue;
  scored++;
  const diff = Math.abs(t1[0] + t1[1] - (t2[0] + t2[1]));
  const sym = Math.abs(Math.abs(t1[0] - t1[1]) - Math.abs(t2[0] - t2[1]));
  if (diff <= 0.5) even++; else if (diff > 1.5){ hard++; hardList.push(`#${m.seq} ${(m.t1 || []).join('·')} vs ${(m.t2 || []).join('·')} 차${r1(diff)}`); } else mid++;
  if (sym > 1.5) asym++;
}
console.log(`\n③ 밸런스(${scored}경기): 백중(≤0.5) ${even} · 중간 ${mid} · 큰 차(>1.5) ${hard} · 페어 비대칭(>1.5) ${asym}`);
hardList.forEach(s => console.log('   ⚠ ' + s));

/* ④ 파트너·상대 반복 */
const pairCount = {}, oppCount = {};
for (const m of log){
  const n1 = m.t1 || [], n2 = m.t2 || [];
  if (n1.length === 2) pairCount[[...n1].sort().join('+')] = (pairCount[[...n1].sort().join('+')] || 0) + 1;
  if (n2.length === 2) pairCount[[...n2].sort().join('+')] = (pairCount[[...n2].sort().join('+')] || 0) + 1;
  for (const a of n1) for (const b of n2){ const k = [a, b].sort().join('|'); oppCount[k] = (oppCount[k] || 0) + 1; }
}
const rePairs = Object.entries(pairCount).filter(([, c]) => c >= 2);
const reOpps = Object.entries(oppCount).filter(([, c]) => c >= 3);
console.log('\n④ 같은 짝 2회+: ' + (rePairs.length ? rePairs.map(([k, c]) => `${k}×${c}`).join(', ') : '없음'));
console.log('   같은 상대 3회+: ' + (reOpps.length ? reOpps.map(([k, c]) => `${k.replace('|', ' vs ')}×${c}`).join(', ') : '없음'));

/* ⑤ 게임 간 대기 (완료 시각 기반 근사 — 개인별 연속 경기 endAt 간격) */
const lastEnd = {}, gaps = [];
for (const m of [...log].sort((a, b) => (a.endAt || 0) - (b.endAt || 0))){
  for (const n of [...(m.t1 || []), ...(m.t2 || [])]){
    if (lastEnd[n] && m.startAt) gaps.push({name: n, min: (m.startAt - lastEnd[n]) / 60000});
    if (m.endAt) lastEnd[n] = m.endAt;
  }
}
const valid = gaps.filter(g => g.min > 0 && g.min < 150).sort((a, b) => a.min - b.min);
if (valid.length){
  const mid2 = valid[Math.floor(valid.length / 2)].min;
  const worst = valid[valid.length - 1];
  const long = valid.filter(g => g.min >= 45);
  console.log(`\n⑤ 게임 간 대기: 중앙값 ${r1(mid2)}분 · 최장 ${worst.name} ${r1(worst.min)}분`
    + (long.length ? ` · 45분+ ${long.length}건: ${long.map(g => `${g.name}(${Math.round(g.min)}분)`).join(', ')}` : ' · 45분+ 없음'));
}
