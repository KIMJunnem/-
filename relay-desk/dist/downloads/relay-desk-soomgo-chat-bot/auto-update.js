importScripts('customer-wake-background.js');
const VERSION_URL = 'http://127.0.0.1:8787/api/soomgo/bot-version';
const ALARM_NAME = 'relay-desk-version-check';
const STORAGE_KEY = 'relayDeskPublishedRevision';
const PENDING_KEY = 'relayDeskPendingPageRefresh';
const CHAT_HOME = 'https://soomgo.com/pro/chats';
const CHAT_TAB_URLS = [
  'https://soomgo.com/pro/chats*',
  'https://www.soomgo.com/pro/chats*'
];
const CHAT_URLS = [
  'https://soomgo.com/pro/chats*',
  'https://www.soomgo.com/pro/chats*',
  'http://127.0.0.1:8787/*',
  'http://localhost:8787/*'
];

function schedule() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

let ensureChatTabPromise = null;

async function ensureChatTab() {
  if (ensureChatTabPromise) return ensureChatTabPromise;
  ensureChatTabPromise = (async () => {
    const tabs = await chrome.tabs.query({ url: CHAT_TAB_URLS });
    if (tabs.some(tab => Number.isInteger(tab.id))) return false;
    await chrome.tabs.create({ url: CHAT_HOME, active: false });
    return true;
  })().catch(() => false).finally(() => {
    ensureChatTabPromise = null;
  });
  return ensureChatTabPromise;
}

async function refreshSafeTabs() {
  const tabs = await chrome.tabs.query({ url: CHAT_URLS });
  await Promise.all(tabs.map(tab => tab.id ? chrome.tabs.reload(tab.id).catch(() => {}) : Promise.resolve()));
}

async function checkVersion() {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const remoteKey = `${data.revision || ''}|${data.chatVersion || ''}`;
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

chrome.runtime.onInstalled.addListener(() => { schedule(); checkVersion(); ensureChatTab(); });
chrome.runtime.onStartup.addListener(() => { schedule(); checkVersion(); ensureChatTab(); });
// 0.3.15: 채팅봇 탭이 Chrome에 의해 비활성화·일시중지되면 심박이 끊기고
// 새 채팅을 놓친다. (1) 채팅 탭을 자동 비활성화 대상에서 제외하고,
// (2) 서버 심박이 5분 넘게 멈췄고 서버 일시정지·처리 중이 아니면 채팅 탭
// 하나만 새로고침한다. 새로고침은 10분에 한 번으로 제한한다. 발송 중복은
// chat-content.js의 시도 기록·결과 불확실 보류 규칙이 계속 막는다.
const HEALTH_URL = 'http://127.0.0.1:8787/api/health';
const CONTROL_URL = 'http://127.0.0.1:8787/api/soomgo/control';
const WATCHDOG_KEY = 'relayChatWatchdogLastReloadAt';
const CHAT_STALE_MS = 5 * 60 * 1000;
const WATCHDOG_COOLDOWN_MS = 10 * 60 * 1000;

async function keepChatTabsAlive(tabs) {
  await Promise.all(tabs.map(tab => tab.id && tab.autoDiscardable !== false ? chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}) : null));
}

async function chatHeartbeatWatchdog() {
  try {
    const settings = await chrome.storage.local.get('relaySoomgoBotSettings');
    if (settings.relaySoomgoBotSettings?.enabled === false) return;
    const tabs = (await chrome.tabs.query({ url: CHAT_TAB_URLS })).filter(tab => Number.isInteger(tab.id));
    if (!tabs.length) return;
    await keepChatTabsAlive(tabs);
    const [health, control] = await Promise.all([
      fetch(HEALTH_URL, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch(CONTROL_URL, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
    ]);
    if (!health || !control || control.paused) return;
    if (health.queue?.busy) return;
    const ageMs = Number(health.botHealth?.chat?.ageMs);
    if (!Number.isFinite(ageMs) || ageMs < CHAT_STALE_MS) return;
    const stored = await chrome.storage.local.get(WATCHDOG_KEY);
    if (Date.now() - Number(stored[WATCHDOG_KEY] || 0) < WATCHDOG_COOLDOWN_MS) return;
    await chrome.storage.local.set({ [WATCHDOG_KEY]: Date.now() });
    // 가장 최근에 사용한 채팅 탭 하나만 새로고침한다. 중복 탭은 닫지 않는다.
    const target = tabs.slice().sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
    await chrome.tabs.reload(target.id).catch(() => {});
  } catch (_) {}
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    checkVersion();
    ensureChatTab();
    chatHeartbeatWatchdog();
  }
});
chrome.tabs.onRemoved.addListener(() => {
  setTimeout(() => { ensureChatTab(); }, 1500);
});
schedule();
(async () => {
  const pending = await chrome.storage.local.get(PENDING_KEY);
  if (pending[PENDING_KEY]) {
    await refreshSafeTabs();
    await chrome.storage.local.remove(PENDING_KEY);
  }
  await ensureChatTab();
})();
