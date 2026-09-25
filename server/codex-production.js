'use strict';

// PPT 제작 — Codex 대화방 경로(2026-09-23 준희 결정 "코덱스 대화방").
// 유료 API를 부르지 않는다. 흐름:
//   1) 준희(또는 관리자 경로)가 결제 확인된 PPT 제작 게시물 + 원고 글을 넘긴다
//   2) astra-room 브리지에 production_draft 사건을 올린다 → Codex 대화방(ChatGPT 구독)이 가져가
//      [MODE:PRODUCTION_DRAFT] + [SLIDES_JSON]으로 슬라이드 내용만 돌려준다
//   3) 서버가 T1 보고형 템플릿(services/presentation-design/templates/t1-report.cjs)으로 PPTX를 만든다
//   4) finalGrade manual 그대로: 준희가 열어 보고 승인해야 나간다. 여기서는 고객에게 아무것도 보내지 않는다.
// 켜는 곳: 정책 production.provider = "codex_room" (그 전에는 요청을 받지 않는다).
// 글꼴 넣기: server/pptx-embed-fonts.js(embed-fonts.py를 Node로 옮긴 것, 결과 동일)로 Pretendard를 넣는다(2026-09-23 지시 5).
// 검사: 제작 기계 검사(services/presentation.json qualityChecks)를 서버가 넘겨주면 돌린다. check-deck.py(디자인 규칙)는
// PC에 python-pptx가 없어서 부르지 않는다(Cowork에서 따로 돌림).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DESIGN_DIR = path.join(__dirname, '..', 'services', 'presentation-design');
const TEMPLATE = path.join(DESIGN_DIR, 'templates', 't1-report.cjs');
const SAMPLE = path.join(DESIGN_DIR, 'templates', 'sample-public-report.json');
const SLIDE_TYPES = Object.freeze(['cover', 'agenda', 'section', 'text', 'two_column', 'table', 'chart', 'key_number', 'summary', 'closing']);
const LIMITS = Object.freeze({ minManuscript: 200, maxManuscript: 60000, minSlides: 3, maxSlides: 40 });

const clean = value => String(value ?? '').replace(/\u0000/g, '').trim();
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function t1Types(design = readJson(path.join(DESIGN_DIR, 'design-types.json'))) {
  return design.types.filter(t => t.template === 'T1').map(t => t.type_id);
}

function isPresentationPost(state, post = {}) {
  const task = (Array.isArray(state?.tasks) ? state.tasks : []).find(item => String(item.id || '') === String(post.taskId || '')) || {};
  const text = [post.title, task.quote?.label, task.quote?.serviceId, task.category, task.soomgoRequest?.purpose, String(post.prompt || '').slice(0, 400)].join(' ');
  return /PPT|presentation|프레젠테이션/i.test(text);
}

function instructions(typeId) {
  let sample = '';
  try { sample = JSON.stringify(readJson(SAMPLE)); } catch (_) {}
  return [
    '이 사건은 production_draft(PPT 슬라이드 내용 작성)다. 운영 계약 6번의 네 모드에 더해 이 사건에만 다섯 번째 모드 [MODE:PRODUCTION_DRAFT]를 쓴다.',
    '답의 첫 줄은 [MODE:PRODUCTION_DRAFT], 그 아래 [SLIDES_JSON] 줄, 그 아래 JSON 하나만 쓴다(코드펜스 없이). 원고가 없거나 판단이 안 서면 [MODE:NO_ACTION]과 [REASON]으로 돌려준다.',
    `템플릿: T1 보고형(${typeId}). JSON은 {"meta":{"org","title","subtitle","date","contact","footer"},"slides":[...]} 모양이다.`,
    `슬라이드 type은 ${SLIDE_TYPES.join(', ')} 중에서만 고른다. 필드 모양은 아래 예시를 그대로 따른다(예시는 가상의 기관·수치다).`,
    '규칙: 제목(headline)은 결론 문장 25자 이내. 불릿은 슬라이드당 5개 이하. 원고에 없는 숫자·사실·출처를 만들지 않는다(없으면 "[확인 필요]"). 표는 5열·8행 이하. 첫 장은 cover, 마지막 장은 closing 또는 summary.',
    '고객 이름·연락처는 원고에 있어도 meta.contact 외에는 넣지 않는다. meta.footer는 비워도 된다.',
    '플러그인을 적극 활용해서 만들 것(대화방에서 쓸 수 있는 문서·PPT 관련 플러그인으로 원고 구조를 읽고 표·수치를 확인). 결과는 위 JSON 모양 하나로만 돌려준다.',
    `예시: ${sample}`
  ].join('\n');
}

// 1) 사건 만들기(브리지 enqueue 입력). 원고 해시로 같은 원고 중복 요청을 막는다.
function buildDraftEvent({ post, manuscript, typeId, pages = null, now = new Date() }) {
  const text = clean(manuscript);
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  return {
    eventType: 'production_draft',
    caseId: String(post.taskId || post.id),
    idempotencyKey: `production_draft:${post.id}:${typeId}:${hash}`,
    source: 'relay_desk_codex_production',
    occurredAt: now.toISOString(),
    snapshotVersion: `manuscript:${hash}`,
    payload: { postId: String(post.id), taskId: String(post.taskId || ''), service: 'presentation', template: 'T1', typeId, pages: Number(pages) > 0 ? Number(pages) : null, instructions: instructions(typeId), manuscript: text }
  };
}

// 요청 검사: provider·게시물·원고·유형. 통과하면 { ok:true, event }.
function prepareRequest({ policy, state, postId, manuscript, typeId, pages, selectDesignType }) {
  if (String(policy?.production?.provider || '') !== 'codex_room') return { ok: false, status: 409, error: 'provider_not_codex_room' };
  const post = (Array.isArray(state?.promptPosts) ? state.promptPosts : []).find(item => String(item.id) === String(postId || ''));
  if (!post) return { ok: false, status: 404, error: 'prompt_post_not_found' };
  if (!(post.lane === 'soomgo_fulfillment' || post.astraProduction === true)) return { ok: false, status: 409, error: 'not_production_post' };
  if (post.astraFinalReview === true) return { ok: false, status: 409, error: 'final_review_post' };
  if (!isPresentationPost(state, post)) return { ok: false, status: 409, error: 'not_presentation_post' };
  const text = clean(manuscript);
  if (text.length < LIMITS.minManuscript) return { ok: false, status: 400, error: 'manuscript_too_short' };
  if (text.length > LIMITS.maxManuscript) return { ok: false, status: 400, error: 'manuscript_too_long' };
  const allowed = t1Types();
  let chosen = clean(typeId);
  let selection = null;
  if (!chosen && selectDesignType) { selection = selectDesignType(text); chosen = selection.typeId; }
  if (!allowed.includes(chosen)) return { ok: false, status: 409, error: 'template_not_ready', typeId: chosen || null, allowed, selection };
  return { ok: true, post, typeId: chosen, selection, event: buildDraftEvent({ post, manuscript: text, typeId: chosen, pages }) };
}

// 2) 답 검사: JSON 모양 + 슬라이드 종류·장수. 경고(제목 25자 초과 등)는 막지 않고 기록만.
function validateSlides(content) {
  const errors = [];
  const warnings = [];
  if (!content || typeof content !== 'object') return { ok: false, errors: ['not_object'], warnings };
  if (!content.meta || typeof content.meta !== 'object') errors.push('meta_missing');
  else if (!clean(content.meta.title)) errors.push('meta_title_missing');
  const slides = Array.isArray(content.slides) ? content.slides : null;
  if (!slides) errors.push('slides_missing');
  else {
    if (slides.length < LIMITS.minSlides || slides.length > LIMITS.maxSlides) errors.push(`slide_count:${slides.length}`);
    slides.forEach((sd, i) => {
      if (!SLIDE_TYPES.includes(sd?.type)) errors.push(`slide_${i + 1}_type:${String(sd?.type).slice(0, 20)}`);
      if (sd?.headline && [...String(sd.headline)].length > 25) warnings.push(`slide_${i + 1}_headline_over_25`);
      if (Array.isArray(sd?.bullets) && sd.bullets.length > 5) warnings.push(`slide_${i + 1}_bullets_over_5`);
    });
  }
  const text = JSON.stringify(content);
  if (/\[확인 필요\]/.test(text)) warnings.push('has_unconfirmed_items');
  return { ok: errors.length === 0, errors, warnings };
}

function loadTemplate() {
  // pptxgenjs는 템플릿 안에서 require된다. 없으면 여기서 분명한 오류로.
  try { require.resolve('pptxgenjs', { paths: [path.dirname(TEMPLATE)] }); } catch (_) { const e = new Error('pptxgenjs_missing'); e.code = 'pptxgenjs_missing'; throw e; }
  return require(TEMPLATE);
}

const safeName = value => clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '').slice(0, 40) || 'PPT';
const ymd = now => { const k = new Date(now.getTime() + 9 * 3600000); return k.toISOString().slice(0, 10).replace(/-/g, ''); };

// 3) 만들기: 완료된 production_draft 사건 → PPTX. 파일은 outDir/<postId>/ 아래(저장소 밖, .gitignore).
async function render({ event, outDir, now = new Date(), templateImpl = null, embedImpl = undefined, runChecks = null }) {
  if (!event || event.eventType !== 'production_draft') return { ok: false, error: 'not_production_draft' };
  if (event.status !== 'completed' || event.response?.mode !== 'PRODUCTION_DRAFT') return { ok: false, error: 'draft_not_ready', mode: event.response?.mode || null };
  const content = event.response.slides;
  const check = validateSlides(content);
  if (!check.ok) return { ok: false, error: 'slides_invalid', errors: check.errors, warnings: check.warnings };
  const typeId = String(event.payload?.typeId || '');
  const design = readJson(path.join(DESIGN_DIR, 'design-types.json'));
  const rules = readJson(path.join(DESIGN_DIR, 'quality-rules.json'));
  const typeDef = design.types.find(t => t.type_id === typeId);
  if (!typeDef || typeDef.template !== 'T1') return { ok: false, error: 'template_not_ready', typeId };
  let tpl;
  try { tpl = templateImpl || loadTemplate(); } catch (error) { return { ok: false, error: error.code || 'template_load_failed' }; }
  const dir = path.join(outDir, safeName(event.payload?.postId || event.caseId));
  fs.mkdirSync(dir, { recursive: true });
  const base = `${safeName(content.meta.title)}_${ymd(now)}`;
  let version = 1;
  while (fs.existsSync(path.join(dir, `${base}_v${version}.pptx`))) version += 1;
  const file = path.join(dir, `${base}_v${version}.pptx`);
  const raw = `${file}.nofont.pptx`;
  try {
    const pres = tpl.buildT1(typeDef, content, rules);
    pres.author = 'Swan'; // 납품 규칙: 작성자 속성 Swan
    await pres.writeFile({ fileName: raw });
  } catch (error) {
    try { fs.rmSync(raw, { force: true }); } catch (_) {}
    return { ok: false, error: 'render_failed', detail: String(error.message || error).slice(0, 200), warnings: check.warnings };
  }
  // 글꼴 넣기(Pretendard). 실패하면 글꼴 없는 판을 그대로 쓰고 기록만 한다.
  let fontsEmbedded = false; let fontError = null;
  const embed = embedImpl === undefined ? require('./pptx-embed-fonts').embedFonts : embedImpl;
  if (embed) {
    try { await embed({ src: raw, out: file }); fontsEmbedded = true; } catch (error) { fontError = String(error.message || error).slice(0, 200); }
  }
  if (fontsEmbedded) fs.rmSync(raw, { force: true }); else fs.renameSync(raw, file);
  let quality = null;
  if (runChecks) {
    try {
      const q = runChecks('presentation', { path: file }, { expectedSlides: Number(event.payload?.pages) || undefined });
      quality = { status: q.status, passed: q.passed, failures: (q.failures || []).map(f => ({ id: f.id, status: f.status, detail: String(f.detail || '').slice(0, 200) })) };
    } catch (error) { quality = { status: 'error', detail: String(error.message || error).slice(0, 200) }; }
  }
  const record = { eventId: event.eventId, postId: event.payload?.postId || null, typeId, file, slides: content.slides.length, warnings: check.warnings, fontsEmbedded, fontError, quality, deckChecked: false, status: 'awaiting_owner_review', renderedAt: now.toISOString() };
  appendLog(outDir, record);
  return { ok: true, ...record };
}

function appendLog(outDir, record) {
  const file = path.join(outDir, 'log.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  list.unshift(record);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list.slice(0, 500), null, 2));
}

function summary(outDir) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(outDir, 'log.json'), 'utf8')); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  return { awaitingReview: list.filter(item => item.status === 'awaiting_owner_review').length, latest: list.slice(0, 5).map(item => ({ postId: item.postId, file: path.basename(item.file || ''), slides: item.slides, warnings: (item.warnings || []).length, renderedAt: item.renderedAt })) };
}

module.exports = { SLIDE_TYPES, LIMITS, t1Types, isPresentationPost, instructions, buildDraftEvent, prepareRequest, validateSlides, render, summary };
