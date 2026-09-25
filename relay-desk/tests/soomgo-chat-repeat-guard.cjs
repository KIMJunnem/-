const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
const body = source.slice(0, source.lastIndexOf('  loadSettings().then('))
  + 'globalThis.__test = { state, shouldOpenUnreadRoom };\n})();';
const sandbox = {
  console,
  document: { body: { innerText: '' } },
  location: { pathname: '/pro/chats', href: 'https://soomgo.com/pro/chats' },
  window: { location: { pathname: '/pro/chats', href: 'https://soomgo.com/pro/chats' }, getComputedStyle: () => ({}) },
  localStorage: { getItem: () => null, setItem() {} },
  chrome: { storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } } },
  setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Event,
  MutationObserver: class { observe() {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(body, sandbox);

const guard = sandbox.__test.shouldOpenUnreadRoom;
assert.equal(guard({ key: 'room-1', unread: true, signature: 'same', previous: { signature: 'same', unread: true, at: Date.now() - 60000 } }), false,
  'stale unread badge must not reopen the same conversation');
assert.equal(guard({ key: 'room-1', unread: true, signature: 'new-message', previous: { signature: 'same', unread: true, at: Date.now() - 1000 } }), true,
  'new preview must be eligible immediately');
assert.equal(guard({ key: 'room-1', unread: true, signature: 'same', previous: { signature: 'same', unread: false, at: Date.now() - 1000 } }), true,
  'a new unread after a read state must be eligible');
sandbox.__test.state.manualBlocks.add('room-1');
assert.equal(guard({ key: 'room-1', unread: true, signature: 'newer', previous: { signature: 'new-message', unread: true, at: 0 } }), false,
  'manually blocked conversation must remain closed');

const autoReplyBranch = source.match(/if \(data\.duplicate\) \{[\s\S]*?return true;\n\s*\}/)?.[0] || '';
assert.match(autoReplyBranch, /중복 문의 차단/);
assert.match(autoReplyBranch, /await returnToChatList\(\)/);
console.log('Soomgo chat repeat guard checks passed; no customer messages sent.');
