'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSoomgoQuote, requestedWorkflowFormats } = require('../server/relay-server.js');

const baselinePath = path.join(__dirname, 'fixtures', 'service-regression-baseline.json');
const serverPath = path.join(__dirname, '..', 'server', 'relay-server.js');

const samples = [
  { caseId: 'subtitle-basic-5m', service: 'subtitle', input: { purpose: '자막 제작', volume: '5분', topic: '한국어 인터뷰 SRT 자막', format: 'SRT' } },
  { caseId: 'subtitle-basic-10m', service: 'subtitle', input: { purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' } },
  { caseId: 'subtitle-long-30m', service: 'subtitle', input: { purpose: '자막 제작', volume: '30분', topic: '한국어 발표 영상 자막', format: 'SRT' } },
  { caseId: 'subtitle-long-35m', service: 'subtitle', input: { purpose: '자막 제작', volume: '35분', topic: '한국어 인터뷰 발화 타이밍 자막', format: 'SRT' } },
  { caseId: 'subtitle-urgent-5m', service: 'subtitle', input: { purpose: '자막 제작', volume: '5분', topic: '한국어 영상 SRT 자막', deadline: '오늘 급하게' } },

  { caseId: 'document-basic-1500', service: 'document_writing', input: { purpose: '문서 / 글 작성', volume: '1,500자', topic: '회사 안내문 작성' } },
  { caseId: 'document-one-page', service: 'document_writing', input: { purpose: '일반 문서 작성', volume: 'A4 1쪽', topic: '서비스 소개문 정리' } },
  { caseId: 'document-three-pages', service: 'document_writing', input: { purpose: '문서 / 글 작성', volume: 'A4 3쪽', topic: '행사 결과 정리 문서' } },
  { caseId: 'document-expanded', service: 'document_writing', input: { purpose: '문서 / 글 작성', volume: 'A4 3쪽', topic: '1. 현황\n2. 문제점\n3. 개선안' } },
  { caseId: 'document-urgent', service: 'document_writing', input: { purpose: '문서 / 글 작성', volume: 'A4 1쪽', topic: '업무 안내문', deadline: '오늘' } },

  { caseId: 'presentation-3-slides', service: 'presentation', input: { purpose: 'PPT 제작', volume: '3장', topic: '제공 원고를 발표자료로 변환', format: 'PPTX' } },
  { caseId: 'presentation-7-slides', service: 'presentation', input: { purpose: 'PPT 제작', volume: '7장', topic: '제공 보고서를 발표자료로 변환', format: 'PPTX' } },
  { caseId: 'presentation-10-slides', service: 'presentation', input: { purpose: 'PPT 제작', volume: '10장', topic: '제공 원고를 발표자료로 변환', format: 'PPTX' } },
  { caseId: 'presentation-13-slides', service: 'presentation', input: { purpose: '프레젠테이션 제작', volume: '13장', topic: '보고서 내용을 슬라이드로 변환', format: 'PPTX' } },
  { caseId: 'presentation-urgent-7-slides', service: 'presentation', input: { purpose: 'PPT 제작', volume: '7장', topic: '제공 원고를 발표자료로 변환', format: 'PPTX', deadline: '오늘 급하게' } }
];

// This mirrors the currently deployed route's quotedServiceId expression at
// server/relay-server.js:6929-6930. It intentionally records PPT as
// document_writing because that is the current observable result.
function currentClassificationId(quote) {
  if (/자막/i.test(String(quote.label || ''))) return 'subtitle';
  if (/문서|글|보고서|제안서|PPT|파워포인트|카피/i.test(String(quote.label || ''))) return 'document_writing';
  return '';
}

function currentOutputs() {
  return samples.map(sample => {
    const { quote } = buildSoomgoQuote(sample.input);
    return {
      caseId: sample.caseId,
      service: sample.service,
      input: sample.input,
      output: {
        classificationId: currentClassificationId(quote),
        label: quote.label,
        amount: quote.amount,
        leadDays: quote.days,
        quoteText: quote.message,
        deliverFormats: requestedWorkflowFormats(sample.input).map(format => format.extension)
      }
    };
  });
}

const payload = {
  schemaVersion: 2,
  purpose: '0단계 현재 동작 회귀 기준: 자막·일반 문서·PPT 각 5건',
  source: {
    entrypoint: 'server/relay-server.js#buildSoomgoQuote',
    classificationRule: 'server/relay-server.js:6929-6930',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(serverPath)).digest('hex')
  },
  cases: currentOutputs()
};

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${payload.cases.length} baseline cases to ${baselinePath}`);
} else {
  const expected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.deepEqual(payload.cases, expected.cases);
  assert.equal(expected.cases.length, 15);
  for (const service of ['subtitle', 'document_writing', 'presentation']) {
    assert.equal(expected.cases.filter(item => item.service === service).length, 5);
  }
  console.log('Service regression baseline passed: 15/15 identical.');
}
