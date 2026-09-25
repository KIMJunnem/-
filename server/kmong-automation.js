const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const serviceRegistry = require('./service-registry');

const VERSION = 1;

function now() {
  return new Date().toISOString();
}

function safeText(value, max = 10000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').slice(0, max);
}

function compact(value, max = 10000) {
  return safeText(value, max).replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function classifyService(input = {}) {
  const explicit = compact(input.serviceType || input.service || '', 100).toLowerCase();
  if (serviceRegistry.getService(explicit)) return explicit;
  const text = compact([
    explicit,
    input.serviceName,
    input.productTitle,
    input.title,
    input.category,
    input.message,
    input.conversationText
  ].filter(Boolean).join(' '), 20000);
  return serviceRegistry.classify(text).id;
}

function intakeQuestion(serviceType, index) {
  const service = serviceRegistry.getService(serviceType);
  return String(service?.intakeQuestions?.[index] || '').trim();
}

function isSystemMessage(text) {
  const value = compact(text, 4000);
  if (!value) return true;
  return /^(?:크몽|알림|시스템)\s*(?:알림|메시지)?/i.test(value)
    || /(?:결제가\s*완료|주문이\s*접수|거래가\s*완료|서비스가\s*구매|메시지\s*응답률|안전\s*결제|거래\s*확정)/.test(value);
}

function isClosedConversation(input = {}) {
  const text = compact([input.statusText, input.conversationText, input.message].filter(Boolean).join(' '), 12000);
  return /다른\s*전문가(?:를|와)\s*(?:선택|고용)|거래\s*(?:종료|취소|환불\s*완료)|문의\s*종료|대화\s*종료/.test(text);
}

function containsPhoneOrMeetingRequest(text) {
  return /전화|통화|대면|화상|줌|zoom|미팅/.test(compact(text, 4000));
}

function containsIllegalResumeRequest(text) {
  return /경력.*(?:만들|지어|허위)|없는\s*경력|학력.*(?:만들|위조)|자격증.*(?:만들|위조)|서명.*위조|직인.*위조/.test(compact(text, 5000));
}

function deterministicReply(input = {}) {
  const message = compact(input.message || input.text || '', 4000);
  const history = compact(input.conversationText || input.history || '', 12000);
  const serviceType = classifyService({ ...input, message, conversationText: history });
  const combined = `${history} ${message}`;

  if (containsIllegalResumeRequest(message)) {
    return {
      autoSend: true,
      manualReview: false,
      serviceType,
      templateKey: 'illegal_or_false_resume_request',
      text: '죄송하지만 자기소개서·이력서 작성은 진행하지 않고 있습니다. 없는 경력이나 증빙을 만드는 작업도 하지 않습니다.'
    };
  }
  if (containsPhoneOrMeetingRequest(message)) {
    return {
      autoSend: true,
      manualReview: false,
      serviceType,
      templateKey: 'chat_only',
      text: '세부 협의는 우선 크몽 메시지로 진행합니다. 작업 조건을 메시지로 남겨 주시면 확인 후 답변드리겠습니다.'
    };
  }
  if (/추가금|추가\s*(?:비용|작업)|얼마/.test(message)) {
    const amount = Number(input.additionalAmount || 0);
    return amount >= 15000
      ? {
          autoSend: true,
          manualReview: false,
          serviceType,
          templateKey: 'additional_fee_known',
          text: `요청하신 추가 범위에는 추가금 ${amount.toLocaleString('ko-KR')}원이 발생합니다. 금액을 확인하신 뒤 진행 여부를 알려주세요.`
        }
      : {
          autoSend: false,
          manualReview: true,
          serviceType,
          templateKey: 'additional_fee_scope_required',
          text: '',
          reason: '추가 범위와 금액 근거 확인 필요'
        };
  }
  if (/최종본|파일.*(?:보내|전달)|결제\s*전/.test(message) && input.paymentConfirmed !== true) {
    return {
      autoSend: true,
      manualReview: false,
      serviceType,
      templateKey: 'file_before_payment',
      text: '최종 파일은 결제가 확인된 뒤 보내드립니다. 결제가 확인되면 약속드린 형식으로 전달하겠습니다.'
    };
  }
  if (/진행(?:할게|하겠|해주세요|해\s*주세요)|구매(?:할게|하겠)|작업\s*(?:결정|시작)/.test(message)) {
    return {
      autoSend: true,
      manualReview: false,
      serviceType,
      templateKey: 'decision_before_order',
      text: '네, 맡겨주시면 바로 준비하겠습니다. 작업 전에 크몽 주문과 결제 상태만 확인하겠습니다.'
    };
  }
  if (serviceType === 'subtitle') {
    if (!/\d+\s*(?:분|초|시간)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'subtitle_duration', text: intakeQuestion(serviceType, 0) };
    }
    if (!/(?:한국어|영어|프랑스어|일본어|중국어|원어|언어)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'subtitle_language', text: intakeQuestion(serviceType, 1) };
    }
    if (!/(?:대본|스크립트).*(?:있|없|제공)|(?:있|없|제공).*(?:대본|스크립트)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'subtitle_script', text: intakeQuestion(serviceType, 2) };
    }
    return { autoSend: true, manualReview: false, serviceType, templateKey: 'subtitle_due_date', text: intakeQuestion(serviceType, 3) };
  }
  if (serviceType === 'presentation') {
    if (!/(?:보고서|원고|초안|자료|메모|파일).*(?:있|없|제공|보내)|(?:있|없|제공|보내).*(?:보고서|원고|초안|자료|메모|파일)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'presentation_source', text: intakeQuestion(serviceType, 0) };
    }
    if (!/(?:\d+\s*(?:장|페이지|슬라이드)|분량)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'presentation_volume', text: intakeQuestion(serviceType, 1) };
    }
    if (!/(?:발표|제출|교육|보고|제안|소개|강의|회의)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'presentation_purpose', text: intakeQuestion(serviceType, 2) };
    }
    return { autoSend: true, manualReview: false, serviceType, templateKey: 'presentation_style_deadline', text: intakeQuestion(serviceType, 3) };
  }
  if (serviceType === 'document_writing') {
    if (!/(?:목적|용도|보고서|소개|안내|게시|제출)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'document_purpose', text: intakeQuestion(serviceType, 0) };
    }
    if (!/(?:\d+[\s,]*(?:자|쪽|페이지)|a4|분량)/i.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'document_volume', text: intakeQuestion(serviceType, 1) };
    }
    if (!/(?:자료|초안|메모|링크|파일).*(?:있|없|제공|보내)|(?:있|없|제공|보내).*(?:자료|초안|메모|링크|파일)/.test(combined)) {
      return { autoSend: true, manualReview: false, serviceType, templateKey: 'document_materials', text: intakeQuestion(serviceType, 2) };
    }
    return { autoSend: true, manualReview: false, serviceType, templateKey: 'document_deadline', text: intakeQuestion(serviceType, 3) };
  }
  return {
    autoSend: false,
    manualReview: true,
    serviceType: null,
    templateKey: 'service_unknown',
    text: '',
    reason: '자막 제작, 일반 문서·글 작성, 원고·보고서의 PPT 변환 중 어떤 서비스인지 확인 필요'
  };
}

function validRoomReply(text, deterministic = {}) {
  const value = compact(text, 4000);
  if (!value || value.length > 1800) return false;
  if (/숨고|메로나|Relay\s*Desk|Astra|OpenAI|내부\s*(?:시스템|로그)/i.test(value)) return false;
  if (/\[(?:금액|고객|작업|날짜|회사|직무)[^\]]*\]/.test(value)) return false;
  if (/완료했습니다|전달했습니다|결제.*확인했습니다/.test(value) && !/완료|전달|결제/.test(compact(deterministic.text, 2000))) return false;
  return true;
}

function createKmongAutomation(options = {}) {
  const dataFile = path.resolve(options.dataFile || path.join(__dirname, 'data', 'kmong-automation.json'));
  const bridge = options.astraRoomBridge || null;
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const locks = new Set();

  const empty = () => ({
    version: VERSION,
    config: { paused: false, mode: 'astra_room', accountName: 'swan', updatedAt: now() },
    heartbeat: null,
    messages: [],
    orders: [],
    updatedAt: now()
  });

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      return {
        ...empty(),
        ...value,
        config: { ...empty().config, ...(value.config || {}) },
        messages: Array.isArray(value.messages) ? value.messages : [],
        orders: Array.isArray(value.orders) ? value.orders : []
      };
    } catch (_) {
      return empty();
    }
  }

  function write(value) {
    const safe = {
      ...empty(),
      ...value,
      messages: (Array.isArray(value.messages) ? value.messages : []).slice(0, 5000),
      orders: (Array.isArray(value.orders) ? value.orders : []).slice(0, 2000),
      updatedAt: now()
    };
    const temp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, dataFile);
    return safe;
  }

  function control(update) {
    const state = read();
    if (update && typeof update === 'object') {
      if (typeof update.paused === 'boolean') state.config.paused = update.paused;
      if (['astra_room', 'draft_only'].includes(String(update.mode || ''))) state.config.mode = String(update.mode);
      if (compact(update.accountName, 80)) state.config.accountName = compact(update.accountName, 80);
      state.config.updatedAt = now();
      write(state);
    }
    return clone(state.config);
  }

  function heartbeat(input = {}) {
    const state = read();
    state.heartbeat = {
      at: Number(input.at) || Date.now(),
      status: compact(input.status || '확인 중', 160),
      url: safeText(input.url, 1000),
      accountName: compact(input.accountName, 120) || null,
      stats: input.stats && typeof input.stats === 'object' ? clone(input.stats) : {}
    };
    write(state);
    return clone(state.heartbeat);
  }

  function roomResult(event, fallback) {
    if (!event || event.status !== 'completed') {
      return { ...fallback, autoSend: false, manualReview: true, pendingRoom: true, astraRoomEventId: event?.eventId || null, reason: 'Astra 고객대응실 답변 대기' };
    }
    const parsed = event.response || {};
    if (parsed.mode === 'NO_ACTION') {
      return { ...fallback, autoSend: false, manualReview: false, skip: true, pendingRoom: false, astraRoomEventId: event.eventId, reason: parsed.fields?.REASON || 'Astra 무조치 판정' };
    }
    if (parsed.mode !== 'CUSTOMER_REPLY' || parsed.decision !== 'SEND') {
      return { ...fallback, autoSend: false, manualReview: true, pendingRoom: false, astraRoomEventId: event.eventId, reason: parsed.fields?.MISSING || `Astra ${parsed.decision || parsed.mode || '보류'} 판정` };
    }
    const responseText = compact(parsed.reply, 4000);
    if (!validRoomReply(responseText, fallback)) {
      try { bridge.markDelivery(event.eventId, 'skipped', { reason: 'kmong_reply_validation_failed', at: now() }); } catch (_) {}
      return { ...fallback, autoSend: false, manualReview: true, pendingRoom: false, astraRoomEventId: event.eventId, reason: 'Astra 답변 사실·플랫폼 검증 실패' };
    }
    return { ...fallback, text: responseText, autoSend: true, manualReview: false, pendingRoom: false, astraRoomEventId: event.eventId, aiGenerated: true, aiRoute: 'Astra response room' };
  }

  function enqueueRoom(input, fallback) {
    const cfg = bridge?.config?.();
    if (!bridge || !cfg?.enabled || !cfg?.targetThreadId) return null;
    const chatId = compact(input.chatId || input.conversationId, 200);
    const messageId = compact(input.messageId, 200);
    const idempotencyKey = `kmong:${chatId}:${messageId}:${cfg.policyVersion || 'swan-astra-room-v1'}`;
    const queued = bridge.enqueue({
      eventType: 'customer_message',
      caseId: `kmong:${chatId}`,
      idempotencyKey,
      source: 'kmong_chat_bot',
      snapshotVersion: compact(input.snapshotVersion || messageId, 200),
      payload: {
        platform: 'Kmong',
        conversationId: `kmong:${chatId}`,
        chatId,
        messageId,
        conversationUrl: safeText(input.url || `https://kmong.com/inboxes?inbox_group_id=${encodeURIComponent(chatId)}`, 1000),
        customerMessage: safeText(input.message || input.text, 2500),
        conversationText: safeText(input.conversationText || input.history, 12000),
        serviceType: fallback.serviceType,
        serviceName: safeText(input.serviceName || input.productTitle, 300),
        deterministicReply: { text: safeText(fallback.text, 3000), templateKey: fallback.templateKey, autoSend: fallback.autoSend === true },
        replyPrompt: [
          '크몽 고객에게 보낼 답장을 판정한다.',
          '브랜드는 swan이며 판매 서비스는 자막 제작, 일반 문서·글 작성, 제공된 원고·보고서의 PPT 변환이다.',
          '고객 질문에 먼저 답하고, 필요한 질문은 한 번에 하나만 자연스럽게 묻는다.',
          '번호 선택형 메뉴, 내부 시스템명, 숨고 용어를 쓰지 않는다.',
          `서비스 분류: ${fallback.serviceType}`,
          `고객 메시지: ${safeText(input.message || input.text, 2500)}`,
          `최근 대화: ${safeText(input.conversationText || input.history, 8000)}`,
          `검증된 기본 답변: ${safeText(fallback.text, 2500) || '없음. 확인되지 않은 가격·납기·완료를 만들지 말 것.'}`
        ].join('\n')
      },
      evidence: [{ evidence_id: messageId, kind: 'message', observed_at: now(), ref: `kmong:${chatId}:${messageId}` }]
    });
    return roomResult(queued.event, fallback);
  }

  function reply(input = {}) {
    const chatId = compact(input.chatId || input.conversationId, 200);
    const message = compact(input.message || input.text, 4000);
    const messageId = compact(input.messageId, 200) || hash(`${chatId}|${message}`).slice(0, 24);
    if (!chatId) throw new Error('kmong_chat_id_required');
    if (!message) throw new Error('kmong_message_required');
    const key = `${chatId}:${messageId}`;
    if (locks.has(chatId)) return { busy: true, retryAfterMs: 3000 };
    locks.add(chatId);
    try {
      const state = read();
      const existing = state.messages.find(item => item.chatId === chatId && item.messageId === messageId);
      if (existing) {
        if (existing.reply?.pendingRoom && existing.reply?.astraRoomEventId && bridge) {
          const refreshed = roomResult(bridge.get(existing.reply.astraRoomEventId), existing.fallback || existing.reply);
          existing.reply = refreshed;
          existing.updatedAt = now();
          write(state);
          return { duplicate: refreshed.pendingRoom !== false, pendingRoom: refreshed.pendingRoom === true, reply: clone(refreshed), record: clone(existing) };
        }
        return { duplicate: true, uncertain: existing.replyEvidence?.status === 'uncertain', reply: clone(existing.reply), record: clone(existing) };
      }

      let fallback;
      if (isSystemMessage(message)) fallback = { autoSend: false, manualReview: false, skip: true, serviceType: classifyService(input), templateKey: 'system_message', text: '', reason: '크몽 시스템 알림' };
      else if (isClosedConversation(input)) fallback = { autoSend: false, manualReview: false, skip: true, serviceType: classifyService(input), templateKey: 'closed_conversation', text: '', reason: '종료 또는 다른 전문가 선택 상태' };
      else fallback = deterministicReply({ ...input, message });

      const room = !fallback.skip && state.config.mode === 'astra_room' ? enqueueRoom({ ...input, chatId, messageId, message }, fallback) : null;
      const prepared = room || { ...fallback, autoSend: state.config.mode === 'draft_only' ? false : fallback.autoSend };
      const record = {
        id: `KM-REPLY-${Date.now()}-${hash(key).slice(0, 8)}`,
        chatId,
        messageId,
        serviceType: fallback.serviceType,
        incoming: message,
        fallback: clone(fallback),
        reply: clone(prepared),
        sourceUrl: safeText(input.url, 1000),
        createdAt: now(),
        updatedAt: now()
      };
      state.messages.unshift(record);
      write(state);
      return { duplicate: false, pendingRoom: prepared.pendingRoom === true, reply: clone(prepared), record: clone(record) };
    } finally {
      locks.delete(chatId);
    }
  }

  function replyResult(input = {}) {
    const state = read();
    const chatId = compact(input.chatId || input.conversationId, 200);
    const messageId = compact(input.messageId, 200);
    const record = state.messages.find(item => item.chatId === chatId && item.messageId === messageId);
    if (!record) throw new Error('kmong_reply_not_found');
    const requested = String(input.status || '').toLowerCase();
    const status = requested === 'sent' ? 'sent' : requested === 'skipped' ? 'skipped' : 'uncertain';
    if (record.replyEvidence?.status === 'sent') return { duplicate: true, record: clone(record) };
    record.replyEvidence = { status, at: safeText(input.at || now(), 80), url: safeText(input.url, 1000), evidence: safeText(input.evidence, 1000) };
    record.updatedAt = now();
    if (record.reply?.astraRoomEventId && bridge) {
      try { bridge.markDelivery(record.reply.astraRoomEventId, status, record.replyEvidence); } catch (_) {}
    }
    write(state);
    return { duplicate: false, record: clone(record) };
  }

  function order(input = {}) {
    const orderId = compact(input.orderId || input.id, 200);
    if (!orderId) throw new Error('kmong_order_id_required');
    const state = read();
    let record = state.orders.find(item => item.orderId === orderId);
    const serviceType = classifyService(input);
    const paymentConfirmed = input.paymentConfirmed === true;
    const snapshot = {
      orderId,
      chatId: compact(input.chatId || input.conversationId, 200) || null,
      serviceType,
      serviceName: safeText(input.serviceName || input.productTitle, 300),
      customerName: safeText(input.customerName, 160),
      amount: Math.max(0, Number(input.amount || 0)),
      paymentConfirmed,
      paymentEvidence: paymentConfirmed ? clone(input.paymentEvidence || {}) : null,
      statusText: safeText(input.statusText, 500),
      requirements: safeText(input.requirements || input.description || input.conversationText, 16000),
      deadline: safeText(input.deadline, 200),
      sourceUrl: safeText(input.url, 1000),
      observedAt: safeText(input.observedAt || now(), 80)
    };
    if (record) {
      Object.assign(record, snapshot, { updatedAt: now() });
    } else {
      record = { id: `KM-ORDER-${hash(orderId).slice(0, 16)}`, ...snapshot, workflowId: null, createdAt: now(), updatedAt: now() };
      state.orders.unshift(record);
    }
    record.readyForFulfillment = paymentConfirmed && Boolean(serviceType) && Boolean(record.requirements);
    write(state);
    return { duplicate: Boolean(record.workflowId), order: clone(record), readyForFulfillment: record.readyForFulfillment };
  }

  function attachWorkflow(orderId, workflowId) {
    const state = read();
    const record = state.orders.find(item => item.orderId === String(orderId || ''));
    if (!record) throw new Error('kmong_order_not_found');
    if (record.workflowId) return { duplicate: true, order: clone(record) };
    record.workflowId = compact(workflowId, 200);
    record.workflowCreatedAt = now();
    record.updatedAt = now();
    write(state);
    return { duplicate: false, order: clone(record) };
  }

  function status() {
    const state = read();
    const ageMs = state.heartbeat?.at ? Math.max(0, Date.now() - Number(state.heartbeat.at)) : null;
    return {
      config: clone(state.config),
      heartbeat: state.heartbeat ? { ...clone(state.heartbeat), ageMs, healthy: Number.isFinite(ageMs) && ageMs < 90000 } : null,
      counts: {
        messages: state.messages.length,
        pendingRoom: state.messages.filter(item => item.reply?.pendingRoom).length,
        sent: state.messages.filter(item => item.replyEvidence?.status === 'sent').length,
        uncertain: state.messages.filter(item => item.replyEvidence?.status === 'uncertain').length,
        orders: state.orders.length,
        readyOrders: state.orders.filter(item => item.readyForFulfillment && !item.workflowId).length,
        workflows: state.orders.filter(item => item.workflowId).length
      },
      recentMessages: clone(state.messages.slice(0, 20)),
      recentOrders: clone(state.orders.slice(0, 20)),
      dataFile
    };
  }

  return { classifyService, deterministicReply, isSystemMessage, isClosedConversation, control, heartbeat, reply, replyResult, order, attachWorkflow, status, read };
}

module.exports = { createKmongAutomation, classifyService, deterministicReply, isSystemMessage, isClosedConversation, validRoomReply };
