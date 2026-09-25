const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RELAY_PLAYWRIGHT || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../soomgo-chat-bot/chat-content.js'), 'utf8');
const exposed = source.slice(0, source.lastIndexOf('  loadSettings().then(')) + `
  state.seen = new Set();
window.audit = { state, chatInspections, latestIncomingMessage, isChatPage, processChatList, processChat, loop, currentConversationQuote, processPendingHire, linkHasUnread, globalUnreadChatCount, queueConfirmedListHire, shouldOpenUnreadRoom, platformConfirmation, isSystemChatMessage, sendHireWelcome, hireWelcomeWasSent, returnToChatList };
})();`;
const message = (id, text, mine = false) => `<li id="message-${id}" ${mine ? 'data-mymessage="true"' : ''}><div class="message-bubble"><div class="row message-box ${mine ? 'my-message' : ''}"><div data-name="message-body"><div data-name="content-body"><div data-name="content">${text}</div><p data-name="message-status">오전 11:32</p></div></div></div></div></li>`;
const kim = message('2227504781', '네 가지 조건을 확인하셨다면 진행하겠습니다라고 답해주세요.', true)
  + message('2227505256', '바로 작업 가능하신가요?')
  + message('2227505981', '고용 요청과 일정 등록을 보내드리겠습니다.', true)
  + message('2227510636', '추가비용이 얼마나오는데요?')
  + message('2227558097', '??');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.RELAY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  let passed = 0;
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType:'text/html', body:'<html><body></body></html>'}));
  async function setup(html, url = 'https://fixture.test/pro/chats/235090767') {
    await page.goto(url);
    await page.setContent(html);
    await page.evaluate((SERVER_MESSAGES) => {
      window.saved = {}; window.calls = []; window.mockSummary = {leads:[],workflows:[]};
      window.chrome = { storage: {local: {set: async x => Object.assign(saved, x), remove: async k => delete saved[k], get: async () => saved}}};
      window.fetch = async (url, options = {}) => {
        if(String(url).includes('/api/soomgo/control')) return {ok:true,json:async()=>({paused:false})};
        calls.push({url, body: options.body && JSON.parse(options.body)});
        // 2-4-3: 고정 문구는 서버(messages.json)에서만 받는다. 시험에서는 서버 응답을 흉내 낸다.
        if (String(url).includes('/api/soomgo/message-text')) { const b = JSON.parse(options.body); const m = SERVER_MESSAGES[b.id]; return m ? {ok:true,json:async()=>({messageId:b.id,version:'v1',text:m.replace(/\{\{(\w+)\}\}/g,(_,k)=>String((b.values||{})[k]??''))})} : {ok:false,json:async()=>({error:'message_not_found'})}; }
        return {ok:true,json:async () => url.includes('/reply') ? {reply:{autoSend:true,text:'기본 범위 안에서는 추가금이 없습니다.'}} : url.includes('/summary') ? mockSummary : {workflows:[]}};
      };
    }, Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, '../services/_common/messages.json'), 'utf8')).messages.map(m => [m.id, m.text])));
    await page.addScriptTag({content:exposed});
  }
  async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
  try {
    await setup(`<ul>${kim}</ul><textarea></textarea><aside>요청 상세 이용 목적 보고서</aside>`);
    await check('Kim fee question survives trailing ??, gets canonical ID without duplicate nested bubble', async () => {
      const actual = await page.evaluate(() => { const x = audit.latestIncomingMessage(document.body.innerText,{preferUnhandled:true}); return {id:x.messageId,text:x.text,history:x.conversationText}; });
      assert.equal(actual.id,'message-2227510636');
      assert.equal(actual.text,'추가비용이 얼마나오는데요?');
      assert.equal(actual.history.match(/\[고객\] 추가비용/g).length,1);
      assert.ok(actual.history.includes('\n[내 답변]'));
    });
    await check('Chat room recognized with request sidebar and no send button', async () => assert.equal(await page.evaluate(() => audit.isChatPage(document.body.innerText)),true));
    await check('Question reaches reply engine and fills a draft without sending', async () => {
      await page.evaluate(async () => {audit.state.settings.autoReply=false; await audit.processChat();});
      const actual = await page.evaluate(() => ({body:calls.find(c=>c.url.includes('/reply')).body,value:document.querySelector('textarea').value}));
      assert.equal(actual.body.message,'추가비용이 얼마나오는데요?');
      assert.ok(actual.value.includes('추가금'));
    });
    await check('Handled fee does not reappear under nested hash ID', async () => {
      const actual = await page.evaluate(() => {audit.state.seen.add('reply:235090767:message-2227510636'); return audit.latestIncomingMessage('',{preferUnhandled:true})?.text;});
      assert.equal(actual,'??');
    });
    await check('Same wording in a new customer message is a new event', async () => {
      await page.locator('ul').evaluate((n,html) => n.insertAdjacentHTML('beforeend',html),message('new-fee','추가비용이 얼마나오는데요?'));
      assert.equal(await page.evaluate(() => audit.latestIncomingMessage('',{preferUnhandled:true}).messageId),'message-new-fee');
    });
    await check('Question preceding an already sent answer is not replayed', async () => {
      await page.locator('ul').evaluate((n,html) => n.insertAdjacentHTML('beforeend',html),message('reply-done','추가금 설명드렸습니다.',true));
      assert.equal(await page.evaluate(() => audit.latestIncomingMessage('',{preferUnhandled:true})),null);
    });
    await setup(`<ul>${message('read','고객님이 견적을 읽었습니다')}</ul><textarea></textarea>`);
    await check('Read receipt is not a customer question', async () => assert.equal(await page.evaluate(() => audit.latestIncomingMessage('',{preferUnhandled:true})),null));
    await setup(`<ul>${message('customer','안녕하세요, 지금 바로 음성 파일을 보내드리면 얼마나 걸릴까요? 오늘 항소장 제출을 원해서요')}${message('hire-nudge','거래가 성사됐다면, 고용을 요청해 주세요\n고용 횟수와 고객 리뷰를 모두 챙길 수 있어요.')}${message('calendar-nudge','날짜를 클릭하면 요청서 정보를 캘린더에 자동으로 입력해 드려요.\n*앱에서만 지원되는 기능입니다.')}</ul><textarea></textarea>`);
    await check('Soomgo hire and calendar cards do not hide the preceding customer question', async () => {
      const actual = await page.evaluate(() => audit.latestIncomingMessage('', {preferUnhandled:true}));
      assert.equal(actual.messageId, 'message-customer');
      assert.match(actual.text, /음성 파일.*얼마나 걸릴까요/);
    });
    await setup('<ul><li id="message-hire-alert" data-direction="incoming"><div class="message-box"><div data-name="content">숨고 알리미 고용을 확정했어요. 9월 18일 오후 7:40분까지 고용을 취소할 수 있어요.</div></div></li></ul><textarea placeholder="메시지를 입력하세요."></textarea><button aria-label="메시지 전송">전송</button>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { window.sentMessages=(window.sentMessages||[]).concat(document.querySelector('textarea').value);document.querySelector('textarea').value='';}));
    await check('Official "고용을 확정했어요" alert is detected even in an incoming card and excluded from customer messages', async () => {
      const actual = await page.evaluate(() => ({
        latest: audit.latestIncomingMessage('', {preferUnhandled:true}),
        confirmation: audit.platformConfirmation('hire'),
        system: audit.isSystemChatMessage('숨고 알리미 고용을 확정했어요. 9월 18일 오후 7:40분까지 고용을 취소할 수 있어요.'),
        customerQuestion: audit.isSystemChatMessage('고용을 확정했어요?')
      }));
      assert.equal(actual.latest,null);
      assert.equal(actual.system,true);
      assert.equal(actual.customerQuestion,false);
      assert.match(actual.confirmation.text,/고용을 확정했어요/);
    });
    await check('Hire welcome explains the first result, feedback, final file and sends once', async () => {
      const result = await page.evaluate(async () => {
        const workflow={id:'WF-HIRE-WELCOME',conversationId:'235090767',quote:{days:'당일~1일'}};
        const first=await audit.sendHireWelcome(workflow,document.body.innerText);
        const duplicate=await audit.sendHireWelcome(workflow,document.body.innerText);
        return {first,duplicate,already:audit.hireWelcomeWasSent('235090767'),sent:window.sentMessages||[]};
      });
      assert.equal(result.first,true);
      assert.equal(result.duplicate,false);
      assert.equal(result.already,true);
      assert.equal(result.sent.length,1);
      // 서버 messages.json의 common.hire_greeting.v1 문구 그대로 나가야 한다.
      assert.match(result.sent[0],/^고용이 확인됐습니다\. 맡겨주셔서 감사합니다\. 예상 작업 기간은 당일~1일입니다\./);
      assert.match(result.sent[0],/1차본.*수정본과 최종본/);
    });
    await check('Unrelated conversation quote is never reused', async () => {
      assert.equal(await page.evaluate(() => {audit.state.currentQuote={conversationId:'someone-else',amount:273000};return audit.currentConversationQuote('235090767');}),null);
    });
    await setup('<a href="/pro/chats/blocked"><span class="unread">1</span>제외</a><a href="/pro/chats/235090767">김준희 ?? 오전 11:55</a>', 'https://fixture.test/pro/chats');
    await page.evaluate(() => {document.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();window.opened=a.getAttribute('href');}));audit.state.manualBlocks.add('blocked');audit.state.startupMissedChatRecoveryDone=true;});
    await check('Existing read rooms are baselined without opening every conversation', async () => {
      assert.equal(await page.evaluate(() => audit.processChatList()),false);
      assert.equal(await page.evaluate(() => window.opened || null),null);
    });
    await check('Changed preview is recovered; blocked first card does not starve following customer', async () => {
      await page.evaluate(() => {document.querySelectorAll('a')[1].innerHTML='김준희 추가금 얼마에요?<span class="unread">1</span>';audit.state.lastChatOpened=null;});
      assert.equal(await page.evaluate(() => audit.processChatList()),true);
      assert.equal(await page.evaluate(() => opened),'/pro/chats/235090767');
    });
    await check('Unchanged read room is not reopened on a timer', async () => assert.equal(await page.evaluate(() => {audit.state.lastChatOpened=null;return audit.processChatList();}),false));
    await setup('<a href="/pro/chats/235090767">내 고용 김근국 · 데이터 크롤링<span class="badge">1</span></a>', 'https://fixture.test/pro/chats');
    await page.evaluate(() => document.querySelector('a').addEventListener('click',e=>{e.preventDefault();window.opened=e.currentTarget.getAttribute('href');}));
    await check('Unread hired chat is opened for automatic reply handling', async () => {
      assert.equal(await page.evaluate(() => audit.processChatList()),true);
      const result = await page.evaluate(() => ({opened,manualOnly:audit.state.chatPending.manualOnly}));
      assert.equal(result.opened,'/pro/chats/235090767');
      assert.equal(result.manualOnly,false);
    });
    await check('Same unread card is not reopened while its badge remains stale', async () => {
      const result = await page.evaluate(() => audit.shouldOpenUnreadRoom({key:'room-1',unread:true,signature:'same',previous:{signature:'same',at:Date.now()-60000,unread:true}}));
      assert.equal(result,false);
    });
    await check('A newly changed preview can reopen a room immediately', async () => {
      const result = await page.evaluate(() => audit.shouldOpenUnreadRoom({key:'room-1',unread:true,signature:'new-message',previous:{signature:'same',at:Date.now()-1000,unread:true}}));
      assert.equal(result,true);
    });
    await setup(`<ul>${message('hired-unread','파일은 오늘까지 전달되나요?')}</ul><textarea></textarea>`, 'https://fixture.test/pro/chats/235090767');
    await page.evaluate(() => {audit.state.chatPending={conversationId:'235090767',manualOnly:true,platformHireConfirmed:true,at:Date.now()};audit.state.settings.autoReply=false;});
    await check('Hired customer message reaches the reply engine and clears the old manual-only flag', async () => {
      assert.equal(await page.evaluate(() => audit.processChat()),true);
      const result = await page.evaluate(() => ({called:calls.some(c=>c.url.includes('/reply')),seen:audit.state.seen.size,room:audit.state.chatPending?.conversationId,manualOnly:audit.state.chatPending?.manualOnly,value:document.querySelector('textarea').value}));
      assert.equal(result.called,true);
      assert.equal(result.room,'235090767');
      assert.equal(result.manualOnly,false);
      assert.match(result.value,/추가금/);
    });
    await setup('<a href="/pro/chats">채팅 1</a><h1>채팅</h1><a href="/pro/chats/235143820">내 고용 김근국 · 데이터 크롤링</a>', 'https://fixture.test/pro/chats');
    await page.evaluate(() => document.querySelectorAll('a')[1].addEventListener('click',e=>{e.preventDefault();window.opened=e.currentTarget.getAttribute('href');}));
    await check('Global unread badge opens the newest own-hire room when the room badge is omitted', async () => {
      const found = await page.evaluate(() => ({count:audit.globalUnreadChatCount(),roomUnread:audit.linkHasUnread(document.querySelectorAll('a')[1])}));
      assert.equal(found.count,1);
      assert.equal(found.roomUnread,false);
      assert.equal(await page.evaluate(() => audit.processChatList()),true);
      const result = await page.evaluate(() => ({opened,manualOnly:audit.state.chatPending.manualOnly}));
      assert.equal(result.opened,'/pro/chats/235143820');
      assert.equal(result.manualOnly,false);
      assert.equal(await page.evaluate(() => audit.state.chatPending.platformHireConfirmed),true);
    });
    await setup('<a href="/pro/chats/235143820">내 고용 김근국 · 데이터 크롤링</a>', 'https://fixture.test/pro/chats');
    await page.evaluate(() => {
      mockSummary={leads:[{requestId:'lead-1',status:'견적 발송 확인 · 고용 요청 대기',taskId:null,createdAt:new Date().toISOString(),quoteEvidence:{status:'sent',at:new Date().toISOString(),url:'https://soomgo.com/pro/chats/235143820'}}],workflows:[]};
      document.querySelector('a').addEventListener('click',e=>{e.preventDefault();window.opened=e.currentTarget.getAttribute('href');});
    });
    await check('Recent unlinked own-hire room is inspected without an unread badge', async () => {
      assert.equal(await page.evaluate(() => audit.linkHasUnread(document.querySelector('a'))),false);
      assert.equal(await page.evaluate(() => audit.processChatList()),true);
      const result = await page.evaluate(() => ({opened,confirmed:audit.state.chatPending.platformHireConfirmed,manualOnly:audit.state.chatPending.manualOnly,summaryUrl:calls.find(c=>c.url.includes('/summary'))?.url}));
      assert.equal(result.opened,'/pro/chats/235143820');
      assert.equal(result.confirmed,true);
      assert.equal(result.manualOnly,false);
      assert.match(result.summaryUrl,/conversationId=235143820/);
    });
    await setup('<textarea></textarea>');
    await check('Pending hire cannot act in another conversation', async () => {
      assert.equal(await page.evaluate(() => {audit.state.pendingHire={conversationId:'other'};return audit.processPendingHire();}),false);
    });
    await setup(`<ul>${message('research-question','공개자료 조사까지 포함해서 진행해도 될까요?',true)}${message('safety-notice','숨고 알리미 휴대폰 번호 또는 계좌번호를 받으셨나요? 직접 거래는 사기나 피싱 위험이 있을 수 있어요. 서비스를 진행한다면 고용을 확정하고, 숨고에서 거래를 이어가세요.')}${message('short-yes','네')}</ul><textarea></textarea>`);
    await check('One-character yes survives a Soomgo safety notice and notice is excluded from context', async () => {
      const actual = await page.evaluate(() => { const x=audit.latestIncomingMessage(document.body.innerText,{preferUnhandled:true}); return {id:x?.messageId,text:x?.text,history:x?.conversationText}; });
      assert.equal(actual.id,'message-short-yes');
      assert.equal(actual.text,'네');
      assert.ok(actual.history.includes('[내 답변] 공개자료 조사까지 포함해서 진행해도 될까요?'));
      assert.ok(actual.history.includes('[고객] 네'));
      assert.ok(!actual.history.includes('휴대폰 번호 또는 계좌번호'));
      assert.ok(!actual.history.includes('숨고에서 거래를 이어가세요'));
    });
    await setup('<a href="/pro/chats">채팅 목록</a><textarea placeholder="메시지 입력"></textarea>', 'https://fixture.test/pro/chats/room-return');
    await page.evaluate(() => {
      audit.state.chatPending={conversationId:'room-return',at:Date.now()};
      document.querySelector('a').addEventListener('click',event=>{
        event.preventDefault(); history.pushState({},'', '/pro/chats');
        document.body.innerHTML='<h1>채팅</h1><a href="/pro/chats/room-return">고객</a>';
      });
    });
    await check('Reply completion returns to the actual chat list and only then clears the room state', async () => {
      const result=await page.evaluate(async()=>({returned:await audit.returnToChatList(),path:location.pathname,pending:audit.state.chatPending}));
      assert.equal(result.returned,true);
      assert.equal(result.path,'/pro/chats');
      assert.equal(result.pending,null);
    });
    await setup('<textarea placeholder="메시지 입력"></textarea>', 'https://fixture.test/pro/chats/room-fallback');
    await page.evaluate(() => { audit.state.chatPending={conversationId:'room-fallback',at:Date.now()}; });
    await check('When no usable back button exists, it navigates explicitly to the chat list instead of browser history', async () => {
      await Promise.all([
        page.waitForURL('https://fixture.test/pro/chats?filter=all&from=chatroom'),
        page.evaluate(() => audit.returnToChatList()).catch(() => {})
      ]);
      assert.equal(new URL(page.url()).pathname,'/pro/chats');
      assert.equal(new URL(page.url()).searchParams.get('from'),'chatroom');
    });
    console.log(`${passed} regression checks passed; no customer messages sent.`);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
