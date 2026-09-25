'use strict';

// Jev 품질 실험용 대량 합성 표본(2026-09-22, 준희 지시 "몇천 개 큰 표본").
// 규칙으로 만든다: 바른 문장 틀에 값을 채우고, 오류·누락·보탬·말바꿈을 하나씩 일부러 넣는다.
// 무엇을 넣었는지 알고 만들기 때문에 정답(gold)이 저절로 붙는다.
// 외부 호출 없음(무료), 실제 고객 자료 없음, 같은 시드면 항상 같은 결과.

const DEFAULT_SIZE = 3000;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const pickOther = (r, list, not) => { const rest = list.filter(v => JSON.stringify(v) !== JSON.stringify(not)); return pick(r, rest); };

// 받침 있으면 앞 조사, 없으면 뒤 조사
function hasBatchim(word) {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
  if (/[0136780]/.test(ch)) return true; // 영·일·삼·육·칠·팔·십(공) 받침
  return false;
}
const josa = (word, pair) => { const [a, b] = pair.split('/'); return word + (hasBatchim(word) ? a : b); };
const fill = (tpl, vals) => tpl.replace(/\{(\w+)(?::([^}]+))?\}/g, (_, k, j) => { const v = vals[k]; if (v == null) throw new Error(`slot ${k}`); return j ? josa(v, j) : v; });

function srt(idx, lines) {
  const s = idx * 3;
  const t = n => `00:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')},000`;
  return `${idx}\n${t(s)} --> ${t(s + 2)}\n${lines.join('\n')}`;
}

function uniqueRows(make, size, seed) {
  const r = rng(seed);
  const seen = new Set();
  const rows = [];
  for (let tries = 0; rows.length < size && tries < size * 50; tries += 1) {
    const row = make(r, rows.length);
    if (!row) continue;
    const sig = JSON.stringify(row.fields);
    if (seen.has(sig)) continue;
    seen.add(sig);
    rows.push(row);
  }
  return rows;
}

// ─── edit_pairs: 교정 전(original)·후(edited) ───
// 틀마다 [[바른|틀린]] 표기가 하나씩 있다. 나머지는 바른 문장이다.
const EDIT_TEMPLATES = [
  '[[웬만하면|왠만하면]] {day}까지 {doc:을/를} 보내 주세요.',
  '{doc:은/는} {day}까지 [[며칠|몇일]] 더 걸릴 것 같습니다.',
  '{person}께서 {doc:을/를} [[금세|금새]] 확인해 주셨습니다.',
  '{doc} 수정이 모두 [[됐습니다|됬습니다]].',
  '{day} {time}에 {doc:을/를} 다시 [[보낼게요|보낼께요]].',
  '{doc:은/는} 아직 받지 [[않았습니다|안았습니다]].',
  '{day} {time}에 회의가 열릴 [[예정입니다|예정 입니다]].',
  '{person}의 [[역할|역활]]은 {doc} 검토입니다.',
  '[[오랜만에|오랫만에]] {person}께 {doc:을/를} 보냈습니다.',
  '{doc:을/를} [[일부러|일부로]] {day}까지 미뤘습니다.',
  '[[굳이|궂이]] {day}까지 기다리실 필요는 없습니다.',
  '{doc:이/가} 열리지 않으면 [[어떡해요|어떻해요]]?',
  '{day}까지 {doc:을/를} [[드릴게요|드릴께요]].',
  '{doc:이/가} {num}쪽을 넘으면 추가 요금이 [[붙습니다|붇습니다]].',
  '{person}께서 {doc:을/를} [[꼼꼼히|꼼꼼이]] 읽어 보셨습니다.',
  '{doc:은/는} {day} {time}까지 [[제출해|제출헤]] 주세요.',
  '{doc} {num}부를 [[깨끗이|깨끗히]] 인쇄해 두었습니다.',
  '{person}께 {doc:을/를} [[틈틈이|틈틈히]] 보여 드렸습니다.',
  '{day}에는 [[안 돼요|안 되요]]. {doc:은/는} 그다음 날 드릴게요.',
  '{doc:을/를} 다 읽고 나니 [[설렘|설레임]]보다 걱정이 앞섭니다.',
  '{num}명이 {doc:을/를} [[금방|금빵]] 확인했습니다.',
  '{doc} 마감은 {day} {time}로 [[바뀌었습니다|바꼈습니다]].',
  '{person}께서 {doc:을/를} {day}까지 [[맞춰|마춰]] 주신다고 했습니다.',
  '{doc:은/는} [[어차피|어짜피]] {day}에 다시 봐야 합니다.'
];
// 뜻을 바꾸지 않는 말투 바꾸기(original이 바른 문장일 때). 맞는 규칙이 없으면 그 표본은 건너뛴다.
function styleSwap(text) {
  const fixed = [['주세요.', '주시기 바랍니다.'], ['보낼게요.', '보내겠습니다.'], ['드릴게요.', '드리겠습니다.'], ['같습니다.', '같아요.'], ['없습니다.', '없어요.'], ['붙습니다.', '붙어요.'], ['앞섭니다.', '앞서요.'], ['했습니다.', '하였습니다.']];
  for (const [a, b] of fixed) if (text.endsWith(a)) return text.slice(0, -a.length) + b;
  // 과거형 '-ㅆ습니다.' → '-ㅆ어요.'
  const m = text.match(/(.)습니다\.$/);
  if (m) { const code = m[1].charCodeAt(0); if (code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 === 20) return text.slice(0, -'습니다.'.length) + '어요.'; }
  const n = text.match(/(\S+)입니다\.$/);
  if (n) return text.slice(0, -'입니다.'.length) + (hasBatchim(n[1]) ? '이에요.' : '예요.');
  return null;
}
const SLOT = {
  day: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '내일', '모레', '다음 주 월요일', '이번 주 금요일', '15일', '20일', '말일'],
  time: ['오전 9시', '오전 10시', '오전 11시', '오후 1시', '오후 2시', '오후 3시', '오후 4시', '오후 5시', '저녁 6시', '저녁 7시'],
  doc: ['보고서', '견적서', '자료', '원고', '계약서', '발표 자료', '자막 파일', '영상 파일', '설문 결과', '회의록', '안내문', '신청서', '사진', '초안', '교정본'],
  person: ['김 대리님', '박 팀장님', '이 과장님', '최 선생님', '정 실장님', '한 대표님', '윤 주임님', '강 부장님'],
  num: ['2', '3', '5', '10', '12', '20', '30', '50']
};
function slotVals(r) { return Object.fromEntries(Object.entries(SLOT).map(([k, v]) => [k, pick(r, v)])); }
function renderEdit(tpl, vals, wrong) { return fill(tpl.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/, (_, ok, bad) => (wrong ? bad : ok)), vals); }
function changeMeaning(r, tpl, vals) {
  const used = Object.keys(SLOT).filter(k => new RegExp(`\\{${k}[}:]`).test(tpl));
  const k = pick(r, used);
  return { ...vals, [k]: pickOther(r, SLOT[k], vals[k]) };
}
function editPairs(size = DEFAULT_SIZE, seed = 5) {
  const kinds = ['fix', 'style', 'meaning', 'fix_meaning'];
  return uniqueRows((r, i) => {
    const kind = kinds[i % kinds.length];
    const tpl = pick(r, EDIT_TEMPLATES);
    const vals = slotVals(r);
    let original; let edited; let gold;
    if (kind === 'fix') { original = renderEdit(tpl, vals, true); edited = renderEdit(tpl, vals, false); gold = { original_had_error: true, meaning_changed: false }; }
    if (kind === 'style') {
      original = renderEdit(tpl, vals, false);
      edited = styleSwap(original);
      if (!edited) return null;
      gold = { original_had_error: false, meaning_changed: false };
    }
    if (kind === 'meaning') { original = renderEdit(tpl, vals, false); edited = renderEdit(tpl, changeMeaning(r, tpl, vals), false); gold = { original_had_error: false, meaning_changed: true }; }
    if (kind === 'fix_meaning') { original = renderEdit(tpl, vals, true); edited = renderEdit(tpl, changeMeaning(r, tpl, vals), false); gold = { original_had_error: true, meaning_changed: true }; }
    if (original === edited) return null;
    return { kind, fields: { original, edited }, gold };
  }, size, seed).map((row, i) => ({ id: `ep-gen-${String(i + 1).padStart(4, '0')}-${row.kind}`, ...row.fields, gold: row.gold }));
}

// ─── document_claims: 자료(material)에 근거한 주장(claim)인가 ───
const ORGS = ['한빛상사', '푸른식품', '새솔출판', '다온여행', '미래학원', '서해물산', '하늘카페', '누리전자', '초록농원', '바른의원'];
const METRICS = [['매출', '억 원'], ['회원 수', '명'], ['방문객 수', '명'], ['판매량', '개'], ['주문 건수', '건']];
const CITIES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '수원', '청주', '전주'];
const PCTS = [10, 20, 25, 30, 40, 50];
const num = n => n.toLocaleString('en-US');
function documentClaims(size = DEFAULT_SIZE, seed = 4) {
  const kinds = ['t_value', 'f_value', 't_pct', 'f_pct', 't_city', 'f_city', 'f_year', 'f_extra', 't_compare', 'f_compare'];
  return uniqueRows((r, i) => {
    const kind = kinds[i % kinds.length];
    const org = pick(r, ORGS); const [metric, unit] = pick(r, METRICS); const city = pick(r, CITIES);
    const y1 = 2020 + Math.floor(r() * 5); const y2 = y1 + 1;
    const scale = unit === '억 원' ? 1 : pick(r, [100, 1000]);
    const pct = pick(r, PCTS);
    const base = (4 + Math.floor(r() * 30)) * 4; // 4의 배수 → 25% 등도 정수
    const a = base * scale; const up = r() < 0.7; const b = up ? a * (100 + pct) / 100 : a * (100 - pct) / 100;
    if (!Number.isInteger(b)) return null;
    const v = n => `${num(n)}${unit}`;
    const material = `${org}의 ${y1}년 ${josa(metric, '은/는')} ${v(a)}, ${y2}년 ${josa(metric, '은/는')} ${v(b)}이다. 본사는 ${city}에 있다.`;
    const M = josa(metric, '은/는'); const Mi = josa(metric, '이/가');
    const wrongB = b + pick(r, [1, 2, 3, 5]) * scale * (unit === '억 원' ? 1 : 1);
    const claims = {
      t_value: [`${y2}년 ${M} ${v(b)}이다.`, true],
      f_value: [`${y2}년 ${M} ${v(wrongB)}이다.`, false],
      t_pct: [`${y2}년 ${Mi} ${y1}년보다 ${pct}% ${up ? '늘었다' : '줄었다'}.`, true],
      f_pct: [`${y2}년 ${Mi} ${y1}년보다 ${pickOther(r, PCTS, pct)}% ${up ? '늘었다' : '줄었다'}.`, false],
      t_city: [`${org}의 본사는 ${city}에 있다.`, true],
      f_city: [`${org}의 본사는 ${pickOther(r, CITIES, city)}에 있다.`, false],
      f_year: [`${y2}년 ${M} ${v(a)}이다.`, false],
      f_extra: [`${y2}년 직원 수는 ${pick(r, [12, 35, 48, 120, 260])}명이다.`, false],
      t_compare: [`${y2}년 ${Mi} ${y1}년보다 ${up ? '많다' : '적다'}.`, true],
      f_compare: [`${y2}년 ${Mi} ${y1}년보다 ${up ? '적다' : '많다'}.`, false]
    };
    const [claim, supported] = claims[kind];
    return { kind, fields: { claim, material }, gold: { supported } };
  }, size, seed).map((row, i) => ({ id: `dc-gen-${String(i + 1).padStart(4, '0')}-${row.kind}`, ...row.fields, gold: row.gold }));
}

// ─── subtitle_pairs: 한국어 자막(srt_block) ↔ 원어 대본(transcript, 영어) ───
const P = {
  place: [['the old market', '오래된 시장'], ['the city museum', '시립 박물관'], ['the harbor', '항구'], ['a small bakery', '작은 빵집'], ['the train station', '기차역'], ['the public library', '공공 도서관'], ['the riverside park', '강변 공원'], ['the night market', '야시장'], ['the flower shop', '꽃집'], ['the fish market', '수산 시장']],
  when: [['every Sunday morning', '매주 일요일 아침에'], ['at seven in the evening', '저녁 일곱 시에'], ['on weekdays', '평일에'], ['in early spring', '초봄에'], ['at six in the morning', '아침 여섯 시에'], ['on Saturdays', '토요일마다']],
  person: [['my grandmother', '우리 할머니'], ['the owner', '주인'], ['our guide', '가이드'], ['a young chef', '젊은 요리사'], ['my friend', '제 친구'], ['the teacher', '선생님'], ['my uncle', '삼촌']],
  food: [['bread', '빵'], ['coffee', '커피'], ['noodles', '국수'], ['apples', '사과'], ['cheese', '치즈'], ['fish', '생선'], ['rice cakes', '떡'], ['dumplings', '만두']],
  years: [['three', '3'], ['five', '5'], ['ten', '10'], ['twelve', '12'], ['twenty', '20'], ['thirty', '30']],
  people: [['fifty', '50'], ['a hundred', '100'], ['two hundred', '200'], ['five hundred', '500']],
  price: [['two thousand', '2,000'], ['three thousand', '3,000'], ['five thousand', '5,000'], ['eight thousand', '8,000']]
};
const cap = s => s[0].toUpperCase() + s.slice(1);
const SENTENCES = [
  [v => `Today we are visiting ${v.place[0]}.`, v => `오늘은 ${v.place[1]}에 가 봅니다.`, ['place']],
  [v => `It opens ${v.when[0]}.`, v => `이곳은 ${v.when[1]} 문을 엽니다.`, ['when']],
  [v => `${cap(v.person[0])} has worked here for ${v.years[0]} years.`, v => `${josa(v.person[1], '은/는')} 이곳에서 ${v.years[1]}년째 일하고 있습니다.`, ['person', 'years']],
  [v => `They sell fresh ${v.food[0]} here.`, v => `여기서는 신선한 ${josa(v.food[1], '을/를')} 팝니다.`, ['food']],
  [v => `${cap(v.person[0])} recommends the ${v.food[0]}.`, v => `${josa(v.person[1], '은/는')} ${josa(v.food[1], '을/를')} 추천합니다.`, ['person', 'food']],
  [v => `About ${v.people[0]} people come here every day.`, v => `하루에 ${v.people[1]}명쯤 이곳을 찾습니다.`, ['people']],
  [v => `The price has gone up to ${v.price[0]} won.`, v => `가격이 ${v.price[1]}원으로 올랐습니다.`, ['price']],
  [v => `This building is ${v.years[0]} years old.`, v => `이 건물은 지은 지 ${v.years[1]}년 됐습니다.`, ['years']],
  [() => 'It is raining, so the street is quiet.', () => '비가 와서 거리가 조용합니다.', []],
  [() => 'Let us go inside.', () => '안으로 들어가 보겠습니다.', []],
  [v => `We came here with ${v.person[0]}.`, v => `${v.person[1]}${hasBatchim(v.person[1]) ? '과' : '와'} 함께 왔습니다.`, ['person']]
];
function sentencePair(r, not = []) {
  const k = pick(r, SENTENCES.map((_, i) => i).filter(i => !not.includes(i)));
  const vals = Object.fromEntries(Object.entries(P).map(([name, list]) => [name, pick(r, list)]));
  const [en, ko] = SENTENCES[k];
  return { k, en: en(vals), ko: ko(vals) };
}
function subtitlePairs(size = DEFAULT_SIZE, seed = 3) {
  const kinds = ['aligned', 'omission', 'addition', 'shifted'];
  return uniqueRows((r, i) => {
    const kind = kinds[i % kinds.length];
    const s1 = sentencePair(r); const s2 = sentencePair(r, [s1.k]);
    const n = 1 + (i % 400);
    if (kind === 'aligned') {
      const two = r() < 0.5;
      return { kind, fields: { srt_block: srt(n, two ? [s1.ko, s2.ko] : [s1.ko]), transcript: two ? `${s1.en} ${s2.en}` : s1.en, source_lang: 'en' }, fix: two ? [s1.ko, s2.ko] : [s1.ko], gold: { same_content: true, omits_meaning: false, adds_meaning: false } };
    }
    // 한 문장 빠짐/보탬: 전체 내용이 같은지는 정답을 매기지 않는다(null)
    if (kind === 'omission') return { kind, fields: { srt_block: srt(n, [s1.ko]), transcript: `${s1.en} ${s2.en}`, source_lang: 'en' }, fix: [s1.ko, s2.ko], gold: { same_content: null, omits_meaning: true, adds_meaning: false } };
    if (kind === 'addition') return { kind, fields: { srt_block: srt(n, [s1.ko, s2.ko]), transcript: s1.en, source_lang: 'en' }, fix: [s1.ko], gold: { same_content: null, omits_meaning: false, adds_meaning: true } };
    // 싱크 밀림: 전혀 다른 문장끼리. 누락·보탬은 의미가 없어 매기지 않는다.
    return { kind, fields: { srt_block: srt(n, [s1.ko]), transcript: s2.en, source_lang: 'en' }, fix: [s2.ko], gold: { same_content: false, omits_meaning: null, adds_meaning: null } };
  }, size, seed).map((row, i) => ({ id: `sp-gen-${String(i + 1).padStart(4, '0')}-${row.kind}`, ...row.fields, fix_lines: row.fix, gold: row.gold }));
}

// ─── subtitle_blocks: 자막 줄 나눔이 구 중간에서 끊겼나 ───
// 구(phrase)는 [꾸밈말, 중심말] 두 단어. 구 사이에서 끊으면 자연스럽고, 구 안(두 단어 사이)에서 끊으면 부자연스럽다.
const BLOCK_PARTS = [
  [[['이번', '행사는'], ['올해', '축제는'], ['다음', '모임은'], ['새', '매장은'], ['우리', '가게는']],
   [['이번', '주말에'], ['다음', '달에'], ['오는', '토요일에'], ['올해', '가을에'], ['이번', '겨울에']],
   [['시청', '광장에서'], ['강변', '공원에서'], ['동네', '도서관에서'], ['작은', '카페에서'], ['새', '건물에서']],
   [['열립니다'], ['시작됩니다'], ['진행됩니다']]],
  [[['우리', '할머니는'], ['젊은', '요리사는'], ['동네', '주민들은'], ['시장', '상인들은'], ['제', '친구는']],
   [['매일', '아침'], ['주말', '오후에'], ['평일', '저녁에']],
   [['따뜻한', '국수를'], ['갓 구운', '빵을'], ['신선한', '생선을'], ['직접 만든', '만두를'], ['달콤한', '떡을']],
   [['팝니다'], ['준비합니다'], ['나눠 줍니다']]]
];
function subtitleBlocks(size = DEFAULT_SIZE, seed = 2) {
  const r = rng(seed);
  const seen = new Set(); const rows = [];
  for (let tries = 0; rows.length < size && tries < size * 50; tries += 1) {
    const phrases = pick(r, BLOCK_PARTS).map(slot => pick(r, slot));
    // 단어와 '이 단어 앞에서 끊어도 되는가' 표시
    const words = []; const okBefore = [];
    phrases.forEach(ph => ph.forEach((w, j) => { words.push(w); okBefore.push(j === 0); }));
    const want = rows.length % 2 === 0; // 짝수 번째는 부자연스러운 줄 나눔
    const cuts = []; for (let c = 1; c < words.length; c += 1) cuts.push(c);
    const c1 = pick(r, cuts); const c2Options = cuts.filter(c => c > c1);
    if (!c2Options.length) continue;
    const c2 = pick(r, c2Options);
    const bad = !okBefore[c1] || !okBefore[c2];
    if (bad !== want) continue;
    const prev = words.slice(0, c1).join(' '); const cur = words.slice(c1, c2).join(' '); const next = words.slice(c2).join(' ');
    const sig = `${prev}|${cur}|${next}`; if (seen.has(sig)) continue; seen.add(sig);
    const n = 1 + (rows.length % 300) * 3;
    rows.push({ id: `sb-gen-${String(rows.length + 1).padStart(4, '0')}-${bad ? 'mid' : 'clean'}`, prev_block: srt(n, [prev]), srt_block: srt(n + 1, [cur]), next_block: srt(n + 2, [next]), gold: { breaks_mid_phrase: bad } });
  }
  return rows;
}

// ─── 파이프라인 과제(2026-09-22): 모델이 고쳐야 할 입력과 정답 출력 ───
// edit_pairs: 오류가 있는 원문(fix) → 정답 = 교정본, 오류 없는 원문(style) → 정답 = 원문 그대로(고치면 과잉 수정)
// subtitle_pairs: 자막 줄 + 원어 대본 → 정답 = 대본과 맞는 한국어 줄. 뜻이 맞는 자막(aligned)은 그대로 둬야 한다.
const srtLines = block => String(block).split('\n').slice(2);
function pipelineTasks(source, count = 100) {
  if (source === 'edit_pairs') {
    const rows = editPairs();
    const fix = rows.filter(r => r.id.endsWith('-fix')); const clean = rows.filter(r => r.id.endsWith('-style'));
    const out = [];
    for (let i = 0; out.length < count && i < Math.max(fix.length, clean.length); i += 1) {
      if (fix[i] && out.length < count) out.push({ id: `pt-${fix[i].id}`, source, input: { text: fix[i].original }, current: fix[i].original, expected: fix[i].edited, needsChange: true });
      if (clean[i] && out.length < count) out.push({ id: `pt-${clean[i].id}`, source, input: { text: clean[i].original }, current: clean[i].original, expected: clean[i].original, needsChange: false });
    }
    return out;
  }
  if (source === 'subtitle_pairs') {
    const rows = subtitlePairs();
    const by = kind => rows.filter(r => r.id.endsWith(`-${kind}`));
    const lists = { aligned: by('aligned'), omission: by('omission'), addition: by('addition'), shifted: by('shifted') };
    const order = ['aligned', 'omission', 'aligned', 'addition', 'aligned', 'shifted'];
    const used = { aligned: 0, omission: 0, addition: 0, shifted: 0 };
    const out = [];
    for (let i = 0; out.length < count; i += 1) {
      const kind = order[i % order.length]; const r = lists[kind][used[kind]++];
      if (!r) break;
      const current = srtLines(r.srt_block).join('\n');
      out.push({ id: `pt-${r.id}`, source, input: { subtitle: current, transcript: r.transcript }, current, expected: r.fix_lines.join('\n'), needsChange: kind !== 'aligned' });
    }
    return out;
  }
  return [];
}

const GENERATORS = { subtitle_pairs: subtitlePairs, subtitle_blocks: subtitleBlocks, document_claims: documentClaims, edit_pairs: editPairs };
const cache = new Map();
function generated(source, size = DEFAULT_SIZE) {
  const key = `${source}:${size}`;
  if (!cache.has(key)) cache.set(key, GENERATORS[source] ? GENERATORS[source](size) : []);
  return cache.get(key);
}

module.exports = { DEFAULT_SIZE, generated, pipelineTasks, editPairs, documentClaims, subtitlePairs, subtitleBlocks, hasBatchim, josa };
