'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../js/team.js'), 'utf8');
const picker = app.slice(app.indexOf('const _importSelections='), app.indexOf('/* ── 회원 편집'));
const clubs = ['가', '나'].map(prefix => ({
  id:prefix, name:prefix+'클럽',
  members:['선수1','선수2','공통'].map((name,i) => ({
    name:i===2 ? name : prefix+name, grade:'C', level:4, gender:i%2?'남':'여', ageGroup:'40대', skillRating:4.2
  }))
}));

function fixture(source = picker) {
  const els = new Map();
  let choices = [];
  function element(id) {
    if(!els.has(id)) els.set(id, {
      value:'', textContent:'', classList:{toggle(){}}, open:false,
      showModal(){this.open=true;}, close(){this.open=false;},
      set innerHTML(html) {
        if(id==='importMemberList') choices=[...html.matchAll(/class="import-chk" value="([^"]+)" ([^>]*)>/g)]
          .map(([,value,state]) => ({value, checked:state.includes('checked'), disabled:state.includes('disabled'), matches:()=>true}));
      }
    });
    return els.get(id);
  }
  const ctx = vm.createContext({
    rosters:{clubs:[]}, _directPlayers:[], _importClubIdx:0, currentSettings:{}, RSVP_CLUB_KEY:'unused',
    loadRosters(){}, _teamRosterBridge:()=>null, localStorage:{getItem:()=>null}, esc:String,
    _rosterInitials:()=>'', switchNav(){}, renderDirectPlayerList(){}, rsvpSyncRosterChange(){},
    _rsvpMemberId:({name,club})=>club+name,
    document:{getElementById:element,querySelectorAll:()=>choices.filter(c=>!c.disabled)}
  });
  vm.runInContext(source,ctx);
  return {ctx, el:element, choices:()=>choices,
    check(name){const c=choices.find(c=>c.value===name);assert(c&&!c.disabled);c.checked=true;ctx.setTeamImportSelection(c);}};
}

function verify(source) {
  const {ctx,el,choices,check}=fixture(source);
  ctx.openImportModal();
  assert(el('importModal').open && el('teamDirectAddBox').open && el('teamImportFilters').hidden);
  ctx.closeImportModal();
  ctx.rosters.clubs=structuredClone(clubs);
  ctx.openImportModal();
  assert(!el('teamDirectAddBox').open && choices().every(c=>!c.checked),'nothing selected on first entry');
  check('가선수1');check('공통');
  ctx.selectImportClub(1);
  assert(choices().every(c=>!c.checked),'selection cannot cross into a different club by index');
  assert(choices().find(c=>c.value==='공통').disabled,'cannot select the same player twice');
  el('teamImportQuery').value='선수2';
  ctx.renderImportMembers();
  ctx.toggleSelectAll();
  assert.equal(el('teamImportSubmit').textContent,'3명 등록');
  ctx.selectImportClub(0);ctx.setImportSort('gender');
  assert.deepEqual(choices().filter(c=>c.checked).map(c=>c.value).sort(),['가선수1','공통'].sort());
  ctx.rosters.clubs[0].members.reverse();
  ctx.importSelected();
  assert.deepEqual(ctx._directPlayers.map(p=>[p.name,p.clubId,p.skillRating]),[['가선수1','가',4.2],['공통','가',4.2],['나선수2','나',4.2]]);
  ctx.openImportModal();
  assert(choices().every(c=>!c.checked) && choices().find(c=>c.value==='가선수1').disabled);
}
verify(picker);
assert.throws(()=>verify(picker.replace("source?'checked':''","'checked'")), 'preselect-all regression must fail');
assert.throws(()=>verify(picker.replace("document.getElementById('teamImportQuery').value='';\n  document.getElementById('teamDirectAddBox').open=!rosters.clubs[idx]", "_importSelections.clear();\n  document.getElementById('teamDirectAddBox').open=!rosters.clubs[idx]")), 'dropping picks on a club switch must fail');
console.log('team participant picker: no-roster entry, explicit selections, filtered bulk pick, club and sort changes, stable submit, duplicate guard and two mutations passed');
