'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dailyHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const teamHtml = fs.readFileSync(path.join(root, 'team.html'), 'utf8');
const dailyJs = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const teamJs = fs.readFileSync(path.join(root, 'js', 'team.js'), 'utf8');

function functionSource(src, name, nextName){
  const start = src.indexOf(`function ${name}(`);
  const end = src.indexOf(`function ${nextName}(`, start + 1);
  assert(start >= 0 && end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

for(const [label, html] of [['민턴LIVE', dailyHtml], ['팀전LIVE', teamHtml]]){
  assert(!html.includes('id="dsb-reg"'), `${label} 등록 선수 목록에 등록순 버튼이 남으면 안 됩니다.`);
  assert(!html.includes('id="isb-reg"'), `${label} 명부 참가자 선택창에 등록순 버튼이 남으면 안 됩니다.`);
  assert(/class="dir-sort-btn active" id="dsb-name"/.test(html), `${label} 등록 선수 목록의 기본 정렬은 이름순이어야 합니다.`);
  assert(/class="dir-sort-btn active" id="isb-name"/.test(html), `${label} 명부 참가자 선택창의 기본 정렬은 이름순이어야 합니다.`);
}
assert(!dailyHtml.includes('id="disb-reg"'), '민턴LIVE 오늘 참가자 등록창에 등록순 버튼이 남으면 안 됩니다.');
assert(/class="dir-sort-btn active" id="disb-name"/.test(dailyHtml), '민턴LIVE 오늘 참가자 등록창의 기본 정렬은 이름순이어야 합니다.');

for(const [label, src] of [['민턴LIVE 공용', dailyJs], ['팀전LIVE', teamJs]]){
  assert(src.includes("let _dirSort = 'name'; // 'name' | 'level'"), `${label} 등록 선수 목록은 이름순으로 초기화해야 합니다.`);
  assert(src.includes("let _importSort='name'; // 'name' | 'gender'"), `${label} 명부 선택창은 이름순으로 초기화해야 합니다.`);
  assert(!src.includes("_importSort='reg'"), `${label} 명부 선택창이 등록순으로 되돌아가면 안 됩니다.`);
  const openImport = functionSource(src, 'openImportModal', 'openImportFromClub');
  const openClub = functionSource(src, 'openImportFromClub', 'closeImportModal');
  const selectClub = functionSource(src, 'selectImportClub', 'setImportSort');
  assert(openImport.includes("_importSort='name'"), `${label} 참가자 등록창을 다시 열어도 이름순이어야 합니다.`);
  assert(openClub.includes("_importSort='name'"), `${label} 특정 클럽에서 참가자 등록창을 열어도 이름순이어야 합니다.`);
  assert(selectClub.includes("_importSort='name'"), `${label} 클럽을 바꿔도 이름순이어야 합니다.`);
  const render = functionSource(src, 'renderImportMembers', 'toggleSelectAll');
  assert(render.includes("a.name.localeCompare(b.name,'ko')"), `${label} 참가자 명단은 한국어 이름순으로 정렬해야 합니다.`);
}

assert(dailyJs.includes("let _dailyImportSort='name';"), '민턴LIVE 오늘 참가자 등록은 이름순으로 초기화해야 합니다.');
assert(!dailyJs.includes("_dailyImportSort='reg'"), '민턴LIVE 오늘 참가자 등록이 등록순으로 되돌아가면 안 됩니다.');
const dailyRosterOpen = functionSource(dailyJs, 'dailyImportRoster', '_dailyApplyPlayerStatus');
const dailyClub = functionSource(dailyJs, 'selectDailyImportClub', 'setDailyImportSort');
assert(dailyRosterOpen.includes("_dailyImportSort='name'"), '민턴LIVE 오늘 참가자 등록창을 열 때 이름순이어야 합니다.');
assert(dailyClub.includes("_dailyImportSort='name'"), '민턴LIVE 등록 클럽을 바꿔도 이름순이어야 합니다.');

console.log('participant registration sort regression ok');
