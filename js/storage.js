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
