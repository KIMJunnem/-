// 0.4.19: 목록 카드 키가 '자세히 보기' 글로 모두 같아져 한 건 건너뛰면 전부 안 여는 문제 회귀 검사.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
const start = source.indexOf('    const cards = [...document.querySelectorAll');
const end = source.indexOf('    return [...links, ...cards];');
assert.ok(start > 0 && end > start, 'cards 코드 위치');
const snippet = source.slice(start, end);

class Node {
  constructor(tag, text = '', children = []) { this.tag = tag; this.ownText = text; this.children = children; this.parentElement = null; this.id = ''; children.forEach(c => { c.parentElement = this; }); }
  get textContent() { return this.ownText + this.children.map(c => c.textContent).join(' '); }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel) { return sel === 'button' ? this.all().filter(n => n.tag === 'button') : []; }
  closest() { return null; }
  getAttribute() { return null; }
}
const run = root => {
  const document = { body: root, querySelectorAll: sel => root.querySelectorAll(sel) };
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const hash = eval(source.match(/const hash = (value => \{[^\n]+\});/)[1]);
  const visible = () => true;
  return eval(`(() => {${snippet}; return cards; })()`);
};
// 카드 칸이 div(클래스 없음)로만 되어 있어도 카드마다 키가 달라야 한다.
const card = (name, time) => new Node('div', '', [new Node('div', `${name} 자막 요청 · ${time}`), new Node('button', '자세히 보기')]);
const list = () => new Node('body', '', [new Node('div', '', [card('김철수', '3분 전'), card('이영희', '10분 전'), card('박민수', '1시간 전')])]);
const cards = run(list());
assert.equal(cards.length, 3);
assert.equal(new Set(cards.map(c => c.key)).size, 3, '카드 키가 서로 달라야 한다');
assert.ok(cards.every(c => !c.generic));
// 시간 글이 바뀌어도 같은 카드 키는 유지된다.
const later = run(new Node('body', '', [new Node('div', '', [card('김철수', '8분 전')])]));
assert.equal(later[0].key, cards[0].key);
// 버튼만 덩그러니 있으면 generic으로 표시돼 건너뜀 기록에 쓰이지 않는다.
const bare = run(new Node('body', '', [new Node('button', '자세히 보기'), new Node('button', '자세히 보기')]));
assert.ok(bare.every(c => c.generic));
assert.match(source, /if \(entry\.generic\) return null;/);
assert.match(source, /!last\.generic/);
assert.match(source, /\/\^REQ-\//);
console.log('request-bot-card-key ok');
