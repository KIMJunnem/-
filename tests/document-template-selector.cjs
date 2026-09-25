'use strict';

const assert = require('assert');
const fs = require('fs');
const selector = require('../server/document-template-selector');

const backup = fs.existsSync(selector.USAGE) ? fs.readFileSync(selector.USAGE) : null;
try {
  fs.writeFileSync(selector.USAGE, JSON.stringify({ counts: {}, lastGlobal: null, lastByCustomer: {}, events: [] }));
  const first = selector.selectDocumentTemplate({ customerId: 'customer-a', topic: '블로그 원고 작성' });
  const second = selector.selectDocumentTemplate({ customerId: 'customer-a', topic: '블로그 원고 작성' });
  const report = selector.selectDocumentTemplate({ customerId: 'customer-b', topic: '현황 분석 보고서' });
  assert(first && second && report, '템플릿이 선택되어야 합니다.');
  assert.strictEqual(first.category, '원고');
  assert.strictEqual(second.category, '원고');
  assert.strictEqual(first.id, second.id, '일반 운영에서는 비교 가능한 고정 템플릿을 사용해야 합니다.');
  assert.strictEqual(first.selectionMode, 'fixed-by-category');
  const experimentFirst = selector.selectDocumentTemplate({ customerId: 'experiment-a', topic: '블로그 원고 작성', experiment: true });
  const experimentSecond = selector.selectDocumentTemplate({ customerId: 'experiment-a', topic: '블로그 원고 작성', experiment: true });
  assert.notStrictEqual(experimentFirst.id, experimentSecond.id, '명시적 실험에서는 연속 중복을 피해야 합니다.');
  assert.strictEqual(experimentFirst.selectionMode, 'controlled-experiment');
  assert.strictEqual(report.category, '보고서');
  assert(fs.existsSync(first.path), '선택한 템플릿 파일이 존재해야 합니다.');
  console.log('Document template fixed mapping and controlled rotation checks passed.');
} finally {
  if (backup) fs.writeFileSync(selector.USAGE, backup); else if (fs.existsSync(selector.USAGE)) fs.unlinkSync(selector.USAGE);
}
