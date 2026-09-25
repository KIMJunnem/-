'use strict';

const fs = require('node:fs');
const path = require('node:path');
const registry = require('../server/service-registry');
const { buildSoomgoQuote, requestedWorkflowFormats, buildIntakeForm } = require('../server/relay-server');
const { deterministicReply } = require('../server/kmong-automation');
const { runChecks } = require('../server/quality-runner');

const definition = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services-test', 'translation_en.json'), 'utf8'));
const text = '영어 문서 번역 1,500자 업무용 문체';
const directCandidate = (definition.matchKeywords || []).some(pattern => new RegExp(pattern, 'i').test(text))
  && !(definition.excludeKeywords || []).some(pattern => new RegExp(pattern, 'i').test(text));

const quote = buildSoomgoQuote({ purpose: '영어 번역', volume: '1,500자', topic: '업무 문서 영한 번역', format: 'DOCX' }).quote;
const intake = buildIntakeForm({ purpose: '영어 번역', volume: '1,500자', topic: '업무 문서 영한 번역', format: 'DOCX' }, { serviceId: 'translation_en', label: '영어 번역' }, { greeting: false, disclosure: false });
let formats = [], formatError = null;
try { formats = requestedWorkflowFormats({ serviceId: 'translation_en', purpose: '영어 번역' }).map(item => item.extension); }
catch (error) { formatError = { code: error.code || null, message: error.message }; }
const report = {
  testDefinition: {
    classification: directCandidate ? definition.id : null,
    channels: definition.channels,
    price: definition.pricing?.packages?.[0]?.saleAmount ?? definition.pricing?.base ?? null,
    intakeQuestions: definition.intakeQuestions,
    deliverFormats: definition.deliverFormats,
    qualityChecks: definition.qualityChecks.map(item => item.id)
  },
  applicationWithoutCodeChanges: {
    registryClassification: registry.classify(text).id,
    soomgoSellable: registry.listServices({ channel: 'soomgo' }).some(item => item.id === 'translation_en'),
    kmongSellable: registry.listServices({ channel: 'kmong' }).some(item => item.id === 'translation_en'),
    quote: { serviceId: quote.serviceId, amount: quote.amount, message: quote.message, autoSend: quote.autoSend, reason: quote.reason },
    intake: { asked: intake.asked, text: intake.text },
    deliverFormats: formats,
    deliverFormatError: formatError,
    quality: runChecks('translation_en', { path: path.join(__dirname, 'samples', 'doc_open-pass.docx') }, { minimumChars: 10 }),
    kmongReply: deterministicReply({ serviceType: 'translation_en', message: text })
  }
};

report.codeChangeFree = report.applicationWithoutCodeChanges.soomgoSellable
  && report.applicationWithoutCodeChanges.kmongSellable
  && report.applicationWithoutCodeChanges.quote.amount === report.testDefinition.price
  && report.applicationWithoutCodeChanges.deliverFormats.includes('docx')
  && report.applicationWithoutCodeChanges.quality.results.length === definition.qualityChecks.length
  && report.applicationWithoutCodeChanges.kmongReply.serviceType === 'translation_en';

console.log(JSON.stringify(report, null, 2));
console.log(`translation-extension-stage6: ${report.codeChangeFree ? 'PASS' : 'BLOCKED'}`);
