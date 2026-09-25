const VERSION_URL = 'http://127.0.0.1:8787/api/soomgo/bot-version';
const ALARM_NAME = 'relay-desk-version-check';
const STORAGE_KEY = 'relayDeskPublishedRevision';
const PENDING_KEY = 'relayDeskPendingPageRefresh';
const REQUEST_URLS = [
  'https://soomgo.com/requests/received*',
  'https://www.soomgo.com/requests/received*',
  'http://127.0.0.1:8787/*',
  'http://localhost:8787/*'
];

function schedule() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

async function refreshSafeTabs() {
  const tabs = await chrome.tabs.query({ url: REQUEST_URLS });
  await Promise.all(tabs.map(tab => tab.id ? chrome.tabs.reload(tab.id).catch(() => {}) : Promise.resolve()));
}

async function checkVersion() {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const remoteKey = `${data.revision || ''}|${data.requestVersion || ''}`;
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

chrome.runtime.onInstalled.addListener(() => { schedule(); checkVersion(); });
chrome.runtime.onStartup.addListener(() => { schedule(); checkVersion(); });
// Chrome 메모리 절약 기능이 요청봇 탭을 비활성화하면 자동견적과 심박이
// 멈춘다. 받은 요청 탭만 자동 비활성화 대상에서 제외한다(0.4.7).
async function keepRequestTabsAlive() {
  try {
    const tabs = await chrome.tabs.query({ url: REQUEST_URLS.slice(0, 2) });
    await Promise.all(tabs.map(tab => tab.id && tab.autoDiscardable !== false ? chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}) : null));
  } catch (_) {}
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) { checkVersion(); keepRequestTabsAlive(); } });
schedule();
(async () => {
  const pending = await chrome.storage.local.get(PENDING_KEY);
  if (pending[PENDING_KEY]) {
    await refreshSafeTabs();
    await chrome.storage.local.remove(PENDING_KEY);
  }
  await keepRequestTabsAlive();
})();
