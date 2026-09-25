const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const body = source.slice(0, source.lastIndexOf('  loadSettings().then('))
  + 'globalThis.__test = { platformConfirmation, state };\n})();';

let systemText = '';
const systemNode = {
  get innerText() { return systemText; },
  textContent: '',
  closest: () => null,
  getAttribute: () => null,
  getBoundingClientRect: () => ({ width: 1, height: 1 })
};
const sandbox = {
  console,
  document: { body: { innerText: '' }, querySelectorAll: () => [systemNode] },
  location: { pathname: '/pro/chats/235143820', href: 'https://soomgo.com/pro/chats/235143820' },
  window: { location: { pathname: '/pro/chats/235143820', href: 'https://soomgo.com/pro/chats/235143820' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  localStorage: { getItem: () => null, setItem() {} },
  chrome: { storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } } },
  setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Event,
  MutationObserver: class { observe() {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(body, sandbox);

systemText = '숨고 알리미 고용이 확정됐어요. 9월 17일 (목) 오후 5:36분까지 취소를 요청할 수 있어요.';
assert.ok(sandbox.__test.platformConfirmation('hire'), 'official hire alert must count as confirmation even with a cancellation deadline');
systemText = '숨고 알리미 고용이 취소되었습니다.';
assert.equal(sandbox.__test.platformConfirmation('hire'), null, 'a canceled hire must not trigger the welcome message');

const sender = source.slice(source.indexOf('async function sendHireWelcome'), source.indexOf('async function detectPaymentCompletion'));
assert.match(sender, /예상 소요일은 \$\{days\}/, 'welcome must include the workflow turnaround estimate');
assert.match(sender, /고용해 주셔서 감사합니다/, 'welcome must thank the customer');
assert.match(sender, /hireWelcomeWasSent\(conversationId\)/, 'welcome must be deduplicated by conversation');
assert.match(sender, /await rememberHireWelcome\(conversationId\)/, 'a sent or already-visible welcome must be recorded');
assert.match(source, /await sendHireWelcome\(workflow, pageText\(\)\)/, 'confirmed hire flow must send the welcome before leaving the room');
assert.ok(source.includes('/숨고\\s*알리미/.test(value)'), 'confirmation detection must check the official Soomgo notification label');
assert.ok(source.includes('고용(?:이\\s*확정'), 'confirmation detection must recognize the official confirmed-hire wording');
assert.match(source, /if \(!await sendHireWelcomeForConversation\(pending\.conversationId\)\) return true/, 'failed welcome must stay in the room for retry');
assert.match(source, /if \(pending\.relayQueued\) \{[\s\S]*?if \(!await sendHireWelcomeForConversation\(conversationId\)\) return true/, 'list-detected hire path must retry the welcome before returning to chats');
assert.match(server, /return \{ passes: 10, label: '독립 교차검증 10회'/, 'all future Soomgo requests must default to ten checks');
assert.match(server, /maxCycles: qualityPlan\.passes \+ 2,\s*qualityPasses: qualityPlan\.passes/, 'ten independent reviews plus the Astra final edit must run after the initial draft');
assert.match(server, /qualityCompleted = Math\.min\(requiredReviews, Math\.max\(0, reviewCycle - 1\)\)/, 'review progress must be tracked before the Astra final edit');
console.log('Hire-confirmation greeting guard checks passed; no customer messages sent.');
