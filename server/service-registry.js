'use strict';

const fs = require('node:fs');
const path = require('node:path');

const servicesDirectory = path.join(__dirname, '..', 'services');

function loadDefinitions() {
  const definitions = fs.readdirSync(servicesDirectory)
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
    .map(fileName => {
      const filePath = path.join(servicesDirectory, fileName);
      const definition = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      if (!definition.id || !definition.label) {
        throw new Error(`Service definition requires id and label: ${filePath}`);
      }

      return Object.freeze({
        ...definition,
        _matchPatterns: Object.freeze((definition.matchKeywords || []).map(pattern => ({
          source: pattern,
          regex: new RegExp(pattern, 'i')
        }))),
        _excludePatterns: Object.freeze((definition.excludeKeywords || []).map(pattern => ({
          source: pattern,
          regex: new RegExp(pattern, 'i')
        })))
      });
    });

  const ids = definitions.map(definition => definition.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Service definition ids must be unique.');
  }

  return Object.freeze(definitions);
}

const definitions = loadDefinitions();
const definitionsById = new Map(definitions.map(definition => [definition.id, definition]));

// 정의 파일 전체의 내용 해시. 파일이 바뀌면 값이 바뀌어, 건너뛴 요청의 재판정 기준이 된다.
const definitionsVersion = (() => {
  const hash = require('node:crypto').createHash('sha256');
  const files = fs.readdirSync(servicesDirectory).filter(name => name.endsWith('.json')).sort();
  for (const name of files) hash.update(name).update(fs.readFileSync(path.join(servicesDirectory, name)));
  const common = path.join(servicesDirectory, '_common', 'soomgo-categories.json');
  if (fs.existsSync(common)) hash.update('soomgo-categories').update(fs.readFileSync(common));
  // D': 자동 처리 규칙이 바뀌면 보류했던 요청을 다시 판정한다.
  const autoRules = path.join(servicesDirectory, '_common', 'soomgo-auto-rules.json');
  if (fs.existsSync(autoRules)) hash.update('soomgo-auto-rules').update(fs.readFileSync(autoRules));
  return hash.digest('hex').slice(0, 16);
})();

// 숨고 요청서의 카테고리 줄(예: '교정/교열') → 서비스 매핑. 문자열은 정의 파일의
// soomgoCategories에만 둔다. 판매 서비스에 없는 카테고리는 _common/soomgo-categories.json.
const soomgoCategoryRules = (() => {
  const rules = [];
  for (const definition of definitions) {
    for (const category of Array.isArray(definition.soomgoCategories) ? definition.soomgoCategories : []) {
      rules.push({ name: category.name, regex: new RegExp(category.match, 'i'), serviceId: definition.id, foreignLanguage: category.foreignLanguage || null });
    }
  }
  const common = path.join(servicesDirectory, '_common', 'soomgo-categories.json');
  if (fs.existsSync(common)) {
    const extra = JSON.parse(fs.readFileSync(common, 'utf8'));
    for (const category of Array.isArray(extra.unmappedCategories) ? extra.unmappedCategories : []) {
      rules.push({ name: category.name, regex: new RegExp(category.match, 'i'), serviceId: null, foreignLanguage: null });
    }
  }
  return Object.freeze(rules);
})();

function matchSoomgoCategory(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 40) return null;
  const rule = soomgoCategoryRules.find(item => item.regex.test(text));
  return rule ? { name: rule.name, serviceId: rule.serviceId, foreignLanguage: rule.foreignLanguage } : null;
}

// 분류가 비었을 때만 쓰는 목적(purpose) 보조 규칙(정의 파일 soomgoPurposeFallback).
function purposeFallbackServiceId(purpose) {
  const text = String(purpose || '');
  const found = definitions.find(definition => definition.soomgoPurposeFallback && new RegExp(definition.soomgoPurposeFallback, 'i').test(text));
  return found ? found.id : null;
}

function publicDefinition(definition) {
  if (!definition) return null;
  const { _matchPatterns, _excludePatterns, ...value } = definition;
  return value;
}

function classify(text) {
  const source = String(text || '');
  const candidateDetails = definitions.flatMap(definition => {
    const matched = definition._matchPatterns
      .filter(pattern => pattern.regex.test(source))
      .map(pattern => pattern.source);
    const excluded = definition._excludePatterns.some(pattern => pattern.regex.test(source));
    return matched.length > 0 && !excluded ? [{ definition, matched }] : [];
  });

  if (candidateDetails.length === 0) {
    return { id: null, label: null, matched: [], candidates: [], usedPriority: false };
  }

  const ordered = [...candidateDetails].sort((left, right) =>
    Number(right.definition.priority || 0) - Number(left.definition.priority || 0)
    || left.definition.id.localeCompare(right.definition.id));
  const selected = ordered[0];

  return {
    id: selected.definition.id,
    label: selected.definition.label,
    matched: selected.matched,
    candidates: ordered.map(candidate => candidate.definition.id),
    usedPriority: ordered.length > 1
  };
}

function getService(id) {
  return publicDefinition(definitionsById.get(String(id || '')));
}

function listServices({ channel } = {}) {
  return definitions
    // 채널 값이 true, 또는 { enabled: true } 객체(파이버처럼 설정이 딸린 채널, 2026-09-23)면 판매 목록에 넣는다.
    .filter(definition => !channel || definition.channels?.[channel] === true || definition.channels?.[channel]?.enabled === true)
    .map(publicDefinition);
}

module.exports = { classify, getService, listServices, matchSoomgoCategory, purposeFallbackServiceId, definitionsVersion };

