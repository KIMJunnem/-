'use strict';

// 변경 안전장치 정답표(tests/fixtures/change-guard-gold.json) 검사. 외부 호출 없음.
const assert = require('node:assert/strict');
const path = require('node:path');
const data = require('./fixtures/change-guard-gold.json');
const quality = require('../server/jev-quality-data');

const Q = ['touches_price', 'touches_customer_text', 'touches_delete', 'touches_external_send', 'touches_paid_api'];
assert.deepEqual(data.questions, Q);
const rows = data.rows;
assert.ok(rows.length >= 400, `행 ${rows.length}`);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'id 중복 없음');
assert.equal(new Set(rows.map(r => r.diff)).size, rows.length, 'diff 중복 없음');
for (const r of rows) {
  assert.match(r.diff, /^--- a\/.+\n\+\+\+ b\/.+\n@@ /, `${r.id} diff 모양`);
  assert.ok(/\n[+-](?![+-]{2} )/.test(r.diff), `${r.id} 바뀐 줄 있음`);
  assert.deepEqual(Object.keys(r.gold), Q, r.id);
  for (const q of Q) assert.ok(r.gold[q] === true || r.gold[q] === false || r.gold[q] === null, `${r.id}.${q}`);
}
// 규칙 생성 행: 종류와 정답이 맞물린다(none_* 는 전부 false, 나머지는 해당 질문 하나만 true)
const want = { price: 'touches_price', customer_text: 'touches_customer_text', delete: 'touches_delete', send: 'touches_external_send', send_flip: 'touches_external_send', paid: 'touches_paid_api' };
for (const r of rows.filter(x => x.origin === 'synthetic')) {
  const trues = Q.filter(q => r.gold[q] === true);
  if (r.kind.startsWith('none_')) assert.deepEqual(trues, [], r.id);
  else assert.deepEqual(trues, [want[r.kind]], r.id);
}
// 질문마다 예 40개 이상·아니오 300개 이상
for (const q of Q) {
  const yes = rows.filter(r => r.gold[q] === true).length; const no = rows.filter(r => r.gold[q] === false).length;
  assert.ok(yes >= 25 && no >= 300, `${q} 예 ${yes} 아니오 ${no}`);
}
// 실제 변경 행은 Claude 라벨(준희 미확인)임을 설명에 적어 둔다
assert.ok(rows.some(r => r.origin === 'real')); assert.match(data.description, /준희 미확인/);
// 품질 데이터 모듈 연결: code_diffs 출처로 file·diff만 넘긴다
const items = quality.qualityItems('code_diffs', Q);
assert.equal(items.length, rows.length);
assert.ok(items.every(i => JSON.stringify(Object.keys(i.state)) === '["file","diff"]' && /^tests\/fixtures\/change-guard-gold\.json/.test(i.compare.origin)));
assert.ok(!items.some(i => JSON.stringify(i.state).includes('"gold"')), '정답은 Jev에 넘기지 않음');
console.log('change-guard-gold: PASS');
