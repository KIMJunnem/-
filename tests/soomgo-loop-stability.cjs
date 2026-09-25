const fs=require('fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
 for(const [file,role] of [['soomgo-chat-bot/chat-content.js','chat'],['soomgo-bot-extension/content.js','request']]) {
 const page=await browser.newPage();
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<html><body><p>fixture</p></body></html>'}));
 await page.goto('https://fixture.test/pro/chats');
 await page.evaluate(()=>{
  localStorage.setItem('relaySoomgoGlobalPause','1');
  window.saved={relaySoomgoBotSettings:{enabled:false,autoSend:false,autoReply:false}};
  window.chrome={storage:{local:{get:async()=>saved,set:async x=>Object.assign(saved,x),remove:async()=>{}}}};
  window.fetch=async()=>({ok:true,json:async()=>({workflows:[]})});
  window.observerCalls=0; const Observer=window.MutationObserver;
  window.MutationObserver=class extends Observer { constructor(cb){super(records=>{observerCalls++;cb(records)})} };
  window.__relaySoomgoChatTestHook=x=>window.audit=x;
 });
 await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
 await page.waitForTimeout(1100);
 assert.equal(await page.evaluate(()=>saved.relaySoomgoBotSettings.enabled),false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('relaySoomgoGlobalPause')),'1');
 if(role==='chat') await page.evaluate(()=>{audit.state.settings.enabled=true; audit.loop();});
 else await page.locator('[data-rsb=toggle]').click();
 await page.waitForTimeout(1200);
 assert.ok(await page.evaluate(()=>observerCalls)<30,'status observer must not spin');
 assert.equal(await page.evaluate(()=>localStorage.getItem('relaySoomgoGlobalPause')),'1');
 console.log('PASS '+role+' manual stop persists; paused observer stays responsive');
 await page.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
