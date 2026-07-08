const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'team.js'), 'utf8');

function extractFunction(name, nextName) {
  const start = src.indexOf(`function ${name}`);
  assert(start >= 0, `${name} 함수가 있어야 합니다.`);
  const end = nextName ? src.indexOf(`function ${nextName}`, start) : -1;
  assert(end > start, `${name} 함수의 끝을 찾을 수 있어야 합니다.`);
  return src.slice(start, end);
}

const code = `
const LEGACY_SHARED_SAVE_KEY='badminton_bracket_v7';
const SAVE_KEY='badminton_team_bracket_v7';
var currentMatches=[];
var _liveOn=false;
function migrateStateIfNeeded(state){ return state; }
function _teamIsDailyBracketState(state){
  if(!state)return false;
  if(state.mode==='daily'||state.appMode==='dailyLive')return true;
  if(state.mode==='team'||state.appMode==='teamLive')return false;
  return !!(state.settings&&state.settings.operationPreset==='daily');
}
function _teamStoredLiveId(){ return localStorage.getItem('badminton_team_liveId')||''; }
${extractFunction('_teamLiveSigName', '_teamLiveSignatureFromMatches')}
${extractFunction('_teamLiveSignatureFromMatches', '_teamLiveSignatureFromData')}
function _teamLiveSignature(){ return currentMatches.length?_teamLiveSignatureFromMatches(currentMatches):''; }
${extractFunction('_teamMigrateLegacySaveKey', '_restoreJoinerGoals')}
${extractFunction('_teamStoredLiveMatchesCurrentBracket', '_teamHasResumeLiveHint')}
${extractFunction('_teamHasResumeLiveHint', '_teamLiveResumeLabel')}
this.api={
  setMatches(v){ currentMatches=v; },
  _teamHasResumeLiveHint,
  _teamStoredLiveMatchesCurrentBracket,
  _teamMigrateLegacySaveKey
};
`;

function createStorage() {
  const store = {};
  return {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); }
  };
}

const localStorage = createStorage();
const sandbox = { console, assert, localStorage };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const api = sandbox.api;

function match(round, court, a, b, c, d) {
  return {
    round,
    court,
    type: '혼복',
    team1A: { name: a },
    team1B: { name: b },
    team2C: { name: c },
    team2D: { name: d }
  };
}

const teamKey = 'badminton_team_bracket_v7';
const legacyKey = 'badminton_bracket_v7';
const liveKey = 'badminton_team_liveId';
const current = [match(1, 1, '김민현', '이소영', '박철수', '최영희')];

api.setMatches(current);
localStorage.setItem(liveKey, 'liveA');
localStorage.setItem(teamKey, JSON.stringify({
  mode: 'team',
  appMode: 'teamLive',
  liveId: 'liveA',
  matches: current
}));
assert.strictEqual(api._teamHasResumeLiveHint(), true, '저장 LIVE와 현재 대진이 같으면 이어가기 힌트가 떠야 합니다.');

localStorage.setItem(teamKey, JSON.stringify({
  mode: 'team',
  appMode: 'teamLive',
  liveId: 'otherLive',
  matches: current
}));
assert.strictEqual(api._teamHasResumeLiveHint(), false, '저장본 liveId가 다르면 이어가기 힌트가 뜨면 안 됩니다.');

localStorage.setItem(teamKey, JSON.stringify({
  mode: 'team',
  appMode: 'teamLive',
  liveId: 'liveA',
  matches: [match(1, 1, '다른A', '다른B', '다른C', '다른D')]
}));
assert.strictEqual(api._teamHasResumeLiveHint(), false, '저장 대진 서명이 다르면 이어가기 힌트가 뜨면 안 됩니다.');

localStorage.clear();
localStorage.setItem(legacyKey, JSON.stringify({
  mode: 'team',
  appMode: 'teamLive',
  liveId: 'legacyLive',
  matches: current
}));
assert.strictEqual(api._teamMigrateLegacySaveKey(), true, '구 공유 키의 팀전 저장본은 팀전 전용 키로 마이그레이션되어야 합니다.');
assert(localStorage.getItem(teamKey), '팀전 전용 저장 키가 생성되어야 합니다.');

localStorage.clear();
localStorage.setItem(legacyKey, JSON.stringify({
  mode: 'daily',
  appMode: 'dailyLive',
  matches: current
}));
assert.strictEqual(api._teamMigrateLegacySaveKey(), false, '민턴LIVE 저장본은 팀전 전용 키로 마이그레이션하면 안 됩니다.');
assert.strictEqual(localStorage.getItem(teamKey), null, '민턴LIVE 저장본이 팀전 저장 키를 만들면 안 됩니다.');

console.log('team live resume safety regression ok');
