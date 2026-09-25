const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.RELAY_PLAYWRIGHT || 'playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'kmong-bot-extension', 'content.js'), 'utf8');
const exposed = source.slice(0, source.lastIndexOf('  load().then(')) + `
  globalThis.__kmongAudit = { state, currentChatId, isSystemText, isClosedText, messageNodes, directionOf, latestIncomingMessage, findComposer, setComposerValue, findSendButton, orderCards };
})();`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RELAY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  let passed = 0;
  async function setup(html, url = 'https://fixture.test/inboxes?inbox_group_id=chat-1&partner_id=buyer-1') {
    await page.goto(url);
    await page.setContent(html);
    await page.evaluate(() => {
      window.chrome = { storage: { local: { async get() { return {}; }, async set() {} } } };
    });
    await page.addScriptTag({ content: exposed });
  }
  async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
  try {
    await setup(`
      <main>
        <div data-message-id="customer-1" data-direction="incoming"><span>영상 자막 작업 문의드려요.</span></div>
        <textarea placeholder="메시지를 입력하세요"></textarea>
        <button aria-label="보내기">보내기</button>
      </main>`);
    await check('conversation id comes from Kmong URL', async () => {
      assert.equal(await page.evaluate(() => __kmongAudit.currentChatId()), 'chat-1');
    });
    await check('incoming customer bubble is selected with stable message id', async () => {
      const actual = await page.evaluate(() => { const item = __kmongAudit.latestIncomingMessage(); return { id: item?.messageId, text: item?.text, direction: item?.direction }; });
      assert.deepEqual(actual, { id: 'customer-1', text: '영상 자막 작업 문의드려요.', direction: 'customer' });
    });
    await check('React-compatible composer update changes the actual field value', async () => {
      const actual = await page.evaluate(() => { const field = __kmongAudit.findComposer(); return { ok: __kmongAudit.setComposerValue(field, '초안입니다.'), value: field.value }; });
      assert.deepEqual(actual, { ok: true, value: '초안입니다.' });
    });
    await check('send button is resolved by visible semantic label', async () => {
      assert.equal(await page.evaluate(() => __kmongAudit.findSendButton(__kmongAudit.findComposer())?.getAttribute('aria-label')), '보내기');
    });

    await setup(`
      <div data-message-id="customer-2" data-direction="incoming">자소서 문의드립니다.</div>
      <div data-message-id="mine-2" data-direction="outgoing">지원 회사와 직무를 알려주세요.</div>
      <textarea placeholder="메시지 입력"></textarea>`);
    await check('customer message already followed by seller reply is not replayed', async () => {
      assert.equal(await page.evaluate(() => __kmongAudit.latestIncomingMessage()), null);
    });

    await setup(`
      <div data-message-id="system-1" data-direction="incoming">크몽 알림 주문이 접수되었습니다.</div>
      <textarea placeholder="메시지 입력"></textarea>`);
    await check('Kmong system notice is never treated as a customer request', async () => {
      assert.equal(await page.evaluate(() => __kmongAudit.latestIncomingMessage()), null);
    });

    await setup(`
      <article data-order-id="order-77">
        <a href="/seller/orders/order-77">영상 흐름에 맞춰 정확한 자막을 제작해 드립니다</a>
        <p>결제 완료 · 총 금액 32,000원 · 5분 영상 SRT</p>
      </article>`, 'https://fixture.test/seller/order-list');
    await check('paid order card exposes one stable order id', async () => {
      const actual = await page.evaluate(() => __kmongAudit.orderCards().map(item => ({ id: item.orderId, text: item.text })));
      assert.equal(actual.length, 1);
      assert.equal(actual[0].id, 'order-77');
      assert.match(actual[0].text, /결제 완료/);
    });

    console.log(`${passed} Kmong DOM checks passed; no external messages were sent.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
