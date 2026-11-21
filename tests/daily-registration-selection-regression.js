'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/daily.js'), 'utf8');
const selection = source.slice(source.indexOf('function dailyUpdateImportSelection()'), source.indexOf('// 이미 명단에 있는 도착 전 선수는 official-player-arrival'));
const submit = source.slice(source.indexOf('async function importDailySelected()'), source.indexOf('/* ═══ TEAM NAME CHANGE'));

async function exercise(code, submission, reopen=false) {
  const members = ['가나다', '나현장', '다현장'].map(name => ({name}));
  const rows = members.map((m, i) => {
    const input = {checked:false, value:String(i)};
    return {dataset:{name:m.name, planned:i ? 'true' : 'false'}, input, querySelector:() => input};
  });
  const controls = {};
  for (const id of ['dailyImportSearch','dailyImportHiddenSelection','dailyImportFooter','dailyImportSubmit','dailyImportSearchEmpty','dailyImportSelectAll','dailyImportTools','dailyImportModal','dailyImportResultNotice'])
    controls[id] = {value:'', dataset:{}};
  const button = controls.dailyImportSubmit;
  const document = {
    getElementById: id => controls[id],
    querySelectorAll(selector) {
      if (selector.includes('.import-member-row:not([hidden])')) return rows.filter(row => !row.hidden).map(row => row.input);
      if (selector.includes('.daily-import-chk')) return rows.map(row => row.input);
      return rows;
    }
  };
  controls.dailyImportModal.classList={contains: () => false};
  const sent = [];
  let closed=0;
  let finish;
  const reply = new Promise(resolve => {finish = resolve;});
  const c = {document, _dailyImportVisit:1, renderDailyImportMembers(){}, _dailyImportFilter:'all', _rosterInitials:() => '', _dailyCheckinId:'fixture',
    _dailyBlockServerSync:() => false, _dailyCanChangeRoster:() => true, rosters:{clubs:[{name:'가명', members}]},
    _dailyImportClubIdx:0, _dailySessionClubName:'가명', closeDailyImportModal(){closed++;}, dailyRender(){}, alert(){},
    _dailyRegisterArrivalsViaServer(people) {sent.push(Array.from(people, p => p.name)); return reply;}};
  vm.createContext(c); vm.runInContext(code + '\n' + submission, c);
  c.dailyUpdateImportSelection();
  assert(button.disabled);
  controls.dailyImportSearch.value = '나다'; c.dailyUpdateImportSelection(); c.toggleDailySelectAll();
  controls.dailyImportSearch.value = '현장'; c.dailyUpdateImportSelection();
  assert.equal(button.textContent, '선택한 1명 등록');
  assert.match(controls.dailyImportHiddenSelection.textContent, /1명 포함/);
  c.toggleDailySelectAll(); assert.equal(button.textContent, '선택한 3명 등록');
  c.toggleDailySelectAll(); assert.deepEqual(rows.map(row => row.input.checked), [true, false, false]);
  controls.dailyImportSearch.value = '해당 없음'; c.dailyUpdateImportSelection();
  assert(controls.dailyImportSelectAll.disabled);
  assert(!controls.dailyImportSearchEmpty.hidden);
  assert(!button.disabled, 'A valid selection remains available after a second search');
  const first = c.importDailySelected(), second = c.importDailySelected();
  assert.equal(sent.length, 1, 'Duplicate tap must not start another registration');
  assert.deepEqual(sent[0], ['가나다']);
  assert(button.disabled); c.dailyUpdateImportSelection(); assert(button.disabled);
  if(reopen){
    c._dailyImportVisit++;
    rows[0].input.checked=false;
    rows[1].input.checked=true;
    c.dailyUpdateImportSelection();
    await c.importDailySelected();
    assert.equal(sent.length, 1, 'A pending request still guards a new sheet');
  }
  finish({sent:1, failed:0, reasons:[]}); await Promise.all([first,second]);
  assert.equal(closed, reopen?0:1, 'An older response must not close a reopened sheet');
  if(reopen){
    assert.deepEqual(rows.map(r=>r.input.checked),[false,true,false]);
    assert.match(controls.dailyImportResultNotice.textContent,/1명/);
  }
  assert(!button.disabled);
  rows.length = 0; c.dailyUpdateImportSelection();
  assert(controls.dailyImportTools.hidden && controls.dailyImportFooter.hidden);
}
(async () => {
  await exercise(selection, submit);
  await exercise(selection, submit, true);
  await assert.rejects(exercise(selection, submit.replace("if(submit.dataset.submitting==='true')return;", '')), /Duplicate tap/);
  console.log('daily registration: scoped select-all, search drafts, count, empty state and repeated-submit guard passed');
})().catch(e => {console.error(e); process.exitCode = 1;});
