'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serviceDir = path.join(root, 'services');
const baselinePath = path.join(__dirname, 'fixtures', 'service-regression-baseline.json');
const reportPath = path.join(__dirname, 'fixtures', 'service-definition-comparison.json');

const definitions = fs.readdirSync(serviceDir)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => JSON.parse(fs.readFileSync(path.join(serviceDir, name), 'utf8')));

function regex(pattern) {
  return new RegExp(pattern, 'i');
}

function candidatesFor(text) {
  const source = String(text || '');
  return definitions.filter(definition => {
    const matches = definition.matchKeywords.some(pattern => regex(pattern).test(source));
    const excluded = definition.excludeKeywords.some(pattern => regex(pattern).test(source));
    return matches && !excluded;
  });
}

function classify(text) {
  const candidates = candidatesFor(text);
  if (!candidates.length) return { id: 'unknown', candidates: [], usedPriority: false };
  if (candidates.length === 1) return { id: candidates[0].id, candidates: [candidates[0].id], usedPriority: false };
  const ordered = [...candidates].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  return { id: ordered[0].id, candidates: ordered.map(item => item.id), usedPriority: true };
}

function parse(input) {
  const text = [input.purpose, input.format, input.volume, input.scope, input.notes, input.topic, input.deadline].filter(Boolean).join(' ');
  const pageMatch = `${input.volume || ''} ${input.text || ''}`.match(/(?:A4\s*(?:기준)?\s*)?(\d+)\s*(?:페이지|장|쪽)|A4\s*(?:기준)?\s*(\d+)/i);
  const pages = Math.max(1, Math.min(200, Number(input.pages || pageMatch?.[1] || pageMatch?.[2] || 1)));
  const numbered = (String(input.topic || '').match(/(?:^|\n)\s*(?:\d+\.|[①-⑳]|[-•])\s+/g) || []).length;
  const subtopics = Math.max(Number(input.subtopics || 0), numbered, (String(input.topic || '').match(/[,·]/g) || []).length >= 3 ? 2 : 0);
  return { text, pages, subtopics, isSubmission: subtopics >= 4 };
}

function leadDays(definition, parsed) {
  for (const rule of definition.leadDaysRules) {
    if (rule.default) return rule.value;
    if (rule.when?.pagesGte != null && parsed.pages >= rule.when.pagesGte) return rule.value;
    if (rule.when?.isSubmission === true && parsed.isSubmission) return rule.value;
  }
  return '';
}

function packagePrice(definition, parsed) {
  if (!definition.pricing) return null;
  if (definition.id === 'subtitle') {
    const minutes = Math.max(1, Number(parsed.text.match(/(\d+(?:\.\d+)?)\s*분/i)?.[1] || 5));
    const selected = definition.pricing.packages.find(item =>
      (item.when.minutesLte != null && minutes <= item.when.minutesLte)
      || (item.when.minutesGt != null && minutes > item.when.minutesGt));
    const extraUnits = selected?.unit ? Math.max(0, Math.ceil((minutes - 30) / selected.unit.sizeMinutes)) : 0;
    const translation = /번역|영어|불어|프랑스어|일본어|중국어/.test(parsed.text)
      && !/번역\s*(?:제외|불필요)|번역은\s*필요\s*없/.test(parsed.text);
    const burnIn = /자막\s*(?:삽입|입히기)|영상\s*(?:삽입|번인)|burn[ -]?in/i.test(parsed.text)
      && !/(?:영상\s*)?삽입\s*(?:제외|불필요)/.test(parsed.text);
    const fiveMinuteUnits = Math.max(1, Math.ceil(minutes / 5));
    const addOn = (translation ? fiveMinuteUnits * 20000 : 0) + (burnIn ? fiveMinuteUnits * 15000 : 0);
    return { minutes, regularAmount: selected.regularAmount + extraUnits * Number(selected.unit?.regularAmount || 0) + addOn, amount: selected.saleAmount + extraUnits * Number(selected.unit?.saleAmount || 0) + addOn };
  }
  if (definition.id === 'presentation') {
    const selected = definition.pricing.packages.find(item =>
      (item.when.pagesLte != null && parsed.pages <= item.when.pagesLte)
      || (item.when.pagesGt != null && parsed.pages > item.when.pagesGt));
    const extraUnits = selected?.unit ? Math.max(0, Math.ceil((parsed.pages - 7) / selected.unit.sizePages)) : 0;
    return { regularAmount: selected.regularAmount + extraUnits * Number(selected.unit?.regularAmount || 0), amount: selected.saleAmount + extraUnits * Number(selected.unit?.saleAmount || 0) };
  }
  const selected = definition.pricing.packages.find(item => item.when.default);
  return { regularAmount: selected.regularAmount, amount: selected.saleAmount };
}

function naturalScope(scope) {
  // 서버와 같이 합니다체 유지(2026-09-21): '입니다'를 '이에요'로 바꾸지 않는다.
  return scope.replace(/^기본 포함 범위:\s*/, '');
}

function render(template, values) {
  return String(template).replace(/{{(\w+)}}/g, (_, key) => String(values[key] ?? ''));
}

function definitionOutput(input) {
  const parsed = parse(input);
  const classification = classify(parsed.text);
  const definition = definitions.find(item => item.id === classification.id);
  if (!definition || !definition.pricing) return { classificationId: classification.id, label: definition?.label || '', amount: null, leadDays: definition ? leadDays(definition, parsed) : '', quoteText: '' };
  // 문서 계열은 작업 유형별 가격표(services/document_writing.json pricing.workTypes)를 쓴다.
  if (definition.id === 'document_writing' && definition.pricing?.workTypes) {
    const priced = require('../server/pricing-table').documentQuote({ purpose: input.purpose, topic: input.topic, scope: input.scope, notes: input.notes, volume: input.volume, pages: parsed.pages });
    return {
      classificationId: definition.id, label: priced.label, amount: priced.amount, leadDays: priced.days, quoteText: priced.message,
      deliverFormats: [...(definition.deliverFormats || [])]
    };
  }
  const price = packagePrice(definition, parsed);
  const tier = parsed.subtopics >= 4 ? '제출형' : parsed.subtopics >= 2 ? '확장형' : '기본형';
  const revisionCount = tier === '기본형' ? 1 : 2;
  let scope;
  const minutes = price.minutes || 5;
  if (definition.id === 'subtitle') scope = render(definition.scope, { minutes });
  else if (definition.id === 'presentation') scope = render(definition.scope, { pages: parsed.pages });
  else {
    const explicitPage = /(페이지|쪽|장)/i.test(String(input.volume || '')) || parsed.pages > 1;
    const scopeRule = definition.scopeRules?.find(rule => rule.when?.hasPageScope === true && explicitPage)
      || definition.scopeRules?.find(rule => rule.default)
      || { value: definition.scope };
    scope = render(scopeRule.value, { label: definition.label, pages: parsed.pages, revisionCount });
  }
  return {
    classificationId: definition.id,
    label: definition.label,
    amount: price.amount,
    leadDays: leadDays(definition, { ...parsed, isSubmission: tier === '제출형' }),
    quoteText: render(definition.quoteText, { amountFormatted: Number(price.amount).toLocaleString('ko-KR'), naturalScope: naturalScope(scope) }),
    deliverFormats: [
      ...(definition.deliverFormats || []),
      ...((definition.conditionalFormats || []).flatMap(rule => rule.when?.option === 'burnIn'
        && /자막\s*(?:삽입|입히기)|영상\s*(?:삽입|번인)|burn[ -]?in/i.test(parsed.text)
        && !/(?:영상\s*)?삽입\s*(?:제외|불필요)/.test(parsed.text) ? (rule.add || []) : []))
    ]
  };
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const comparisons = baseline.cases.map(item => {
  const actual = definitionOutput(item.input);
  const differences = Object.keys(item.output).filter(key => JSON.stringify(item.output[key]) !== JSON.stringify(actual[key])).map(key => ({ field: key, before: item.output[key], after: actual[key] }));
  const accepted = differences.length > 0 && differences.every(change =>
    (item.service === 'presentation' && change.field === 'classificationId' && change.before === 'document_writing' && change.after === 'presentation')
    || (item.caseId === 'document-one-page' && ['amount', 'quoteText'].includes(change.field))
    // 2026-09-21 자막 견적 문구 v3: 납기·확인 질문은 서버가 채운다(전체 문구 회귀는 service-regression-baseline이 검사).
    || (item.service === 'subtitle' && change.field === 'quoteText')
    // 2026-09-22 PPT 기본 수정 2회: 수정 횟수는 서버가 서비스 정의(includedRevisions)에서 채운다.
    || (item.service === 'presentation' && change.field === 'quoteText'));
  return { caseId: item.caseId, service: item.service, status: differences.length ? (accepted ? 'accepted_design_change' : 'unexpected_difference') : 'identical', differences };
});

const classificationInputs = ['영어 자막', 'PPT 보고서 변환', '영어 문서 번역', '일반 문서 작성', '문서 / 글 작성', '발표자료 원고 정리', '영상 자막 번역'];
const classificationChecks = classificationInputs.map(input => ({ input, ...classify(input) }));
const report = {
  schemaVersion: 1,
  definitions: definitions.map(item => item.id),
  baselineComparison: comparisons,
  classificationChecks,
  priorityIndependent: classificationChecks.every(item => !item.usedPriority)
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
assert.equal(comparisons.filter(item => item.status === 'unexpected_difference').length, 0);
assert.equal(report.priorityIndependent, true);
console.log(JSON.stringify(report, null, 2));
