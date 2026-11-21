'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function checkRecovery(source) {
  const nodes = new Map();
  const states = new Set();
  const timers = new Map();
  let nextTimer = 0, reloads = 0;
  const button = {addEventListener(_, fn) { this.click = fn; }};
  const fields = {h1: {}, p: {}, button};
  const document = {
    body: {classList: {add: value => states.add(value), remove: value => states.delete(value)}},
    getElementById: key => nodes.get(key),
    createElement: () => ({
      setAttribute() {},
      querySelector: selector => fields[selector],
      remove() { nodes.delete(this.id); }
    }),
    querySelector: () => ({after: node => nodes.set(node.id, node)})
  };
  const env = {window: {}, location: {reload: () => reloads++}, document,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(key) { timers.delete(key); }};
  vm.runInNewContext(source, env);
  const link = env.window.KokMemberLink;
  assert(link.validId('OLD-id_1'));
  for (const id of ['', ' ', 'a/b', 'a#b', 'a.b']) assert(!link.validId(id));
  link.waitForData('팀전');
  [...timers.values()][0]();
  assert(!button.hidden && states.has('member-link-unavailable'));
  button.click();
  assert.equal(reloads, 1);
  assert.equal(link.readFailure({code:'PERMISSION_DENIED'}), 'access');
  assert.equal(link.readFailure({code:'database/permission-denied'}), 'access');
  assert.equal(link.readFailure({code:'NETWORK_ERROR'}), 'connection');
  for (const reason of ['invalid', 'missing', 'expired', 'access']) {
    link.show(reason, '운동');
    assert(button.hidden && fields.p.textContent.includes('링크'));
    assert.equal(nodes.size, 1);
  }
  link.waitForData('팀전');
  link.ready();
  assert.equal(nodes.size, 0);
  assert.equal(states.size, 0);
  assert.equal(timers.size, 0, 'a successful read must cancel the pending load warning');
}

const state = read('js/member-link-state.js');
checkRecovery(state);
assert.throws(() => checkRecovery(state.replace('function ready() {\n    clearTimeout(timer);', 'function ready() {')));
for (const page of ['checkin.html','rsvp.html','view.html']) assert(read(page).includes('src="js/member-link-state.js?v='));
const rsvp = read('rsvp.html');
const render = rsvp.slice(rsvp.indexOf('function render(){'), rsvp.indexOf('function renderIdentityPanel'));
function checkWaiting(src) {
  let heroHidden;
  const row = {id:'test',name:'시험회원'};
  const env = {
    session:{phase:'setup',members:[row]}, identityLookupOpen:false, query:'',
    renderHeader(){}, selectedMemberFromLast:()=>row, renderIdentityPanel(){},
    filteredMembers:()=>[row],memberSelectCard:()=>'',
    document:{getElementById:id=>id==='eventHero'?{classList:{toggle:(_, hidden)=>heroHidden=hidden}}:
      {classList:{toggle(){}},querySelector:()=>null}}
  };
  vm.runInNewContext(src+'\nrender();',env);
  assert.equal(heroHidden,false,'after picking a name the waiting instruction must actually be visible');
}
checkWaiting(render);
assert.throws(()=>checkWaiting(render.replace('const showEvent=!!selected&&!identityLookupOpen;', "const showEvent=!!(selected&&session.phase==='live'&&session.liveUrl);")));
console.log('member link recovery, slow first read cleanup, actionable state and selected RSVP waiting passed');

function checkIdentityChoice(source) {
  const block = source.slice(source.indexOf('function toggleRsvpIdentityLookup(){'),source.indexOf('function liveIdFromUrl'));
  const first = {id:'m1',name:'시험가'}, next = {id:'m2',name:'시험나'};
  let chosen, confirms = 0, accept = false, entered = 0;
  const env = {session:{phase:'setup',members:[first,next]},identityLookupOpen:false,query:'',
    getLast:()=>chosen, selectedMemberFromLast:()=>chosen, clearLast:()=>{ chosen=null; },
    document:{getElementById:()=>({focus(){}})},render(){},toast(){},
    confirm:()=>{ confirms++; return accept; },memberResponse:()=>({}),normalizeLateStatus:()=>'',guestListFor:()=>[],
    responseFor:m=>m,setLast:v=>{chosen=v;},liveUrlWithViewer:v=>v,location:{assign:()=>entered++}};
  vm.runInNewContext(block,env);
  env.selectRsvpIdentity('m1');
  assert.equal(chosen,first);assert.equal(confirms,0);
  env.toggleRsvpIdentityLookup();
  env.session.phase='live';env.session.liveUrl='view.html?id=TEST';
  assert.equal(env.enterActiveLive(),false,'while choosing a new name, publication must wait');
  env.selectRsvpIdentity('m2');
  assert.equal(confirms,1);assert.equal(chosen,first);assert.equal(entered,0);
  env.toggleRsvpIdentityLookup();
  assert.equal(chosen,first);assert.equal(entered,1,'cancel returns to the saved member');
  env.toggleRsvpIdentityLookup();accept=true;env.selectRsvpIdentity('m2');
  assert.equal(confirms,2);assert.equal(chosen,next);assert.equal(entered,2);
}
checkIdentityChoice(rsvp);
assert.throws(()=>checkIdentityChoice(rsvp.replace('identityLookupOpen=!identityLookupOpen;', 'clearLast();identityLookupOpen=!identityLookupOpen;')));
