const FB_CONFIG = {
  apiKey: "AIzaSyAo2AfN_ekzelCe17x1s6CVqCet0Hsq4II",
  authDomain: "kokmatch-23b31.firebaseapp.com",
  databaseURL: "https://kokmatch-23b31-default-rtdb.firebaseio.com",
  projectId: "kokmatch-23b31",
  storageBucket: "kokmatch-23b31.firebasestorage.app",
  messagingSenderId: "57349245242",
  appId: "1:57349245242:web:6c0ac6f4cc131b44192803"
};
window.KokMatchFirebaseConfig = Object.freeze({...FB_CONFIG});

let _fbApp = null;
let _fbDb = null;

function _fbInit(){
  if(_fbApp) return true;
  try{
    if(typeof firebase === 'undefined') return false;
    _fbApp = firebase.initializeApp(FB_CONFIG);
    _fbDb = firebase.database();
    return true;
  }catch(e){
    console.warn('Firebase init 실패', e);
    return false;
  }
}

window.KokMatchStorage = {
  getJson(key, fallback = null){
    try{
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    }catch(e){ return fallback; }
  },
  setJson(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch(e){ return false; }
  },
  getText(key, fallback = ''){
    try{
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw;
    }catch(e){ return fallback; }
  },
  setText(key, value){
    try{ localStorage.setItem(key, String(value)); return true; }
    catch(e){ return false; }
  },
  remove(key){
    try{ localStorage.removeItem(key); return true; }
    catch(e){ return false; }
  },
  appVersion(){
    const meta = document.querySelector('meta[name="app-version"]');
    return meta ? meta.content : '';
  }
};

const LIVE_ROSTER_BRIDGE_VERSION = 1;
const LIVE_ROSTER_BRIDGE_KEYS = Object.freeze({
  daily:'kokmatch_live_roster_daily_v1',
  team:'kokmatch_live_roster_team_v1'
});
const LIVE_ROSTER_STATE_KEYS = Object.freeze({
  daily:'kokmatch_daily_v1',
  team:'badminton_team_bracket_v7'
});

function _liveRosterBridgeMode(mode){
  return mode === 'team' ? 'team' : mode === 'daily' ? 'daily' : '';
}

function _liveRosterBridgeProfile(raw){
  if(!raw || typeof raw !== 'object')return null;
  const name = String(raw.name || '').trim();
  if(!name)return null;
  const gender = raw.gender === 'F' || raw.gender === '여' ? '여' : '남';
  const grade = String(raw.grade || '').trim().toUpperCase();
  const level = Number(raw.level);
  return {
    memberId:String(raw.memberId || '').trim(),
    name,
    grade,
    level:Number.isFinite(level) ? level : 0,
    gender,
    ageGroup:String(raw.ageGroup || '40대'),
    club:String(raw.club || ''),
    isGuest:!!raw.isGuest,
    isClubOfficial:!!raw.isClubOfficial
  };
}

function _liveRosterBridgePlayers(rows){
  const seen = new Set();
  const players = [];
  (Array.isArray(rows) ? rows : []).forEach(raw=>{
    const player = _liveRosterBridgeProfile(raw);
    if(!player)return;
    const key = player.name.replace(/\s+/g,'').toLocaleLowerCase('ko-KR');
    if(seen.has(key))return;
    seen.add(key);
    players.push(player);
  });
  return players;
}

function _liveRosterBridgeRead(key){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    return null;
  }
}

function _liveRosterBridgeLegacy(mode){
  const state = _liveRosterBridgeRead(LIVE_ROSTER_STATE_KEYS[mode]);
  if(!state || typeof state !== 'object')return null;
  if(mode === 'daily' && state.mode && state.mode !== 'daily' && state.appMode !== 'dailyLive')return null;
  if(mode === 'team' && state.mode && state.mode !== 'team' && state.appMode !== 'teamLive')return null;
  const rows = mode === 'daily'
    ? state.players
    : (state.directPlayers && state.directPlayers.length ? state.directPlayers : state.participants);
  if(!Array.isArray(rows))return null;
  return {
    version:LIVE_ROSTER_BRIDGE_VERSION,
    mode,
    savedAt:Math.max(0,Number(state.savedAt || 0)),
    players:_liveRosterBridgePlayers(rows),
    source:'state'
  };
}

window.KokMatchRosterBridge = Object.freeze({
  version:LIVE_ROSTER_BRIDGE_VERSION,
  keys:LIVE_ROSTER_BRIDGE_KEYS,
  normalizePlayer:_liveRosterBridgeProfile,
  normalizePlayers:_liveRosterBridgePlayers,
  save(mode, rows){
    mode = _liveRosterBridgeMode(mode);
    if(!mode)return null;
    const snapshot = {
      version:LIVE_ROSTER_BRIDGE_VERSION,
      mode,
      savedAt:Date.now(),
      players:_liveRosterBridgePlayers(rows),
      source:'snapshot'
    };
    try{
      localStorage.setItem(LIVE_ROSTER_BRIDGE_KEYS[mode], JSON.stringify(snapshot));
      return snapshot;
    }catch(e){
      return null;
    }
  },
  clear(mode){
    return this.save(mode, []);
  },
  load(mode){
    mode = _liveRosterBridgeMode(mode);
    if(!mode)return {version:LIVE_ROSTER_BRIDGE_VERSION,mode:'',savedAt:0,players:[],source:'none'};
    const raw = _liveRosterBridgeRead(LIVE_ROSTER_BRIDGE_KEYS[mode]);
    const snapshot = raw && raw.mode === mode
      ? {
          version:LIVE_ROSTER_BRIDGE_VERSION,
          mode,
          savedAt:Math.max(0,Number(raw.savedAt || 0)),
          players:_liveRosterBridgePlayers(raw.players),
          source:'snapshot'
        }
      : null;
    const legacy = _liveRosterBridgeLegacy(mode);
    const latest = legacy && (!snapshot || legacy.savedAt > snapshot.savedAt) ? legacy : snapshot;
    return latest || {version:LIVE_ROSTER_BRIDGE_VERSION,mode,savedAt:0,players:[],source:'none'};
  }
});
