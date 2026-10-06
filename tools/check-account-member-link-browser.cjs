// Real member HTML/JS, locally generated account game, frozen rule pattern; no external traffic.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..'),out=process.env.MINTON_TEST_OUTPUT||'/tmp/minton-member-link-local';
const {handle}=require(root+'/functions/admin-workspace-game'),workspace=require(root+'/functions/admin-workspace');
const rows=new Map(),copy=x=>structuredClone(x??null),snap=x=>({val:()=>copy(x)});
const db={ref:k=>({once:async()=>snap(rows.get(k)),transaction:async fn=>{const next=fn(copy(rows.get(k)));if(next===undefined)return {committed:false,snapshot:snap(rows.get(k))};rows.set(k,copy(next));return {committed:true,snapshot:snap(next)};}})};
const auth={uid:'local-member-test',token:{email_verified:true,firebase:{sign_in_provider:'google.com'}}};
const now=Date.now(),device='local_member_browser_01',result={checks:[],errors:[],reads:[],externalRequestsPassed:0};
const rules=JSON.parse(fs.readFileSync(root+'/database.rules.json','utf8'));
const pattern=vm.runInNewContext(rules.rules.live.$sessionId['.read'].match(/matches\((\/.*\/)\)/)[1]);
(async()=>{fs.mkdirSync(out,{recursive:true});let browser;
 try{
  await workspace.handle(db,auth,{action:'import',device,operationId:'local_import_00000001',createdAt:now,values:{}},now);
  const names=Array.from({length:8},(_,i)=>'E2E선수'+i);
  const state={kind:'teamLive',matchMode:'free',isTeam:false,title:'E2E회원링크',courts:2,currentRound:1,pointSystem:25,members:{all:names.map((n,i)=>({id:'e2e'+i,memberId:'e2e'+i,n,l:3,g:'M'}))},matches:[{num:1,round:1,court:1,type:'남복',t1:names.slice(0,2),t2:names.slice(2,4)},{num:2,round:1,court:2,type:'남복',t1:names.slice(4,6),t2:names.slice(6,8)}]};
  const game=await handle(db,auth,{action:'create',mode:'team',device,operationId:'local_create_00000001',revision:1,state},'local-only-secret',now);
  assert(pattern.test(game.id));result.checks.push('Generated account team ID satisfies frozen public read rule');
  const sdk=`window.firebase={initializeApp:()=>({}),database:()=>({ref:k=>({on:(event,callback,error)=>{window.memberFixtureRead(k).then(r=>{if(r.denied){error?.(Error('PERMISSION_DENIED'));return;}callback({val:()=>r.value});}).catch(e=>error?.(e));},off:()=>{}})}),functions:()=>({httpsCallable:()=>async()=>{throw Error('Unexpected callable in anonymous read test');}})};`;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  for(const width of [375,820]){
   const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
   await context.exposeBinding('memberFixtureRead',(_source,k)=>{result.reads.push(k);const id=k.startsWith('live/')?k.slice(5):'';return pattern.test(id)?{value:copy(rows.get(k))}:{denied:true};});
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://www.gstatic.com')return r.fulfill({contentType:'text/javascript',body:u.pathname.endsWith('/firebase-app-compat.js')?sdk:''});if(u.origin!=='https://kimminhyun22.github.io'||r.request().method()!=='GET')return r.abort();const file=path.resolve(root,u.pathname.replace(/^\/badminton\//,''));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return r.abort();return r.fulfill({path:file,contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});});
   const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
   await page.goto('https://kimminhyun22.github.io/badminton/view.html?id='+game.id);
   await page.locator('#liveViewerSearch').fill('E2E');
   await page.waitForSelector('.viewer-name-card',{timeout:10000});assert.equal(await page.locator('.viewer-name-card').count(),8);
   await page.locator('.viewer-name-card').filter({hasText:'E2E선수0'}).click();
   await page.waitForFunction(()=>_viewerName==='E2E선수0'&&!!window._lastLiveData?.matches?.length);
   assert.equal(await page.locator('#accountBar').count(),0);assert.equal(await page.evaluate(()=>typeof MintonAdminWorkspace),'undefined');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:out+'/member-'+width+'.png',fullPage:true});
   await page.reload();await page.waitForFunction(()=>_viewerName==='E2E선수0'&&window._lastLiveData?.matches?.length===2);
   result.checks.push(width+'px anonymous member: 8 names, name selection, matches, reload persistence, no Google UI, no horizontal overflow');
   await context.close();
  }
  assert(result.reads.length>=4);assert(result.reads.every(k=>k==='live/'+game.id));assert.equal(result.errors.length,0);result.success=true;
 }catch(e){result.success=false;result.error=e.stack;if(browser)result.debug=await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>({text:document.body.innerText,html:document.getElementById('content')?.innerHTML})).catch(()=>({}))));process.exitCode=1;}
 finally{if(browser)await browser.close();fs.writeFileSync(out+'/member-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})();
