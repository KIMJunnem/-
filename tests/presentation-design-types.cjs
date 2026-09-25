'use strict';

// PPT 디자인 유형 규칙: 대비 기준, 유형 고르기, 운영 코드 미연결.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const design = require('../server/presentation-design');
const root = path.join(__dirname, '..');
const data = design.loadDesignTypes();

assert.equal(data.connected, false);
assert.equal(data.types.length, 6);
const ids = data.types.map(t => t.type_id);
for (const rule of data.selection.rules) assert.ok(ids.includes(rule.type_id), rule.type_id);
assert.ok(ids.includes(data.selection.default));

// 대비: 글자 4.5:1, 막대·띠 3:1, 표지 색면 위 흰 글자 4.5:1
for (const t of data.types) {
  const p = t.palette;
  for (const key of ['text', 'mutedText', 'accentText']) assert.ok(design.contrast(p[key], p.background) >= 4.5, `${t.type_id}.${key} ${design.contrast(p[key], p.background).toFixed(2)}`);
  assert.ok(design.contrast(p.accentFill, p.background) >= 3, `${t.type_id}.accentFill`);
  assert.ok(design.contrast('#FFFFFF', p.primary) >= 4.5, `${t.type_id} 표지 흰 글자`);
  assert.ok(t.fonts.title.startsWith('Pretendard') && /OFL/.test(t.fonts.license), `${t.type_id} 글꼴`);
  assert.ok(t.type_scale.body_pt >= 16 && t.type_scale.min_pt >= 12);
}
// 신호 목록에 메모 문장이 섞이지 않음
for (const rule of data.selection.rules) for (const k of rule.keywords) assert.ok(k.length <= 12 && !/[()]/.test(k), `신호어 형식: ${k}`);

// 유형 고르기
const pick = text => design.selectDesignType(text, data).typeId;
assert.equal(pick('조달청 입찰 제안서 PPT 20장 부탁드립니다'), 'proposal', '제안이 공공보다 위');
assert.equal(pick('통계청 연구 용역 결과를 기관장님께 드릴 자료입니다'), 'public_report');
assert.equal(pick('한국콘텐츠진흥원 사업 결과 PPT'), 'public_report');
assert.equal(pick('3분기 실적을 대표님께 드릴 자료예요'), 'corporate_internal');
assert.equal(pick('주간 보고 자료 정리 부탁드려요'), 'corporate_internal', '보고만으로 공공형 안 됨');
assert.equal(pick('직원 교육용 강의 자료 30장'), 'lecture_seminar');
assert.equal(pick('교수님께 낼 조별 과제 발표 자료'), 'academic_student');
assert.equal(pick('카페 매장 브로슈어처럼 업체 소개 자료'), 'small_business');
assert.equal(pick('워드 파일을 PPT로 바꿔 주세요. 10만원 이하로 신청합니다'), 'corporate_internal', '신청·만원은 공공 신호 아님');
assert.equal(design.selectDesignType('아무 정보 없음', data).fallback, true);
assert.equal(design.selectDesignType('회사 양식에 맞춰 주세요 실적 보고', data).customerTemplate, true);
const academic = data.types.find(t => t.type_id === 'academic_student');
assert.equal(academic.intake_policy.withoutManuscript, 'quote_with_materials');

// 운영 코드 미연결: 이 모듈을 부르는 서버·봇 코드가 없다
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', 'data', 'storage'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
const code = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'soomgo-bot-extension')), ...walk(path.join(root, 'soomgo-chat-bot'))].filter(f => /\.(js|cjs)$/.test(f) && !f.endsWith('presentation-design.js'));
// 2026-09-22: 서버는 PPT 샘플 유형 고르기에만 쓴다(relay-server.js의 pptDesignSampleReply). 봇 코드는 여전히 부르지 않는다.
for (const file of code) {
  const src = fs.readFileSync(file, 'utf8');
  // 2026-09-23 준희 결정(PPT Codex 대화방 제작): 서버 관리자 경로 /api/admin/codex-production/request에서 유형 고르기 1곳 추가, 제작 모듈 codex-production.js가 템플릿을 부른다.
  if (file.endsWith(path.join('server', 'relay-server.js'))) { assert.equal((src.match(/presentationDesign\./g) || []).length, 2, '서버는 샘플 고르기 + Codex 제작 요청 두 곳에서만 사용'); continue; }
  if (file.endsWith(path.join('server', 'codex-production.js')) || file.endsWith(path.join('server', 'pptx-embed-fonts.js'))) continue; // 제작 모듈·글꼴 넣기(지시 5)
  assert.ok(!/presentation-design/.test(src), `연결 없음: ${path.relative(root, file)}`);
}
// 서비스 목록에 끼어들지 않음(하위 폴더라 레지스트리가 읽지 않음)
const registry = require('../server/service-registry');
assert.ok(!registry.listServices({ channel: 'soomgo' }).some(s => /design/.test(s.id)));
// 품질 규칙(페이블 v1)과 시안 내용: 제목 25자·불릿 5개 상한, 목차 = 구분 슬라이드 제목, 요약은 맺음 바로 앞
const rules = JSON.parse(fs.readFileSync(path.join(root, 'services', 'presentation-design', 'quality-rules.json'), 'utf8'));
assert.equal(rules.meta.version, 'v1-20260922');
assert.deepEqual(rules.meta.resolvedDecisions.map(d => d.id), ['D1', 'D2', 'D3'], '준희 결정 기록');
assert.deepEqual(rules.deck_structure.optional.summary_first.types, ['corporate_internal']);
for (const name of ['sample-public-report.json', 'sample-corporate-internal.json']) {
  const deck = JSON.parse(fs.readFileSync(path.join(root, 'services', 'presentation-design', 'templates', name), 'utf8'));
  const types = deck.slides.map(s => s.type);
  assert.equal(types[0], 'cover'); assert.equal(types.at(-1), 'closing'); assert.equal(types.at(-2), 'summary', `${name} 요약 위치`);
  const extraSummary = types.indexOf('summary') !== types.length - 2;
  if (extraSummary) assert.ok(types[1] === 'summary' && types.filter(t => t === 'summary').length === 2 && name.includes('corporate'), `${name} 앞 요약은 기업형만(D2)`);
  const agenda = deck.slides.find(s => s.type === 'agenda').items;
  assert.deepEqual(deck.slides.filter(s => s.type === 'section').map(s => s.title), agenda, `${name} 목차=구분`);
  for (const s of deck.slides) {
    const h = s.headline || s.title || '';
    assert.ok(h.length <= rules.typography.text_limits.title_max_chars_ko, `${name} 제목 길이: ${h}`);
    if (s.chapter) assert.ok(agenda.includes(s.chapter), `${name} 장 이름: ${s.chapter}`);
    for (const list of [s.bullets, s.left?.bullets, s.right?.bullets].filter(Boolean)) assert.ok(list.length <= rules.typography.text_limits.bullets_max);
  }
  assert.ok(!/!|\.\.\./.test(JSON.stringify(deck)), `${name} 느낌표·마침표 세 개 없음`);
}
console.log('presentation-design-types: PASS');
