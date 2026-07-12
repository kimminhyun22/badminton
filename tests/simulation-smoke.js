#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'css/app.css',
  'css/team.css',
  'css/live.css',
  'js/storage.js',
  'js/daily.js',
  'js/team.js',
  'js/live-view.js',
  'manifest.json',
  'scripts/bump-version.js',
  'tests/simulation.html'
];

for(const rel of required){
  if(!fs.existsSync(path.join(root, rel))){
    throw new Error('missing file: ' + rel);
  }
}

const pages = {
  'index.html': ['css/app.css', 'js/storage.js', 'js/daily.js'],
  'team.html': ['css/team.css', 'js/storage.js', 'js/team.js'],
  'view.html': ['css/live.css', 'js/storage.js', 'js/live-view.js']
};

for(const [page, refs] of Object.entries(pages)){
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  for(const ref of refs){
    if(!html.includes(ref)) throw new Error(page + ' does not reference ' + ref);
  }
  const inlineStyles = (html.match(/<style>/g) || []).length;
  if(inlineStyles) throw new Error(page + ' still has inline style blocks');
}

const version = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<meta name="app-version" content="([^"]+)"/)?.[1];
if(!version) throw new Error('index version not found');
const versionedFiles = ['index.html','team.html','view.html','checkin.html','rsvp.html','manifest.json','js/daily.js','js/team.js','js/live-view.js','sw.js','README.md'];
const versionPatterns = [
  /APP VERSION:\s*(\d+\.\d+\.\d+)/g,
  /app-version\" content=\"(\d+\.\d+\.\d+)/g,
  /APP_VERSION\s*=\s*['\"](\d+\.\d+\.\d+)/g,
  /id=\"appVersion\"[^>]*>\s*v(\d+\.\d+\.\d+)/g,
  /badminton-v(\d+\.\d+\.\d+)/g,
  /[?&]v=(\d+\.\d+\.\d+)/g,
  /현재 버전: `([^`]+)`/g
];
for(const rel of versionedFiles){
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for(const pattern of versionPatterns){
    for(const match of text.matchAll(pattern)){
      if(match[1] !== version){
        throw new Error(rel + ' has mismatched version ' + match[1] + ', expected ' + version);
      }
    }
  }
}

console.log('simulation smoke ok: v' + version);
