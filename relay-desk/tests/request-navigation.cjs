const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RELAY_PLAYWRIGHT || 'playwright');

const source = fs.readFileSync(path.join(__dirname, '../soomgo-bot-extension/content.js'), 'utf8');
const exposed = source.slice(0, source.lastIndexOf('  loadSettings().then('))
  .replaceAll('Date.now() + 1800', 'Date.now() + 40')
  .replaceAll('Date.now() + 2200', 'Date.now() + 80')
  .replaceAll('await sleep(100)', 'await sleep(5)')
  + `\nwindow.audit = { state, processList, returnToRequestList, requestCardKey };\n})();`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.RELAY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  let passed = 0;
  try {
    await page.goto('https://fixture.test/requests/received');
    await page.setContent(`
      <main>
        받은 요청 목록
        <button class="request-item-card-wrapper" data-id="first-request">첫 요청 · 자세히 보기</button>
        <button class="request-item-card-wrapper" data-id="first-request">두 번째 요청 · 자세히 보기</button>
      </main>`);
    await page.evaluate(() => {
      window.saved = {};
      window.chrome = { storage: { local: {
        get: async () => saved,
        set: async values => Object.assign(saved, values),
        remove: async key => delete saved[key]
      } } };
      const [first, second] = document.querySelectorAll('button');
      first.addEventListener('click', () => { window.firstClicks = (window.firstClicks || 0) + 1; });
      second.addEventListener('click', () => {
        window.secondClicks = (window.secondClicks || 0) + 1;
        history.pushState({}, '', '/requests/received/REQUEST2222');
        document.querySelector('main').innerHTML = '요청 상세 이용 목적 문서/글 작성 견적 금액';
      });
    });
    await page.addScriptTag({ content: exposed });
    await page.evaluate(() => { audit.state.seen = new Set(); audit.state.openFailures = {}; });
    await page.evaluate(async () => audit.processList());
    await page.evaluate(async () => audit.processList());
    const clicks = await page.evaluate(() => ({ first: firstClicks, second: secondClicks, path: location.pathname }));
    assert.equal(clicks.first, 1, '막힌 첫 요청을 반복해서 클릭했습니다.');
    assert.equal(clicks.second, 1, '첫 요청이 막혔을 때 다음 요청으로 넘어가지 않았습니다.');
    assert.equal(clicks.path, '/requests/received/REQUEST2222');
    console.log('[PASS] 막힌 첫 카드에 잠시 재시도하지 않고 다음 요청 상세를 엶');
    passed += 1;

    await page.setContent(`
      <a href="/pro/quotes">요청·견적</a>
      <a id="received" href="/requests/received?from=gnb">받은 요청 목록</a>
      <main>요청 상세 이용 목적 문서/글 작성 견적 금액</main>`);
    await page.evaluate(() => {
      document.querySelector('#received').addEventListener('click', event => {
        event.preventDefault();
        history.pushState({}, '', '/requests/received?from=gnb');
        document.querySelector('main').textContent = '받은 요청 목록';
      });
    });
    await page.evaluate(async () => audit.returnToRequestList(false));
    const returned = await page.evaluate(() => location.pathname);
    assert.equal(returned, '/requests/received', '정확한 받은 요청 목록으로 복귀하지 못했습니다.');
    console.log('[PASS] 이전 히스토리 대신 받은 요청 목록 URL 복귀를 확인');
    passed += 1;

    console.log(`PASS ${passed} request navigation checks`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
