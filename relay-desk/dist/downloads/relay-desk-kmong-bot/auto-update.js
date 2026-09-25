const VERSION_URL = 'http://127.0.0.1:8787/api/soomgo/bot-version';
const ALARM_NAME = 'relay-desk-kmong-version-check';
const STORAGE_KEY = 'relayKmongPublishedRevision';
const PENDING_KEY = 'relayKmongPendingPageRefresh';
const API_ROOT = 'http://127.0.0.1:8787/api/kmong';
const API_PATHS = new Set(['/heartbeat', '/control', '/reply', '/reply-result', '/order', '/status', '/catalog']);
const KMONG_URLS = [
  'https://kmong.com/inboxes*',
  'https://www.kmong.com/inboxes*',
  'https://kmong.com/seller/order-list*',
  'https://www.kmong.com/seller/order-list*',
  'http://127.0.0.1:8787/*',
  'http://localhost:8787/*'
];

function schedule() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

async function refreshSafeTabs() {
  const tabs = await chrome.tabs.query({ url: KMONG_URLS });
  await Promise.all(tabs.map(tab => tab.id ? chrome.tabs.reload(tab.id).catch(() => {}) : Promise.resolve()));
}

async function checkVersion() {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const remoteKey = `${data.revision || ''}|${data.kmongVersion || ''}`;
    if (!data.revision || data.revision === 'unpublished') return;
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (!stored[STORAGE_KEY]) {
      await chrome.storage.local.set({ [STORAGE_KEY]: remoteKey });
      return;
    }
    if (stored[STORAGE_KEY] === remoteKey) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: remoteKey, [PENDING_KEY]: true });
    chrome.runtime.reload();
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'relay-kmong-api') return false;
  (async () => {
    const path = String(message.path || '');
    const method = String(message.method || 'GET').toUpperCase();
    if (!API_PATHS.has(path) || !['GET', 'POST'].includes(method)) throw new Error('kmong_api_request_blocked');
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1000, Math.min(30000, Number(message.timeoutMs) || 8000))),
      headers: { 'content-type': 'application/json', 'x-relay-bot': 'kmong-extension' },
      ...(method === 'POST' ? { body: typeof message.body === 'string' ? message.body : JSON.stringify(message.body || {}) } : {})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return sendResponse({ ok: false, status: response.status, error: body.error || `http_${response.status}`, body });
    sendResponse({ ok: true, status: response.status, body });
  })().catch(error => sendResponse({ ok: false, status: 0, error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => { schedule(); checkVersion(); });
chrome.runtime.onStartup.addListener(() => { schedule(); checkVersion(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) checkVersion(); });
schedule();
(async () => {
  const pending = await chrome.storage.local.get(PENDING_KEY);
  if (pending[PENDING_KEY]) {
    await refreshSafeTabs();
    await chrome.storage.local.remove(PENDING_KEY);
  }
})();
