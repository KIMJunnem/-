const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../soomgo-chat-bot/chat-content.js'), 'utf8');
const fragment = source.slice(source.indexOf('  async function reportReplyResult('), source.indexOf('  function reportFollowupResult('));
async function scenario(statuses) {
  const calls = [], alerts = [];
  const location = { href: 'https://soomgo.com/pro/chats/123' };
  const context = { location, AbortSignal, setTimeout: fn => fn(), writeHeartbeat: text => alerts.push(text), fetch: async (url, options) => {
    calls.push({ url, body: options.body });
    location.href = 'https://soomgo.com/pro/chats/456';
    const status = statuses.shift();
    if (status === 'network') throw new Error('offline');
    return { status, ok: status === 200 };
  } };
  vm.createContext(context);
  vm.runInContext(fragment, context);
  const result = await context.reportReplyResult('123', 'message-1', 'sent');
  assert(calls.every(call => call.url.endsWith('/reply-result')));
  assert(calls.every(call => call.body === calls[0].body));
  assert.equal(JSON.parse(calls[0].body).url, 'https://soomgo.com/pro/chats/123');
  return { result, calls, alerts };
}
(async () => {
  const recovered = await scenario(['network', 503, 200]);
  assert.equal(recovered.result, true);
  assert.equal(recovered.calls.length, 3);
  const missing = await scenario([404]);
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.result, false);
  assert.equal(missing.alerts.length, 1);
  const failed = await scenario([503, 503, 503]);
  assert.equal(failed.result, false);
  assert.equal(failed.calls.length, 3);
  console.log('PASS: receipt-only retries, stable room identity, bounded failure notification');
})().catch(error => { console.error(error); process.exitCode = 1; });
