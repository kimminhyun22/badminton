#!/usr/bin/env node
'use strict';
/* 전체 회귀 게이트 — tests/*.js 를 전부 같은 node 로 돌리고 functions/*.js 문법을 검사한다.
   사용:  node scripts/test-all.js            (전체)
          node scripts/test-all.js daily-     (파일 이름에 'daily-' 가 든 것만)
   실패한 파일만 끝 8줄과 함께 보여 주고, 하나라도 실패하면 종료 코드 1.
   node 가 PATH 에 없으면 ~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node 로 실행. */
const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'tests');
const filters = process.argv.slice(2);
const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.js'))
  .filter(f => !filters.length || filters.some(k => f.includes(k)))
  .sort();

const failed = [];
const started = Date.now();
for(const f of files){
  const r = spawnSync(process.execPath, [path.join(testDir, f)], {cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000});
  if(r.status !== 0){
    failed.push(f);
    const out = `${r.stdout || ''}${r.stderr || ''}${r.error ? String(r.error) : ''}`.trim().split('\n').slice(-8);
    console.log(`FAIL ${f}\n${out.map(l => '   ' + l).join('\n')}`);
  }
}
let checked = 0;
if(!filters.length){
  for(const f of fs.readdirSync(path.join(root, 'functions')).filter(n => n.endsWith('.js'))){
    checked++;
    const r = spawnSync(process.execPath, ['--check', path.join(root, 'functions', f)], {encoding: 'utf8'});
    if(r.status !== 0){ failed.push(`functions/${f}`); console.log(`FAIL functions/${f} (--check)\n   ${String(r.stderr).trim()}`); }
  }
}
const secs = Math.round((Date.now() - started) / 1000);
console.log(`tests: ${files.length - failed.filter(f => !f.startsWith('functions/')).length}/${files.length} 통과`
  + (checked ? ` · functions 문법 ${checked}개` : '') + ` · 실패 ${failed.length} · ${secs}s`);
process.exit(failed.length ? 1 : 0);
