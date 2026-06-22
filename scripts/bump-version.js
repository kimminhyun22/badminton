#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const next = process.argv[2];

if(!/^\d+\.\d+\.\d+$/.test(next || '')){
  console.error('Usage: node scripts/bump-version.js 1.10.313');
  process.exit(1);
}

const files = [
  'index.html',
  'team.html',
  'view.html',
  'checkin.html',
  'rsvp.html',
  'js/daily.js',
  'js/team.js',
  'js/live-view.js',
  'sw.js',
  'README.md'
];

function update(rel, fn){
  const file = path.join(root, rel);
  if(!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if(after !== before){
    fs.writeFileSync(file, after, 'utf8');
    console.log('updated ' + rel);
  }
}

for(const rel of files.filter(f => f.endsWith('.html'))){
  update(rel, text => text
    .replace(/(<meta name="app-version" content=")[^"]+(")/g, '$1' + next + '$2')
    .replace(/(APP VERSION:\s*)\d+\.\d+\.\d+/g, '$1' + next)
    .replace(/([?&]v=)\d+\.\d+\.\d+/g, '$1' + next)
    .replace(/(id="appVersion"[^>]*>\s*v)[^<]+/g, '$1' + next)
    .replace(/(팀전LIVE 최신판 v)\d+\.\d+\.\d+/g, '$1' + next)
    .replace(/(const APP_VERSION\s*=\s*['"])\d+\.\d+\.\d+(['"])/g, '$1' + next + '$2')
  );
}

for(const rel of ['js/daily.js','js/team.js','js/live-view.js']){
  update(rel, text => text
    .replace(/(const APP_VERSION\s*=\s*['"])\d+\.\d+\.\d+(['"])/g, '$1' + next + '$2')
    .replace(/([?&]v=)\d+\.\d+\.\d+/g, '$1' + next)
  );
}

update('sw.js', text => text.replace(/badminton-v\d+\.\d+\.\d+/g, 'badminton-v' + next));
update('README.md', text => text.replace(/현재 버전: `[^`]+`/g, '현재 버전: `' + next + '`'));

console.log('version set to v' + next);
