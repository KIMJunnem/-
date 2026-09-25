'use strict';

const fs = require('node:fs');
const path = require('node:path');
const serviceRegistry = require('./service-registry');

const checksDirectory = path.join(__dirname, '..', 'checks');

function checkDefinition(item) {
  if (typeof item === 'string') return { id: item, blocking: true };
  if (!item || typeof item !== 'object') return { id: '', blocking: true };
  return {
    ...item,
    id: String(item.id || ''),
    blocking: item.blocking !== false
  };
}

function checkModulePath(id) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;
  return path.join(checksDirectory, `${id}.js`);
}

function loadCheck(id) {
  const filePath = checkModulePath(id);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const loaded = require(filePath);
  if (typeof loaded === 'function') return loaded;
  if (typeof loaded?.run === 'function') return loaded.run;
  return null;
}

function failure(id, detail, location, blocking, status = 'failed') {
  return {
    id,
    detail: String(detail || '검사에 실패했습니다.'),
    location: location == null ? null : String(location),
    blocking: Boolean(blocking),
    status: status === 'manual_review' ? 'manual_review' : 'failed'
  };
}

function resultStatus(result) {
  if (result === true || result?.passed === true) return 'passed';
  if (result?.status === 'manual_review' || result?.type === 'manual_review_required') return 'manual_review';
  return 'failed';
}

function normalizeResult(id, result, definition, index) {
  if (result === true || result?.passed === true) return [];

  const defaultLocation = `services/${definition.id}.json#qualityChecks[${index}]`;
  const entries = Array.isArray(result?.failures) && result.failures.length
    ? result.failures
    : [result && typeof result === 'object' ? result : {}];

  return entries.map(entry => failure(
    entry.id || id,
    entry.detail || entry.message || `검사 ${id}에 실패했습니다.`,
    entry.location ?? result?.location ?? defaultLocation,
    entry.blocking ?? result?.blocking ?? definition.blocking,
    entry.status || resultStatus(result)
  ));
}

function runChecks(serviceId, deliverable, context = {}) {
  const service = serviceRegistry.getService(serviceId);
  if (!service) {
    const failures = [failure(
      'unknown_service',
      `등록되지 않은 서비스 ID입니다: ${String(serviceId || '')}`,
      'serviceId',
      true
    )];
    return { status: 'failed', passed: false, blocking: true, failures: failures.map(({ blocking, ...item }) => item), results: [] };
  }

  const definitions = Array.isArray(service.qualityChecks)
    ? service.qualityChecks.map(checkDefinition)
    : [];
  const failures = [];
  const results = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const run = loadCheck(definition.id);
    if (!run) {
      failures.push(failure(
        'unknown_check',
        `등록되지 않은 검사 ID입니다: ${definition.id || '(empty)'}`,
        `services/${service.id}.json#qualityChecks[${index}]`,
        true
      ));
      results.push({ id: definition.id, status: 'failed', passed: false, error: 'unknown_check' });
      continue;
    }

    try {
      const result = run(deliverable, {
        ...context,
        service,
        checkParams: service.checkParams || {}
      }, definition);
      if (result && typeof result.then === 'function') throw new Error('비동기 검사는 동기 납품 게이트에서 실행할 수 없습니다.');
      results.push({ id: definition.id, status: resultStatus(result), ...(result && typeof result === 'object' ? result : { passed: result === true }) });
      failures.push(...normalizeResult(definition.id, result, definition, index));
    } catch (error) {
      failures.push(failure(
        definition.id,
        `검사 실행 오류: ${error?.message || String(error)}`,
        `services/${service.id}.json#qualityChecks[${index}]`,
        definition.blocking
      ));
      results.push({ id: definition.id, status: 'failed', passed: false, error: error?.message || String(error) });
    }
  }

  const blocking = failures.some(item => item.blocking);
  const blockingFailures = failures.filter(item => item.blocking);
  const status = blockingFailures.some(item => item.status === 'failed')
    ? 'failed'
    : blockingFailures.some(item => item.status === 'manual_review')
      ? 'manual_review'
      : failures.some(item => item.status === 'failed')
        ? 'failed'
        : failures.some(item => item.status === 'manual_review')
          ? 'manual_review'
          : 'passed';
  return {
    status,
    passed: status === 'passed',
    blocking,
    failures: failures.map(({ blocking: _blocking, ...item }) => item),
    results
  };
}

module.exports = { runChecks };
