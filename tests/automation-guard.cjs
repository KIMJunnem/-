'use strict';

const assert = require('node:assert/strict');
const { createGuard } = require('../soomgo-chat-bot/automation-guard.js');

function deferred() {
  let resolve;
  const promise = new Promise(function (done) { resolve = done; });
  return { promise, resolve };
}

function fakeLocks() {
  const held = new Set();
  const requests = [];
  return {
    held,
    requests,
    async request(name, options, callback) {
      assert.deepEqual(options, { ifAvailable: true });
      requests.push(name);
      if (held.has(name)) return await callback(null);
      held.add(name);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        held.delete(name);
      }
    }
  };
}

async function main() {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  function setNavigator(value) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value
    });
  }

  try {
    assert.equal(globalThis.RelayAutomationGuard.createGuard, createGuard);
    assert.throws(() => createGuard({ role: 'other', isPaused: () => false }), TypeError);

    const locks = fakeLocks();
    setNavigator({ locks });
    const statuses = [];
    const make = (extra = {}) => createGuard({
      role: 'chat',
      isPaused: () => false,
      onStatus: code => statuses.push(code),
      ...extra
    });

    const first = make();
    const second = make();
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const pending = first.run(async () => {
      calls++;
      entered.resolve();
      await release.promise;
      return 'completed';
    });
    try {
      await entered.promise;
      assert.equal(await second.run(() => { calls++; }), false);
      assert.equal(await first.run(() => { calls++; }), false);
      assert.equal(calls, 1);
      assert.ok(statuses.includes('role-busy'));
      assert.ok(locks.held.has('relay-soomgo-chat'));

      // Stopping a guard must not release its pending callback's lock.
      first.stop();
      assert.equal(await first.check(), false);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(await second.run(() => { calls++; }), false);
      assert.ok(locks.held.has('relay-soomgo-chat'));
    } finally {
      release.resolve();
      await pending;
    }
    assert.equal(await pending, 'completed');
    assert.equal(locks.held.size, 0);
    assert.equal(await first.run(() => { calls++; }), false);
    assert.equal(await second.run(() => ++calls), 2);
    assert.ok(locks.requests.every(name => name === 'relay-soomgo-chat'));

    let forbiddenCalls = 0;
    const forbidden = () => { forbiddenCalls++; };
    const paused = make({ isPaused: async () => true });
    const requestCount = locks.requests.length;
    assert.equal(await paused.check(), false);
    assert.equal(await paused.run(forbidden), false);
    assert.equal(locks.requests.length, requestCount);

    // Pause changes between the pre-lock and post-lock checks.
    let checks = 0;
    const pausesAfterAcquiring = make({ isPaused: () => ++checks === 2 });
    assert.equal(await pausesAfterAcquiring.run(forbidden), false);
    assert.equal(checks, 2);
    assert.equal(locks.requests.length, requestCount + 1);
    assert.equal(locks.held.size, 0);

    const brokenPause = make({ isPaused: () => { throw new Error('pause unavailable'); } });
    assert.equal(await brokenPause.check(), false);
    assert.equal(await brokenPause.run(forbidden), false);
    assert.ok(statuses.includes('pause-check-failed'));

    // Local exclusion also applies while the initial pause check is pending.
    const pauseGate = deferred();
    const checking = make({ isPaused: () => pauseGate.promise });
    const waiting = checking.run(forbidden);
    try {
      assert.equal(await checking.run(forbidden), false);
      checking.stop();
    } finally {
      pauseGate.resolve(false);
      assert.equal(await waiting, false);
    }

    const failure = new Error('callback failed');
    await assert.rejects(second.run(async () => { throw failure; }), error => error === failure);
    assert.equal(locks.held.size, 0);
    assert.equal(await second.run(() => 'reusable'), 'reusable');

    setNavigator({});
    assert.equal(await make().run(forbidden), false);
    assert.ok(statuses.includes('locks-unavailable'));

    // Lock API rejection propagates without executing an unsafe fallback.
    setNavigator({ locks: { request: async () => { throw new Error('lock denied'); } } });
    await assert.rejects(make().run(forbidden), /lock denied/);
    assert.equal(forbiddenCalls, 0);

    console.log('automation-guard tests passed');
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
