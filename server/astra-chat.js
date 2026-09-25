'use strict';
// Node.js 18+. Callbacks: getKey() -> key; canSpend(maxUsd, details) -> boolean;
// onUsage(record) -> void/Promise. No retries are made for either provider calls or usage callbacks.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MODEL = 'gpt-6-astra';
const SYSTEM = 'You are Astra in Relay Desk. This is direct chat and controlled operations review. You may review sanitized Relay Desk state and propose or validate changes, but you have no unrestricted tools. Never claim you have performed commands, customer messages, payments, file delivery, or arbitrary code changes unless the Relay Desk execution layer records verified evidence. Explain this limitation when relevant. For every business, operations, code, or customer-response decision request, do not stop at options or general advice. Compare the viable choices, select exactly one final decision, state the concrete settings or wording to apply, list what must be applied now and what must be deferred, and give measurable verification criteria. If essential evidence is missing, make a conservative provisional final decision and explicitly name the fact that would change it.';
const MAX_MESSAGE = 20000;
module.exports.createAstraChat = function createAstraChat({ dataDir, getKey, onUsage, canSpend }) {
  if (!dataDir || typeof getKey !== 'function') throw new Error('dataDir and getKey required');
  const filename = path.join(dataDir, 'astra-chat.json');
  let state, broken = false, tail = Promise.resolve();
  const now = () => new Date().toISOString();
  const clone = x => JSON.parse(JSON.stringify(x));
  // Browser retries can alter whitespace, line breaks, quotes, or punctuation.
  // Those changes must not create a second billable provider request.
  const normalizeFingerprintText = value => String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
  const locked = fn => {
    const p = tail.then(fn);
    tail = p.catch(() => {});
    return p;
  };
  async function save() {
    const tmp = filename + '.' + crypto.randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(tmp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(tmp, filename);
    } catch (e) {
      broken = true;
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  }
  const ready = (async () => {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      state = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.sessions) || !state.requests || !Number.isFinite(state.spendUsd)) throw new Error('Invalid chat store');
      if (!Array.isArray(state.debates)) { state.debates = []; await save(); }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      state = { version: 1, sessions: [], requests: {}, spendUsd: 0, unpricedResponses: 0, baseline: null, lastUsage: null, updatedAt: now() };
      await save();
    }
    let changed = false;
    for (const r of Object.values(state.requests)) {
      if (r.status === 'pending') {
        r.status = 'uncertain'; r.httpStatus = 409;
        r.result.status = 'uncertain';
        r.result.error = '서버가 재시작되어 처리 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.';
        r.result.assistant.status = 'uncertain';
        r.result.assistant.error = r.result.error;
        updateTurn(r.sessionId, r.result.assistant);
        changed = true;
      }
    }
    if (changed) { state.updatedAt = now(); await save(); }
  })();
  // Avoid unhandled initialization rejection before the first request.
  ready.catch(() => {});
  function updateTurn(sessionId, turn) {
    const s = state.sessions.find(s => s.id === sessionId);
    if (!s) return;
    const i = s.messages.findIndex(m => m.id === turn.id);
    if (i >= 0) s.messages[i] = clone(turn);
    s.updatedAt = now();
  }
  function balance() {
    const b = state.baseline;
    return {
      actualBalanceUsd: null, officialBalanceAvailable: false,
      notice: '실제 잔액 조회 미지원', scope: 'this chat only',
      estimateNotice: '수동 기준 잔액에서 이 채팅의 로컬 추적 비용만 차감한 추정치입니다. 다른 사용, 요금 조정, 결과 미확인 요청으로 실제 잔액과 다를 수 있습니다.',
      manualBaseline: b, trackedSpendUsd: state.spendUsd,
      estimatedBalanceUsd: b ? b.balanceUsd - (state.spendUsd - b.spendUsd) : null,
      unpricedResponses: state.unpricedResponses,
      uncertainRequests: Object.values(state.requests).filter(r => r.status === 'uncertain').length,
      updatedAt: state.updatedAt, lastUsage: state.lastUsage,
      billingUrl: 'https://platform.openai.com/settings/organization/billing/overview'
    };
  }
  function context(messages) {
    const selected = messages.filter(m => (m.role === 'user' || (m.role === 'assistant' && m.status === 'completed')) && m.text).slice(-20);
    let left = 50000 - SYSTEM.length;
    const out = [];
    for (let i = selected.length - 1; i >= 0 && left > 0; i--) {
      const text = selected[i].text.slice(-left);
      left -= text.length;
      out.unshift({ role: selected[i].role, content: [{ type: selected[i].role === 'assistant' ? 'output_text' : 'input_text', text }] });
    }
    return out;
  }
  function usageOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const valid = x => Number.isSafeInteger(x) && x >= 0;
    const input = raw.input_tokens, output = raw.output_tokens;
    const cached = raw.input_tokens_details?.cached_tokens;
    const ok = valid(input) && valid(output) && valid(cached) && cached <= input;
    return {
      inputTokens: valid(input) ? input : null,
      cachedInputTokens: valid(cached) ? cached : null,
      outputTokens: valid(output) ? output : null,
      costUsd: ok && input <= 272000 ? ((input - cached) * 10 + cached + output * 50) / 1000000 : null,
      pricing: 'standard, input context <=272000 tokens; USD per million: input 10, cached 1, output 50',
      raw
    };
  }
  function textOf(data) {
    const parts = [];
    for (const item of Array.isArray(data.output) ? data.output : []) {
      if (item.type !== 'message' || item.role !== 'assistant') continue;
      for (const c of Array.isArray(item.content) ? item.content : []) {
        if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      }
    }
    return parts.join('\n');
  }
  const respond = (sendJson, res, code, data) => { sendJson(res, code, data); return true; };
  async function runDebate(d) {
    while (true) {
      const snap = await locked(async () => clone(d));
      if (snap.stopRequested || snap.currentRound >= snap.maxRounds || snap.spendUsd >= snap.maxUsd) {
        await locked(async () => { d.status = d.stopRequested ? 'stopped' : 'completed'; d.updatedAt = now(); state.updatedAt = now(); await save(); });
        return;
      }
      const transcript = snap.turns.slice(-12).map(t => `회차 ${t.round}\n${t.text}`).join('\n\n');
      const prompt = `숨고 무인 운영에 대한 장기 토론을 진행한다. 주제: ${snap.topic}\n이번 회차: ${snap.currentRound + 1}/${snap.maxRounds}\n이전 토론:\n${transcript || '(첫 회차)'}\n\n이전 주장에 대한 반론과 근거를 제시하고, 바로 실행 가능한 개선안과 다음 질문을 제시하라. 실제 코드 수정, 고객 메시지, 결제, 파일 전달을 했다고 주장하지 말라. 한국어로 [분석] [반론] [개선안] [다음 질문] 순서로 답하라.`;
      let key, data = null, usage = null, error = null;
      try {
        if (canSpend && !(await canSpend(0.15, { model: MODEL, scope: 'astra debate' }))) throw new Error('spending_limit');
        key = await getKey();
        const response = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}, body:JSON.stringify({model:MODEL,instructions:SYSTEM,input:[{role:'user',content:[{type:'input_text',text:prompt}]}],store:false,max_output_tokens:8000,reasoning:{effort:'medium'}})});
        data = await response.json();
        if (!response.ok) throw new Error('provider_error');
        usage = usageOf(data.usage);
      } catch (e) { error = e.message || 'request_error'; }
      const text = data ? textOf(data) : '';
      await locked(async () => {
        if (error) { d.status = error === 'spending_limit' ? 'blocked' : 'failed'; d.error = 'Astra 토론 호출에 실패했습니다.'; d.updatedAt = now(); state.updatedAt = now(); await save(); return; }
        const cost = usage?.costUsd || 0; d.spendUsd += cost; state.spendUsd += cost; state.lastUsage = { model: MODEL, usage, costUsd: cost, scope: 'astra debate', updatedAt: now() }; if (usage?.costUsd == null) state.unpricedResponses++;
        d.currentRound++;
        const safe = /응대 문구|질문 순서|가격표|분류 규칙|로그 항목|시뮬레이션/i.test(text);
        const blocked = /결제|환불|고객에게.*전송|발주|납품|거래 상태/i.test(text);
        const improvementStatus = blocked ? 'approval_required' : safe ? 'safe_config_candidate' : 'test_before_apply';
        d.turns.push({ round:d.currentRound, text, usage, costUsd:cost, improvementStatus, execution:'queued', createdAt:now() });
        d.updatedAt = now(); state.updatedAt = now(); await save();
        if (onUsage) { try { await onUsage({ model: MODEL, usage, costUsd: cost, scope: 'astra debate', updatedAt: now() }); } catch (_) {} }
      });
    }
  }
  const handler = async function handler(req, res, pathname, body, sendJson) {
    if (!['/api/astra/chat','/api/astra/balance','/api/astra/debate','/api/astra/debate/stop'].includes(pathname)) return false;
    try {
      await ready;
      if (broken) return respond(sendJson, res, 503, { error: '채팅 저장소를 사용할 수 없습니다. 재전송하지 말고 관리자에게 문의하세요.' });
      if (req.method === 'GET') {
        if (pathname === '/api/astra/debate') {
          const id = new URL(req.url, 'http://localhost').searchParams.get('debateId');
          if (!id) return respond(sendJson, res, 200, { debates: state.debates.map(clone).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)) });
          const d = state.debates.find(x => x.id === id);
          return respond(sendJson, res, d ? 200 : 404, d ? { debate: clone(d) } : { error: '토론을 찾을 수 없습니다.' });
        }
        if (pathname.endsWith('/balance')) return respond(sendJson, res, 200, balance());
        const query = new URL(req.url, 'http://localhost').searchParams;
        const requestId = query.get('clientMessageId');
        if (requestId) {
          const record = state.requests['id:' + requestId];
          return respond(sendJson, res, record ? 200 : 404, record ? clone(record.result) : { error: '요청 기록을 찾을 수 없습니다.' });
        }
        const id = query.get('sessionId');
        if (id) {
          const session = state.sessions.find(s => s.id === id);
          return respond(sendJson, res, session ? 200 : 404, session ? { session: clone(session) } : { error: '대화를 찾을 수 없습니다.' });
        }
        return respond(sendJson, res, 200, { sessions: state.sessions.map(s => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      }
      if (req.method !== 'POST') return respond(sendJson, res, 405, { error: '허용되지 않은 메서드입니다.' });
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(sendJson, res, 400, { error: 'JSON 객체가 필요합니다.' });
      if (pathname.endsWith('/balance')) {
        if (typeof body.balanceUsd !== 'number' || !Number.isFinite(body.balanceUsd) || body.balanceUsd < 0 || body.balanceUsd > 1e9) return respond(sendJson, res, 400, { error: '유효한 balanceUsd 숫자가 필요합니다.' });
        const value = body.balanceUsd;
        return await locked(async () => {
          if (broken) throw new Error('Store unavailable');
          state.baseline = { balanceUsd: value, spendUsd: state.spendUsd, updatedAt: now() };
          state.updatedAt = now(); await save();
          return respond(sendJson, res, 200, balance());
        });
      }
      if (pathname === '/api/astra/debate/stop') {
        const id = typeof body.debateId === 'string' ? body.debateId : '';
        return await locked(async () => {
          const d = state.debates.find(x => x.id === id);
          if (!d) return respond(sendJson, res, 404, { error: '토론을 찾을 수 없습니다.' });
          d.stopRequested = true; d.status = 'stopped'; d.updatedAt = now(); state.updatedAt = now();
          const report = [
            `Astra 장기 토론 보고서`, `토론 ID: ${d.id}`, `주제: ${d.topic}`,
            `상태: 중단됨`, `회차: ${d.currentRound}/${d.maxRounds}`, `비용(추적): $${d.spendUsd.toFixed(5)}`, '',
            ...d.turns.map(t => `===== 회차 ${t.round} =====\n${t.text}`), '',
            '===== 실행 대기 항목 =====',
            '토론에서 제안된 개선안은 이 보고서에 기록했습니다. 고객 메시지·결제·발주·파일 전달·코드 변경은 보고서 확인 후 별도 실행 단계에서 적용합니다.'
          ].join('\n');
          d.reportFile = path.join(dataDir, `astra-debate-${d.id}.txt`);
          await fs.writeFile(d.reportFile, report, { encoding:'utf8', mode:0o600 });
          await save();
          return respond(sendJson, res, 200, { debate: clone(d) });
        });
      }
      if (pathname === '/api/astra/debate') {
        const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
        const maxRounds = Number.isInteger(body.maxRounds) ? Math.min(Math.max(body.maxRounds, 1), 50) : 10;
        const maxUsd = typeof body.maxUsd === 'number' && Number.isFinite(body.maxUsd) ? Math.min(Math.max(body.maxUsd, 0.01), 100) : 2;
        if (!topic || topic.length > MAX_MESSAGE) return respond(sendJson, res, 400, { error: '토론 주제가 필요합니다.' });
        const d = { id: crypto.randomUUID(), topic, maxRounds, maxUsd, status: 'running', stopRequested: false, currentRound: 0, spendUsd: 0, turns: [], createdAt: now(), updatedAt: now() };
        await locked(async () => { state.debates.push(d); state.updatedAt = now(); await save(); });
        runDebate(d).catch(() => {});
        return respond(sendJson, res, 202, { debate: clone(d) });
      }
      const { sessionId, clientMessageId } = body;
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > MAX_MESSAGE) return respond(sendJson, res, 400, { error: '메시지는 공백 제외 1~20,000자여야 합니다.' });
      if (typeof clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clientMessageId)) return respond(sendJson, res, 400, { error: '8~128자의 고유 clientMessageId가 필요합니다.' });
      if (sessionId != null && (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId))) return respond(sendJson, res, 400, { error: '잘못된 sessionId입니다.' });
      const normalizedMessage = normalizeFingerprintText(message);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([sessionId || null, normalizedMessage])).digest('hex');
      // One global spending lock also protects snapshots and atomic store updates.
      return await locked(async () => {
        if (broken) throw new Error('Store unavailable');
        const ledgerKey = 'id:' + clientMessageId;
        const old = state.requests[ledgerKey];
        if (old) {
          if (old.fingerprint !== fingerprint) return respond(sendJson, res, 409, { error: '이미 사용한 clientMessageId의 내용은 변경할 수 없습니다.' });
          return respond(sendJson, res, old.httpStatus, { ...clone(old.result), replayed: true });
        }
        // A client can generate a new ID after a browser timeout. Do not call the
        // provider again for the same session + message: the first request may
        // still complete and incur a charge after the caller has timed out.
        const prior = Object.entries(state.requests).find(([key, record]) => {
          if (key === ledgerKey || !record) return false;
          if (record.fingerprint === fingerprint) return true;
          const priorText = record.result?.user?.text;
          const priorSessionId = record.sessionId || record.result?.sessionId || null;
          return priorSessionId === (sessionId || null)
            && normalizeFingerprintText(priorText) === normalizedMessage;
        });
        if (prior) {
          const [, record] = prior;
          const result = clone(record.result);
          if (record.status === 'pending' || record.status === 'uncertain') {
            return respond(sendJson, res, 409, {
              error: 'existing_request_uncertain',
              message: '같은 요청의 이전 결과가 아직 확정되지 않아 자동 재호출하지 않습니다.',
              retryAllowed: false,
              existing: result
            });
          }
          return respond(sendJson, res, record.httpStatus || 200, { ...result, replayed: true, originalClientMessageId: result.clientMessageId || null });
        }
        let session = sessionId ? state.sessions.find(s => s.id === sessionId) : null;
        if (sessionId && !session) return respond(sendJson, res, 404, { error: '대화를 찾을 수 없습니다.' });
        // UTF-8 bytes upper-bound input tokens; output reserve is the configured maximum.
        const prospective = [...(session?.messages || []), { role: 'user', text: message }];
        const input = context(prospective);
        const maxUsd = (Buffer.byteLength(SYSTEM + JSON.stringify(input), 'utf8') + 2048) * 10 / 1e6 + 12000 * 50 / 1e6;
        let key;
        try {
          if (canSpend && !(await canSpend(maxUsd, { model: MODEL, scope: 'this chat only', trackedSpendUsd: state.spendUsd }))) return respond(sendJson, res, 402, { error: '앱의 지출 한도로 요청이 차단되었습니다.' });
          key = await getKey();
        } catch (_) { return respond(sendJson, res, 503, { error: 'API 설정 또는 지출 한도를 확인할 수 없습니다.' }); }
        if (typeof key !== 'string' || !key.trim()) return respond(sendJson, res, 503, { error: '서버 API 키가 설정되지 않았습니다.' });
        if (!session) {
          session = { id: crypto.randomUUID(), title: message.slice(0, 60), createdAt: now(), updatedAt: now(), messages: [] };
          state.sessions.push(session);
          if (state.sessions.length > 20) {
            state.sessions.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
            state.sessions.shift();
          }
        }
        const user = { id: crypto.randomUUID(), role: 'user', text: message, clientMessageId, createdAt: now() };
        const assistant = { id: crypto.randomUUID(), role: 'assistant', text: '', status: 'pending', clientMessageId, model: null, responseId: null, usage: null, createdAt: now() };
        session.messages.push(user, assistant); session.messages = session.messages.slice(-60); session.updatedAt = now();
        const record = { fingerprint, sessionId: session.id, status: 'pending', httpStatus: 202, result: { sessionId: session.id, clientMessageId, status: 'pending', user: clone(user), assistant: clone(assistant), retryAllowed: false } };
        state.requests[ledgerKey] = record; state.updatedAt = now();
        await save(); // Durable reservation MUST precede network activity.
        const controller = new AbortController();
        // 긴 검수·문서 요청은 120초를 넘길 수 있다. 결과 불명확 상태에서
        // 자동 재전송하지 않는 정책은 유지하고, 응답 대기만 5분으로 늘린다.
        const timer = setTimeout(() => controller.abort(), 300000);
        let data = null, httpError = false, networkError = false;
        try {
          const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Client-Request-Id': clientMessageId },
            body: JSON.stringify({ model: MODEL, instructions: SYSTEM, input, store: false, max_output_tokens: 12000, reasoning: { effort: 'medium' } })
          });
          httpError = !response.ok;
          try { data = await response.json(); } catch (_) { if (!httpError) networkError = true; }
        } catch (_) { networkError = true; }
        finally { clearTimeout(timer); key = null; }
        const isResponse = data && data.object === 'response';
        if (isResponse) {
          assistant.text = textOf(data);
          assistant.model = typeof data.model === 'string' ? data.model : null;
          assistant.responseId = typeof data.id === 'string' ? data.id : null;
          assistant.providerStatus = typeof data.status === 'string' ? data.status : null;
          assistant.usage = usageOf(data.usage);
          assistant.status = ['completed', 'incomplete', 'failed', 'cancelled'].includes(data.status) ? data.status : 'uncertain';
          if (assistant.status !== 'completed') assistant.error = assistant.status === 'incomplete' ? '응답이 일부만 생성되었습니다. 같은 요청은 다시 실행하지 않습니다.' : '제공자 응답이 완료되지 않았습니다. 자동 재전송하지 않습니다.';
        } else {
          assistant.status = httpError && !networkError ? 'failed' : 'uncertain';
          assistant.error = httpError && !networkError ? 'API 요청이 거절되었습니다. 상세 제공자 오류는 보안상 표시하지 않습니다.' : '시간 초과 또는 연결 오류로 결과와 비용을 확인할 수 없습니다. 자동 재전송하지 않습니다.';
        }
        record.status = assistant.status;
        record.httpStatus = assistant.status === 'completed' || assistant.status === 'incomplete' ? 200 : 502;
        record.result = { sessionId: session.id, clientMessageId, status: assistant.status, assistant: clone(assistant), user: clone(user), retryAllowed: false, ...(assistant.error ? { error: assistant.error } : {}) };
        updateTurn(session.id, assistant);
        let usageRecord = null;
        if (isResponse) {
          usageRecord = { sessionId: session.id, clientMessageId, model: assistant.model, responseId: assistant.responseId, status: assistant.providerStatus, usage: assistant.usage, costUsd: assistant.usage?.costUsd ?? null, updatedAt: now(), scope: 'this chat only' };
          if (usageRecord.costUsd != null) state.spendUsd += usageRecord.costUsd;
          else state.unpricedResponses++;
          state.lastUsage = usageRecord;
          record.usageCallbackAttempted = true;
        }
        state.updatedAt = now();
        // Persist billing/result before notifying the optional external usage observer.
        // Callback is best-effort, at most once; restart/replay never invokes it again.
        let persistenceError;
        try { await save(); } catch (e) { persistenceError = e; }
        if (usageRecord && onUsage) {
          try { await onUsage(clone(usageRecord)); } catch (_) { /* Local accounting remains authoritative. */ }
        }
        if (persistenceError) throw persistenceError;
        return respond(sendJson, res, record.httpStatus, clone(record.result));
      });
    } catch (_) {
      return respond(sendJson, res, 503, { error: '채팅 처리 또는 저장에 실패했습니다. 결과가 불확실할 수 있으므로 새 ID로 재전송하지 마세요.', retryAllowed: false });
    }
  };
  // 운영 감사·비용·개선·필요사항을 동일한 Astra 채팅 화면에 남긴다.
  // 이 기록은 모델 호출을 추가하지 않으며, 고객 채널·결제·파일 상태를 변경하지 않는다.
  handler.appendSystemNote = async function appendSystemNote(note, metadata = {}) {
    await ready;
    return locked(async () => {
      if (broken) throw new Error('Store unavailable');
      const text = String(note || '').trim().slice(0, MAX_MESSAGE);
      if (!text) return null;
      let session = state.sessions.find(item => item.id === 'ops-audit');
      if (!session) {
        session = { id: 'ops-audit', title: 'Relay Desk 운영 점검', createdAt: now(), updatedAt: now(), messages: [] };
        state.sessions.push(session);
      }
      const message = {
        id: crypto.randomUUID(), role: 'assistant', status: 'completed', model: 'Astra 운영 기록',
        text, responseId: metadata.responseId || null, usage: metadata.usage || null,
        createdAt: now(), systemNote: true, auditType: metadata.auditType || 'operations'
      };
      session.messages.push(message);
      session.messages = session.messages.slice(-100);
      session.updatedAt = now(); state.updatedAt = now();
      await save();
      return clone(message);
    });
  };
  return handler;
};
