'use strict';

const fs = require('node:fs');
const path = require('node:path');
const serviceRegistry = require('./service-registry');

const commonPath = path.join(__dirname, '..', 'services', '_common', 'messages.json');
const commonDefinitions = JSON.parse(fs.readFileSync(commonPath, 'utf8')).messages || [];
const commonById = new Map(commonDefinitions.map(message => [message.id, Object.freeze({ ...message })]));

function serviceMessages(serviceId) {
  return Array.isArray(serviceRegistry.getService(serviceId)?.followupMessages)
    ? serviceRegistry.getService(serviceId).followupMessages
    : [];
}

function getMessage(id, serviceId = null) {
  const key = String(id || '');
  const message = commonById.get(key)
    || serviceMessages(serviceId).find(item => item.id === key)
    || serviceRegistry.listServices().flatMap(service => service.followupMessages || []).find(item => item.id === key);
  return message && message.active !== false ? { ...message } : null;
}

function renderMessage(message, values = {}) {
  return String(message?.text || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

function hash(value) {
  let output = 2166136261;
  for (const character of String(value || '')) {
    output ^= character.charCodeAt(0);
    output = Math.imul(output, 16777619);
  }
  return (output >>> 0).toString(16);
}

function selectFollowup({ serviceId, rawText = '', topic = '', eventId = '', sampleAmount = 0 } = {}) {
  const source = `${rawText} ${topic}`;
  const variantB = Number.parseInt(hash(String(eventId || `${serviceId}|${topic}`)), 16) % 2 === 1;
  let question;
  if (serviceId === 'presentation') {
    question = serviceMessages(serviceId).find(item => item.id === 'presentation.followup.v1');
  } else {
    question = serviceMessages(serviceId).find(item => item.id.endsWith(variantB ? 'material_status_b.v1' : 'material_status_a.v1'))
      || getMessage(variantB ? 'common.material_status_b.v1' : 'common.material_status_a.v1');
  }

  const notice = getMessage('common.first_notice.v1');
  const sample = Number(sampleAmount) > 0 ? getMessage('common.sample_offer.v1') : null;
  const school = /(학교|과제|레포트|리포트|수업|강의)/i.test(source) ? getMessage('common.school_notice.v1') : null;
  const label = serviceRegistry.getService(serviceId)?.label || '요청하신 작업';
  const context = topic ? `${label}(${topic})` : label;
  const sampleText = sample ? renderMessage(sample, { sampleAmountFormatted: Number(sampleAmount).toLocaleString('ko-KR') }) : '';
  const schoolText = school ? renderMessage(school) : '';
  const text = `${renderMessage(notice)}\n안녕하세요! ${context} 문의 확인했습니다. ${sampleText}${schoolText ? `${schoolText} ` : ''}${renderMessage(question)}`;
  return {
    messageId: question?.id || notice.id,
    version: question?.version || notice.version,
    serviceId: serviceId || null,
    componentMessageIds: [notice, sample, school, question].filter(Boolean).map(item => item.id),
    followupMessage: text
  };
}

module.exports = { getMessage, renderMessage, selectFollowup };
