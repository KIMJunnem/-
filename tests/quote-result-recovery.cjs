'use strict';
// 요청봇 0.4.21(2026-09-23 감독 지시 P3): 견적 결과 보고(quote-result)를 sessionStorage에 예약하고,
// 페이지 이동으로 끊기면 다음 로드에서 한 번만 다시 보낸다. 외부 호출 없음(가짜 fetch·가짜 sessionStorage).
// 서버 쪽 절반(24시간 지난 '발송 결과 대기' 알림 1회)은 tests/quote-result-missing.cjs가 검사한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'content-v3.js'), 'utf8');

const start = source.indexOf("  const QUOTE_RESULT_OUTBOX_KEY = ");
const end = source.indexOf('  async function returnToRequestList()');
assert.ok(start > 0 && end > start, '예약함 코드 블록을 찾는다');
const block = source.slice(start, end);

function makeEnv({ fetchOk = true, fetchThrows = false } = {}) {
  const store = new Map();
  const sessionStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  const calls = [];
  const env = { ok: fetchOk, throws: fetchThrows };
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive });
    if (env.throws) throw new Error('network');
    return { ok: env.ok };
  };
  const location = { href: 'https://soomgo.com/requests/received/abc' };
  const QUOTE_RESULT_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/quote-result';
  const api = new Function('sessionStorage', 'fetch', 'location', 'QUOTE_RESULT_ENDPOINT',
    `${block}; return { reserveQuoteResult, reportQuoteResult, flushQuoteResultOutbox, readQuoteResultOutbox };`
  )(sessionStorage, fetch, location, QUOTE_RESULT_ENDPOINT);
  return { api, calls, env, location, store };
}

(async () => {
  // 1) 정상: 발송 전 예약(uncertain) → 같은 문서에서 sent 보고 성공 → 예약함 비움, 다음 로드에 재전송 없음
  {
    const { api, calls } = makeEnv();
    api.reserveQuoteResult('REQ-1', 'uncertain', '누른 뒤 끊김');
    assert.equal(api.readQuoteResultOutbox().length, 1);
    assert.equal(await api.reportQuoteResult('REQ-1', 'sent', '확인'), true);
    assert.equal(api.readQuoteResultOutbox().length, 0, '성공하면 예약을 지운다');
    const flushed = await api.flushQuoteResultOutbox();
    assert.deepEqual(flushed, { due: 0, delivered: 0 });
    assert.equal(calls.length, 1, '보고는 한 번만');
  }

  // 2) 버튼 누른 뒤 페이지가 바뀜(보고 못 함) → 다음 로드에서 uncertain을 한 번만 다시 보낸다
  {
    const { api, calls } = makeEnv();
    api.reserveQuoteResult('REQ-2', 'uncertain', '견적 보내기를 누른 뒤 결과를 확인하기 전에 페이지가 바뀌었습니다.');
    const first = await api.flushQuoteResultOutbox();
    assert.deepEqual(first, { due: 1, delivered: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.requestId, 'REQ-2');
    assert.equal(calls[0].body.status, 'uncertain');
    assert.match(calls[0].body.note, /페이지 이동 뒤 재전송/);
    assert.equal(calls[0].keepalive, true);
    const second = await api.flushQuoteResultOutbox();
    assert.deepEqual(second, { due: 0, delivered: 0 }, '두 번째 로드에서는 다시 보내지 않는다');
    assert.equal(calls.length, 1);
  }

  // 3) sent 보고가 서버에 못 닿음(서버 꺼짐) → 예약이 sent로 남고, 다음 로드에서 sent로 한 번 재전송(시각·URL은 원래 값)
  {
    const { api, calls, env, location } = makeEnv({ fetchThrows: true });
    api.reserveQuoteResult('REQ-3', 'uncertain', '누른 뒤');
    location.href = 'https://soomgo.com/pro/chats/123456789';
    assert.equal(await api.reportQuoteResult('REQ-3', 'sent', '채팅방 이동 확인'), false);
    const kept = api.readQuoteResultOutbox();
    assert.equal(kept.length, 1, '요청번호마다 하나만 남긴다');
    assert.equal(kept[0].status, 'sent', '최근 결과(sent)가 예약을 덮는다');
    const originalAt = kept[0].at;
    env.throws = false;
    location.href = 'https://soomgo.com/requests/received?from=gnb';
    assert.deepEqual(await api.flushQuoteResultOutbox(), { due: 1, delivered: 1 });
    const replay = calls[calls.length - 1].body;
    assert.equal(replay.status, 'sent');
    assert.equal(replay.at, originalAt, '재전송도 원래 시각');
    assert.equal(replay.url, 'https://soomgo.com/pro/chats/123456789', '재전송도 원래 채팅방 URL(대화번호 연결용)');
    assert.equal(api.readQuoteResultOutbox().length, 0);
  }

  // 4) 재전송도 실패 → 예약함에서 빼고 더 보내지 않는다(서버 quote_result_missing 알림이 잡는다)
  {
    const { api, calls } = makeEnv({ fetchOk: false });
    api.reserveQuoteResult('REQ-4', 'uncertain', '끊김');
    assert.deepEqual(await api.flushQuoteResultOutbox(), { due: 1, delivered: 0 });
    assert.equal(api.readQuoteResultOutbox().length, 0);
    assert.deepEqual(await api.flushQuoteResultOutbox(), { due: 0, delivered: 0 });
    assert.equal(calls.length, 1, '한 번만');
  }

  // 5) 재전송 도중 문서가 끊겨도(retried 표시가 남음) 다음 로드에서 또 보내지 않는다
  {
    const { api, calls, store } = makeEnv();
    store.set('relaySoomgoQuoteResultOutboxV1', JSON.stringify([{ requestId: 'REQ-5', status: 'uncertain', note: 'x', at: new Date().toISOString(), url: 'u', retried: true }]));
    assert.deepEqual(await api.flushQuoteResultOutbox(), { due: 0, delivered: 0 });
    assert.equal(calls.length, 0);
    assert.equal(api.readQuoteResultOutbox().length, 0, 'retried 예약은 치운다');
  }

  // 6) 24시간 넘은 예약은 보내지 않고 버린다
  {
    const { api, calls, store } = makeEnv();
    store.set('relaySoomgoQuoteResultOutboxV1', JSON.stringify([{ requestId: 'REQ-6', status: 'uncertain', note: 'x', at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), url: 'u', retried: false }]));
    assert.deepEqual(await api.flushQuoteResultOutbox(), { due: 0, delivered: 0 });
    assert.equal(calls.length, 0);
  }

  // 7) 연결 위치(정적 검사): 버튼을 누르기 전에 예약하고, 새 문서 로드 때 재전송한다
  const reserveAt = source.indexOf("reserveQuoteResult(resultRequestId, 'uncertain'");
  const clickAt = source.indexOf('if (!clickSendButton(send))');
  assert.ok(reserveAt > 0 && reserveAt < clickAt, '발송 버튼 클릭 전에 예약');
  const flushAt = source.indexOf('await flushQuoteResultOutbox();');
  const chatReturnAt = source.indexOf("if (/\\/pro\\/chats/.test(location.pathname)) return;");
  assert.ok(flushAt > 0 && flushAt < chatReturnAt, '로드 시 재전송은 채팅방 조기 종료보다 앞');
  assert.match(source, /sessionStorage\.removeItem\(RETURN_AFTER_SEND_KEY\);[\s\S]{0,160}await returnToRequestList\(\);/, '기존 채팅방 복귀 흐름 유지');
  // 견적 금액·문구는 건드리지 않는다: 예약 블록에 금액·메시지 필드가 없다
  assert.doesNotMatch(block, /quote\.amount|quote\.message/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.4.27');
  assert.match(source, /요청봇 0\.4\.27/);
  console.log('quote-result-recovery: PASS');
})().catch(error => { console.error(error); process.exit(1); });
