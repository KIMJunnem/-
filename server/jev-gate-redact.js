'use strict';

// 지시 31: 제브에 보내는 고객 채팅 한 통에서 고객 이름·연락처·회사명·링크를 가린다.
function redact(message, body = {}) {
  let text = String(message || '').slice(0, 1000);
  const names = [body.customerName, body.name, body.request?.customerName, body.request?.name, body.quote?.customerName, body.request?.company, body.company]
    .map(value => String(value || '').trim()).filter(value => value.length >= 2);
  for (const name of names) text = text.split(name).join('[이름]');
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일]')
    .replace(/(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]')
    .replace(/https?:\/\/\S+/g, '[링크]')
    .replace(/[가-힣A-Za-z0-9]+(?:주식회사|\(주\)|㈜)|(?:주식회사|\(주\)|㈜)\s*[가-힣A-Za-z0-9]+/g, '[회사]')
    .trim();
}

module.exports = { redact };
