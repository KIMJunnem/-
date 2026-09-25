'use strict';

// 요청봇 0.4.16 삭제 버튼 고르기: 상세 화면 옆 목록의 다른 요청 카드 버튼은 절대 고르지 않는다.
// 확장 코드의 해당 함수만 떼어 가짜 DOM에서 실행한다(실제 숨고 화면 구조는 [추정]).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
const snippet = source.slice(source.indexOf('  const AUTO_DELETE_ALLOWED'), source.indexOf('  async function deleteCurrentRequest'));

class El {
  constructor(tag, attrs = {}, children = [], text = '') { this.tag = tag; this.attrs = attrs; this.children = []; this.parentElement = null; this.text = text; this.clicked = 0; children.forEach(c => this.add(c)); }
  add(child) { child.parentElement = this; this.children.push(child); return this; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(selector) {
    return this.all().filter(el => selector.split(',').some(part => {
      part = part.trim();
      if (part === 'button') return el.tag === 'button';
      if (part === '[role="button"]') return el.attrs.role === 'button';
      if (part.startsWith('a[href*=')) return el.tag === 'a' && String(el.attrs.href || '').includes('/requests/received/');
      return false;
    }));
  }
  closest() { return null; }
  click() { this.clicked += 1; }
}
const btn = () => new El('button', {}, [], '삭제하기');
const card = (id, button) => new El('div', { class: 'card' }, [new El('a', { href: `/pro/requests/received/${id}` }, [], '자세히 보기'), new El('div', {}, [button])]);

function load() {
  return new Function('requestId', 'visible', 'clean', 'document', `${snippet}; return { currentRequestDeleteButton, belongsToOtherRequest };`)(
    () => 'CUR', () => true, v => String(v || '').trim(), null);
}
const { currentRequestDeleteButton } = load();

// 1) 목록(다른 요청 카드 2개) + 상세(현재 요청) → 상세의 버튼만
{
  const other1 = btn(), other2 = btn(), detail = btn();
  const root = new El('main', {}, [new El('aside', {}, [card('A1', other1), card('B2', other2)]), new El('section', {}, [new El('h2', {}, [], '요청 상세'), detail])]);
  assert.equal(currentRequestDeleteButton('CUR', root), detail);
}
// 2) 목록 카드에 버튼만 있고 상세에는 없으면 → 아무것도 고르지 않는다
{
  const root = new El('main', {}, [new El('aside', {}, [card('A1', btn()), card('B2', btn())]), new El('section', {}, [new El('h2', {}, [], '요청 상세')])]);
  assert.equal(currentRequestDeleteButton('CUR', root), null);
}
// 3) 현재 요청의 목록 카드 버튼은 같은 요청이므로 허용
{
  const mine = btn();
  const root = new El('main', {}, [new El('aside', {}, [card('A1', btn()), card('CUR', mine)])]);
  assert.equal(currentRequestDeleteButton('CUR', root), mine);
}
// 3-1) 목록 카드가 한 장뿐인 화면에서 그 카드 버튼(다른 요청)만 있으면 → 고르지 않는다
{
  const root = new El('main', {}, [new El('aside', {}, [card('A1', btn())]), new El('section', {}, [new El('h2', {}, [], '요청 상세')])]);
  assert.equal(currentRequestDeleteButton('CUR', root), null);
}
// 4) 요청 ID를 모르면 누르지 않는다
assert.equal(currentRequestDeleteButton('', new El('main', {}, [btn()])), null);
console.log('request-bot-delete-scope: PASS');
