'use strict';

// Astra 운영 기준(docs/astra-brief.md, 생성물) 검사 — 2026-09-23 개발방 지시 9.
// 1) 파일의 금액·기간·수정 횟수가 지금 서버 견적 함수 계산값과 같은지(다르면 services/*.json이 바뀐 것 → 다시 만들 것)
// 2) 판매 안 함 목록에 자소서·이력서·문서 번역이 있는지  3) 고객 안내용 줄에 "할인"이 없는지
// 외부 호출·유료 API 없음. 파일을 쓰지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const root = path.join(__dirname, '..');
const brief = require(path.join(root, 'scripts', 'build-astra-brief.cjs'));
const REBUILD = ' → node scripts/build-astra-brief.cjs 로 다시 만들 것';

const md = fs.readFileSync(brief.OUT, 'utf8');
assert.ok(/이 파일은 생성물 — 직접 고치지 말 것/.test(md), '생성물 표시');
for (const id of ['subtitle', 'document_writing', 'presentation', 'translation_en']) {
  assert.ok(new RegExp(`services/${id}\\.json · quoteMessageVersion \\S+ · 수정 [0-9-]+ [0-9:]+ KST · sha256 [0-9a-f]{12}`).test(md), `머리 줄: ${id}`);
}

// 1) 계산값 대조
const block = md.match(/## 대조용 값 \(시험이 읽음\)\s*```json\s*([\s\S]*?)```/);
assert.ok(block, '대조용 값 블록');
const written = JSON.parse(block[1]);
const fns = brief.loadQuoteFunctions();
let now;
try { now = brief.computeCases(fns); } finally { fns.restore(); }
assert.equal(written.length, brief.CASES.length, '대표 요청 수' + REBUILD);
assert.ok(written.length >= 12, '대표 요청 12건 이상');
for (const c of now) {
  const w = written.find(x => x.id === c.id);
  assert.ok(w, `대조값 없음: ${c.id}` + REBUILD);
  assert.equal(w.amount, c.amount, `${c.id} 금액: 파일 ${w.amount} / 계산 ${c.amount}` + REBUILD);
  assert.equal(w.days, c.days, `${c.id} 작업 기간` + REBUILD);
  assert.equal(w.revisions, c.revisions, `${c.id} 수정 횟수` + REBUILD);
  assert.ok(c.amount >= 15000, `${c.id} 금액이 0이거나 최소 금액 밑`);
  // 사람이 읽는 표도 같은 숫자
  assert.ok(md.includes(`| ${c.label} | ${c.amount.toLocaleString('ko-KR')}원 | ${c.days} | ${c.revisions}회 |`), `표 줄: ${c.label}` + REBUILD);
}

// 2) 판매 안 함
const notSold = (md.split('\n## 판매 안 함')[1] || '').split('\n## ')[0];
assert.ok(/자소서·이력서/.test(notSold), '판매 안 함: 자소서·이력서');
assert.ok(/판매 안 함\(문서 번역\)/.test(notSold), '판매 안 함: 문서 번역');
assert.ok(!/영어 번역/.test(md), 'translation_en은 "판매 안 함(문서 번역)"으로만');
assert.deepEqual(md.split('\n').filter(line => /translation_en/.test(line)).map(line => /^> - services\/translation_en\.json /.test(line)), [true], 'translation_en은 머리 줄에만(가격 없음)');
assert.ok(!/기본가|할인가|이력서·자기소개서 대필/.test(md), '옛 기준 문구 없음');

// 3) 고객 안내용 줄에 "할인" 없음
const customerBlocks = md.split('\n### ').filter(part => /^[^\n]*\(고객 안내용\)|^[^\n]*고객 안내용\)/.test(part)).map(part => part.split('\n## ')[0]);
assert.ok(customerBlocks.length >= 4, '고객 안내용 칸(자막·파이버·문서·PPT)');
for (const part of customerBlocks) assert.ok(!/할인/.test(part), `고객 안내용 줄에 "할인": ${part.split('\n')[0]}`);

assert.equal(netCalls, 0, '외부 호출 없음');
console.log('astra-brief: PASS');
process.exit(0);
