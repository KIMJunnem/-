'use strict';
// Persistent transport outbox, not a reply generator. Failures retain snapshots.
const RD_WAKE_KEY = 'relayCustomerWakeOutboxV1';
const RD_WAKE_ALARM = 'relay-customer-wake-flush';
let rdWakeChain = Promise.resolve();
let rdWakeFlushing = false;
async function rdWakeFlush() {
  if (rdWakeFlushing) return false;
  rdWakeFlushing = true;
  try {
    let queue = (await chrome.storage.local.get(RD_WAKE_KEY))[RD_WAKE_KEY] || [];
    while (queue.length) {
      const response = await fetch('http://127.0.0.1:8791/observe', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-wake': 'local-v1' },
        body: JSON.stringify(queue[0]), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok || !(await response.json()).ok) return false;
      queue = queue.slice(1);
      await chrome.storage.local.set({ [RD_WAKE_KEY]: queue });
    }
    return true;
  } catch (_) { return false; }
  finally { rdWakeFlushing = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'relay-customer-observation') return;
  if (!/^https:\/\/(?:www\.)?soomgo\.com\/pro\/chats(?:[/?]|$)/.test(sender.url || '')) { respond({ ok: false }); return; }
  rdWakeChain = rdWakeChain.then(async () => {
    const queue = (await chrome.storage.local.get(RD_WAKE_KEY))[RD_WAKE_KEY] || [];
    // Keep changed snapshots during downtime. Only duplicate consecutive
    // observations may be collapsed. Never drop an unseen customer message.
    const snapshot = message.snapshot;
    if (JSON.stringify(queue[queue.length - 1]) !== JSON.stringify(snapshot)) queue.push(snapshot);
    await chrome.storage.local.set({ [RD_WAKE_KEY]: queue });
    const forwarded = await rdWakeFlush();
    respond({ ok: true, forwarded });
  }).catch(() => respond({ ok: false }));
  return true;
});
chrome.alarms.create(RD_WAKE_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === RD_WAKE_ALARM) rdWakeChain = rdWakeChain.then(rdWakeFlush).catch(() => {});
});
