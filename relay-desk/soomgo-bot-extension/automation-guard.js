(function (root) {
  'use strict';

  function createGuard(options) {
    const { role, isPaused, onStatus } = options || {};
    // 잠금 보유 탭의 심박(E, 2026-09-22). 보유 탭은 잠금을 잡을 때와 beat() 호출 때
    // localStorage에 시각을 남긴다. 심박이 staleMs(기본 30초) 넘게 끊기면(한 동작이
    // 멈췄거나 탭이 얼었을 때) 기다리던 탭이 잠금을 넘겨받는다(steal).
    const staleMs = Number(options?.staleMs) > 0 ? Number(options.staleMs) : 30000;
    const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (role !== 'request' && role !== 'chat') {
      throw new TypeError('role must be request or chat');
    }
    if (typeof isPaused !== 'function') {
      throw new TypeError('isPaused must be a function');
    }
    if (onStatus !== undefined && typeof onStatus !== 'function') {
      throw new TypeError('onStatus must be a function');
    }

    let stopped = false;
    let running = false;
    let holding = false;
    const name = 'relay-soomgo-' + role;
    const beatKey = 'relayGuardBeatV1:' + role;
    function storage() {
      try { return root.localStorage || null; } catch (_) { return null; }
    }
    function readBeat() {
      const store = storage();
      if (!store) return null;
      try { return JSON.parse(store.getItem(beatKey) || 'null'); } catch (_) { return null; }
    }
    function beat() {
      if (!holding) return;
      const store = storage();
      if (!store) return;
      try { store.setItem(beatKey, JSON.stringify({ owner: tabId, at: Date.now() })); } catch (_) {}
    }
    // 이 탭이 지금의 잠금 보유자인지(넘겨받긴 뒤 옛 탭이 발송하지 않게 확인용).
    function owns() {
      if (!holding) return false;
      const current = readBeat();
      return !current || current.owner === tabId;
    }
    // 이 탭이 동작하는 도중 다른 탭이 잠금을 넘겨받았는지(그러면 발송하지 않는다).
    function superseded() {
      if (!holding) return false;
      const current = readBeat();
      return Boolean(current && current.owner !== tabId);
    }
    function staleHolder() {
      const current = readBeat();
      if (!current || current.owner === tabId) return false;
      return Date.now() - Number(current.at || 0) > staleMs;
    }

    function status(code) {
      // Reporting failures must not bypass the guard or release a held lock.
      try {
        if (onStatus) Promise.resolve(onStatus(code)).catch(function () {});
      } catch (_) {}
    }

    async function check() {
      if (stopped) return false;
      try {
        const paused = await isPaused();
        if (stopped) return false;
        if (paused) {
          status('paused');
          return false;
        }
        return true;
      } catch (_) {
        status('pause-check-failed');
        return false;
      }
    }

    async function run(fn) {
      if (stopped || running) return false;
      if (typeof fn !== 'function') throw new TypeError('fn must be a function');

      // Reserve locally before any await, including the first pause check.
      running = true;
      try {
        if (!(await check()) || stopped) return false;

        let locks;
        try {
          locks = root.navigator && root.navigator.locks;
          if (!locks || typeof locks.request !== 'function') {
            status('locks-unavailable');
            return false;
          }
        } catch (_) {
          status('locks-unavailable');
          return false;
        }

        const BUSY = {};
        const body = async function (lock) {
          if (!lock) return BUSY;
          if (stopped || !running) return false;
          if (!(await check()) || stopped || !running) return false;
          holding = true;
          beat();
          try { return await fn(); } finally { holding = false; }
        };
        // 정상 흐름: 비어 있을 때만 잡는다. 전체 fn이 끝날 때까지 기다린다.
        const result = await locks.request(name, { ifAvailable: true }, body);
        if (result !== BUSY) return result;
        // 다른 탭이 잡고 있다. 그 탭의 심박이 끊겼을 때만 넘겨받는다.
        if (!staleHolder()) {
          status('role-busy');
          return false;
        }
        status('lock-stolen');
        return await locks.request(name, { steal: true }, async function (lock) {
          const stolen = await body(lock);
          return stolen === BUSY ? false : stolen;
        });
      } finally {
        running = false;
      }
    }

    function stop() {
      stopped = true;
    }

    return { run, check, stop, beat, owns, superseded };
  }

  const api = { createGuard };
  root.RelayAutomationGuard = api;
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
})(globalThis);
