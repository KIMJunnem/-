'use strict';

// 개발방 지시 20 (2026-09-24, decisions 7-7): 고객 첨부(파일·사진·링크) Claude 판단. 스위치 기본 꺼짐(attachment-judge-on.bat).
// 합성 첨부 5건(원고 PDF 3쪽·사진 1장·짧은 합성 영상·유튜브 공개 링크 모양 URL(모의)·모르는 사이트 링크) + 가짜 Claude·가짜 fetch만.
// 실제 고객 자료·실제 발송·유료 API·외부 호출 없음. 합성 영상은 시험이 직접 만든 3초 무음 색 화면(임시 폴더).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const aj = require('../server/attachment-judge');
const fb = require('../server/customer-room-fallback');
const root = path.join(__dirname, '..');

// 0) 스위치·bat·유료 호출 예외는 스위치가 켜졌을 때만·꺼지면 아무것도 안 함
const policyFile = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
assert.equal(typeof policyFile.attachmentJudge.enabled, 'boolean');
assert.equal(policyFile.attachmentJudge.model, 'claude-opus-5-5');
for (const mode of ['on', 'off']) {
  const bat = fs.readFileSync(path.join(root, `attachment-judge-${mode}.bat`), 'utf8');
  assert.match(bat, new RegExp(`node scripts\\\\attachment-judge-switch\\.cjs ${mode}`));
  assert.doesNotMatch(bat, /chatbot-switch|quote-judge-switch|sendEnabled/, '다른 스위치는 안 건드림');
}
const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
assert.match(server, /options\.trigger === 'attachment_judge' && provider === 'Claude'[\s\S]{0,200}attach\?\.enabled === true\) return;/, '첨부 판단 예외는 스위치가 켜졌을 때만');
assert.equal((server.match(/trigger: 'attachment_judge'/g) || []).length, 1, '예외 표시는 첨부 판단 한 곳');
const fbCfg = policyFile.customerRoomFallback;
const off = { ...policyFile, attachmentJudge: { ...policyFile.attachmentJudge, enabled: false } };
const on = { ...policyFile, attachmentJudge: { ...policyFile.attachmentJudge, enabled: true, workDir: path.join(os.tmpdir(), `aj20-${process.pid}`) } };
assert.equal(aj.readConfig(off), null, '꺼져 있으면 아무것도 안 함');
const cfg = aj.readConfig(on);
assert.equal(cfg.dailyMaxCalls, fbCfg.dailyMaxCalls, '하루 호출은 7-5 상한(채팅봇)과 같은 값');
assert.equal(cfg.monthlyBudgetKrw, fbCfg.monthlyBudgetKrw, '월 금액도 7-5 상한');
assert.ok(cfg.workDir.startsWith(os.tmpdir()), '시험은 임시 폴더에만 씀');
assert.equal(path.relative(root, aj.DEFAULT_WORK_DIR).replace(/\\/g, '/'), 'server/storage/attachment-judge', '실제 자료는 PC 작업 폴더(git 제외 server/storage)');
assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^server\/storage\/\*/m, 'server/storage는 git에 안 들어감');

// 합성 입력·가짜 Claude·가짜 대기열
const NAME = '홍길동'; const PHONE = '010-1234-5678';
const prompts = [];
const fakeClaude = answer => async (content, options) => { prompts.push({ content, options }); return { text: JSON.stringify(answer), model: 'claude-opus-5-5', usage: { input_tokens: 2000, output_tokens: 200 } }; };
const enqueued = [];
const fakeEnqueue = (b, det) => { enqueued.push({ b, det }); return { ...det, autoSend: false, manualReview: true, pendingRoom: true, astraRoomEventId: `AR-FAKE-${enqueued.length}`, reason: 'Astra 고객대응실 답변 대기' }; };
const videoQuote = minutes => require('../server/video-edit-quote').videoEditQuote({ volume: `${minutes}분` });
const chatBody = (extra = {}) => ({ conversationId: '240001', customerName: NAME, request: { customerName: NAME, soomgoCategory: '영상 편집' }, quote: { serviceId: 'video_edit' }, ...extra });
const deps = (extra = {}) => ({ cfg, state: {}, now: Date.parse('2026-09-24T15:00:00Z'), videoQuote, fetchImpl: async () => { throw new Error('fetch_not_expected'); }, ...extra });
const pdf3 = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 3/Kids[3 0 R 4 0 R 5 0 R]>>endobj\n% synthetic 3-page manuscript\n%%EOF\n').toString('base64');
const png1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  // 1) 원고 PDF 3쪽(문서 상담) → Claude 1번 · 이름·연락처 빠짐 · 금액은 서버가 확인 못 함 + 팔지 않는 상담 → 준희 알림(요약 + 초안)
  {
    const body = { conversationId: '240002', customerName: NAME, message: `원고 3쪽 정리 부탁드려요 ${PHONE}`, request: { customerName: NAME }, quote: { serviceId: 'document_writing' }, attachments: [{ name: '원고.pdf', mediaType: 'application/pdf', data: pdf3 }] };
    const before = prompts.length;
    const result = await aj.judge({ attachments: body.attachments, message: body.message, context: { serviceId: 'document_writing' }, names: [NAME], deps: deps({ runClaude: fakeClaude({ kind: '강의 원고 PDF', pages: 3, chars: 4200, scope: '원고 3쪽 서식 정리', serviceId: 'document_writing', amount: 30000, question: '원하시는 글꼴이 있을까요?', outOfScope: false, uncertain: false, concerns: [], reply: '원고 3쪽 확인했습니다. 서식 정리로 해 드릴 수 있습니다. 원하시는 글꼴이 있을까요?' }) }) });
    assert.equal(prompts.length - before, 1, '첨부 1건당 호출 1번');
    const sent = JSON.stringify(prompts[prompts.length - 1].content);
    assert.ok(!sent.includes(NAME) && !sent.includes(PHONE) && !sent.includes('1234-5678'), '이름·연락처가 호출에 없음');
    assert.equal(prompts[prompts.length - 1].options.model, 'claude-opus-5-5');
    assert.match(sent, /application\/pdf/, 'PDF는 문서로 보냄');
    assert.equal(result.logs[0].called, true); assert.ok(result.logs[0].krw > 0, '비용 기록');
    const reply = R.attachmentJudgeReply(body, result, { enqueue: fakeEnqueue });
    assert.equal(reply.autoSend, false); assert.equal(reply.manualReview, true); assert.equal(reply.templateKey, 'attachment_judge_alert');
    assert.match(reply.reason, /^첨부 판단 · 강의 원고 PDF/, '판단 요약');
    assert.match(reply.reason, /Claude 금액 30,000원은 서버가 계산할 수 없어 준희 확인/);
    assert.match(reply.reason, /보낼 문구 초안: 원고 3쪽 확인했습니다/, '보낼 문구 초안');
    assert.equal(enqueued.length, 0, '알림이면 자동 답장 대기열에 안 넣음');
  }

  // 2) 사진 1장(영상 편집 상담, 스토리보드) → Claude 1번 · 금액 없음 · 확인 질문 → 채팅 Claude가 [사실]로 답함(대기열)
  {
    const body = chatBody({ message: '이 순서대로 편집해 주실 수 있나요?', attachments: [{ name: 'storyboard.png', mediaType: 'image/png', data: png1 }] });
    const result = await aj.judge({ attachments: body.attachments, message: body.message, context: { ok: true, serviceId: 'video_edit' }, names: [NAME], deps: deps({ runClaude: fakeClaude({ kind: '스토리보드 사진', sheets: 1, scope: '장면 순서대로 컷 편집과 자막', serviceId: 'video_edit', amount: null, question: '원본 영상이 전체 몇 분인지 알려주실 수 있을까요?', outOfScope: false, uncertain: false, concerns: [], reply: '보내주신 스토리보드 확인했습니다. 이 순서대로 자르고 자막을 넣어 드릴 수 있습니다. 원본 영상이 전체 몇 분인지 알려주실 수 있을까요?' }) }) });
    assert.match(JSON.stringify(prompts[prompts.length - 1].content), /"type":"image"/);
    const reply = R.attachmentJudgeReply(body, result, { enqueue: fakeEnqueue });
    assert.equal(reply.templateKey, 'attachment_judge'); assert.equal(reply.pendingRoom, true); assert.equal(enqueued.length, 1);
    const det = enqueued[0].det;
    assert.match(det.factsText, /받은 자료: 스토리보드 사진 \(1장\) · 범위: 장면 순서대로 컷 편집과 자막/);
    assert.match(det.factsText, /확인 질문: 원본 영상이 전체 몇 분인지/);
    assert.equal(det.humanViaClaude, true, '지시 17·29 말투(채팅 Claude)로 답함');
    assert.ok(!det.factsText.includes(NAME), '이름 없음');
  }

  // 3) 짧은 합성 영상 → API로 안 보냄 · PC에서 ffprobe(없으면 ffmpeg)로 길이만 · 7-4 계산 69,000원
  {
    const ffmpeg = (() => { try { return require('../server/video-pipeline').resolveFfmpegPath(); } catch (_) { return null; } })()
      || (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 ? 'ffmpeg' : null);
    let data; let probe = null;
    if (ffmpeg) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aj20-src-'));
      const out = path.join(tmp, 'synthetic.mp4');
      const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=3', '-c:v', 'mpeg4', '-y', out], { windowsHide: true });
      assert.equal(made.status, 0, `합성 영상 만들기(${String(made.stderr || '').slice(0, 120)})`);
      data = fs.readFileSync(out).toString('base64');
    } else {
      data = Buffer.from('synthetic-video').toString('base64'); probe = async () => 3; // PC에는 C:\RelayDeskTools ffmpeg가 있다
    }
    const before = prompts.length;
    const body = chatBody({ message: '이 영상 편집 부탁드려요', attachments: [{ name: 'clip.mp4', mediaType: 'video/mp4', data }] });
    const result = await aj.judge({ attachments: body.attachments, message: body.message, context: { ok: true, serviceId: 'video_edit' }, names: [NAME], deps: deps({ ffmpegPath: ffmpeg, ...(probe ? { probeSeconds: probe } : {}), runClaude: async () => { throw new Error('video_must_not_go_to_api'); } }) });
    assert.equal(prompts.length, before, '영상 파일은 API로 나가지 않음');
    assert.equal(result.items[0].kind, 'video'); assert.equal(result.items[0].status, 'measured'); assert.equal(result.items[0].minutes, 1);
    assert.equal(result.serverAmount, 69000, '7-4 계산');
    assert.ok(result.facts.some(line => /금액\(서버 계산, 영상 편집 7-4 · 원본 1분\): 69,000원/.test(line)));
    assert.match(result.draft, /69,000원에 해 드릴 수 있습니다/);
    const saved = fs.readdirSync(cfg.workDir, { recursive: true }).filter(name => /\.mp4$/.test(String(name)));
    assert.equal(saved.length, 1, '영상은 PC 작업 폴더에만(여기선 임시 폴더)');
    const reply = R.attachmentJudgeReply(body, result, { enqueue: fakeEnqueue });
    assert.equal(reply.templateKey, 'attachment_judge');
    assert.match(enqueued[enqueued.length - 1].det.factsText, /69,000원/);
    assert.ok(R.validSoomgoAiReply('영상 확인했습니다. 원본 1분이면 69,000원에 해 드릴 수 있습니다.', `${enqueued[enqueued.length - 1].det.text}\n${enqueued[enqueued.length - 1].det.factsText}`, { requireNumbers: false }), '서버 금액은 답장에 쓸 수 있음');
    assert.ok(!R.validSoomgoAiReply('영상 확인했습니다. 79,000원에 해 드릴 수 있습니다.', `${enqueued[enqueued.length - 1].det.text}\n${enqueued[enqueued.length - 1].det.factsText}`, { requireNumbers: false }), '다른 금액은 불합격');
  }

  // 4) 유튜브 공개 링크 모양 URL(모의 fetch) → 공개 정보(제목·길이)만, 주소는 영상 ID로 새로 만듦 → 13분 129,000원
  {
    const asked = [];
    const fakeFetch = async (url, opts = {}) => {
      asked.push({ url: String(url), method: opts.method || 'GET' });
      const u = new URL(url);
      if (u.hostname !== 'www.youtube.com') throw new Error('unexpected_host');
      if (u.pathname === '/oembed') return { ok: true, status: 200, text: async () => JSON.stringify({ title: '합성 강의 영상', author_name: '채널' }) };
      if (u.pathname === '/watch') return { ok: true, status: 200, text: async () => '<html>..."lengthSeconds":"754"...</html>' };
      throw new Error('unexpected_path');
    };
    const body = chatBody({ message: '이 영상이에요 https://youtu.be/AbCdEfGhIjK?si=tracking123 편집 가능할까요' });
    assert.equal(aj.linksForJudge(body.message).length, 1, '유튜브 링크는 이 판단이 맡음');
    const result = await aj.judge({ attachments: [], message: body.message, context: { ok: true, serviceId: 'video_edit' }, names: [NAME], deps: deps({ fetchImpl: fakeFetch, runClaude: async () => { throw new Error('no_claude_for_links'); } }) });
    assert.deepEqual(asked.map(item => new URL(item.url).pathname), ['/oembed', '/watch']);
    assert.ok(asked.every(item => !item.url.includes('tracking123') && !item.url.includes('youtu.be/')), '고객 URL을 그대로 열지 않음(ID로 새 주소)');
    assert.equal(result.links[0].status, 'ok'); assert.equal(result.links[0].title, '합성 강의 영상');
    assert.equal(result.serverAmount, 129000, '13분 → 129,000원(7-4)');
    const reply = R.attachmentJudgeReply(body, result, { enqueue: fakeEnqueue });
    assert.equal(reply.templateKey, 'attachment_judge');
    // 비공개(oEmbed 401) → 알림
    const privateFetch = async () => ({ ok: false, status: 401, text: async () => '' });
    const priv = await aj.judge({ message: 'https://www.youtube.com/watch?v=AbCdEfGhIjK', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ fetchImpl: privateFetch }) });
    assert.equal(R.attachmentJudgeReply(chatBody({ message: 'x' }), priv, { enqueue: fakeEnqueue }).templateKey, 'attachment_judge_alert');
  }

  // 5) 모르는 사이트 링크 → 열지 않고 알림 / 실행 파일 링크·첨부 → 알림 / 단축 주소가 모르는 곳 → HEAD 한 번만, 본문 안 받음, 알림
  {
    let opened = 0;
    const neverFetch = async () => { opened += 1; throw new Error('must_not_open'); };
    const unknown = await aj.judge({ message: '자료는 여기 있어요 https://files.example-unknown.site/abc', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ fetchImpl: neverFetch }) });
    assert.equal(opened, 0, '모르는 사이트는 열지 않음');
    const unknownReply = R.attachmentJudgeReply(chatBody({ message: '자료는 여기 있어요' }), unknown, { enqueue: fakeEnqueue });
    assert.equal(unknownReply.templateKey, 'attachment_judge_alert'); assert.match(unknownReply.reason, /링크 열지 않음: 모르는 사이트\(files\.example-unknown\.site\)/);
    const exe = await aj.judge({ message: 'https://youtube.com.example.site/setup.exe', attachments: [{ name: '설치.exe', mediaType: 'application/x-msdownload', data: 'TVqQAAMAAAAEAAAA' }], context: { ok: true, serviceId: 'video_edit' }, deps: deps({ fetchImpl: neverFetch }) });
    assert.equal(opened, 0);
    assert.ok(exe.alerts.some(a => /실행 파일\(설치\.exe\)은 열지 않음/.test(a)) && exe.alerts.some(a => /실행 파일 링크/.test(a)));
    const heads = [];
    const shortFetch = async (url, opts = {}) => { heads.push({ url: String(url), method: opts.method, redirect: opts.redirect }); return { ok: false, status: 301, headers: { get: key => (key === 'location' ? 'https://login.unknown-drive.example/file/1' : null) } }; };
    const short = await aj.judge({ message: 'https://bit.ly/3abcXYZ', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ fetchImpl: shortFetch }) });
    assert.deepEqual(heads, [{ url: 'https://bit.ly/3abcXYZ', method: 'HEAD', redirect: 'manual' }], '단축 주소는 HEAD 한 번(따라가지 않음)');
    assert.ok(short.alerts.some(a => /단축 주소가 모르는 사이트\(login\.unknown-drive\.example\)로 감/.test(a)));
    assert.deepEqual(aj.linksForJudge('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'), [], '구글 문서만 있으면 기존 경로가 맡음');
  }

  // 6) 금지 주제(7-5)·안 하는 일·불확실 → 알림
  {
    const photo = { name: 'a.png', mediaType: 'image/png', data: png1 };
    const good = { kind: '사진', sheets: 1, scope: '컷 편집', serviceId: 'video_edit', amount: null, question: '몇 분인가요?', outOfScope: false, uncertain: false, concerns: [], reply: '확인했습니다.' };
    const r1 = await aj.judge({ attachments: [photo], message: '환불 되나요?', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ runClaude: fakeClaude(good) }) });
    assert.match(R.attachmentJudgeReply(chatBody({ message: '환불 되나요?' }), r1, { enqueue: fakeEnqueue }).reason, /금지 주제\(payment\)/);
    const r2 = await aj.judge({ attachments: [photo], message: '이걸로 모션그래픽 만들어 주세요', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ runClaude: fakeClaude({ ...good, outOfScope: true, scope: '모션그래픽' }) }) });
    const rep2 = R.attachmentJudgeReply(chatBody({ message: '이걸로 모션그래픽 만들어 주세요' }), r2, { enqueue: fakeEnqueue });
    assert.match(rep2.reason, /범위 밖 작업/); assert.match(rep2.reason, /우리가 안 하는 일 언급/);
    const r3 = await aj.judge({ attachments: [photo], message: '이거요', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ runClaude: fakeClaude({ ...good, uncertain: true }) }) });
    assert.match(R.attachmentJudgeReply(chatBody({ message: '이거요' }), r3, { enqueue: fakeEnqueue }).reason, /Claude 판단이 불확실/);
    const r4 = await aj.judge({ attachments: [photo], message: '이거요', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ runClaude: async () => ({ text: '모르겠습니다', usage: {} }) }) });
    assert.equal(R.attachmentJudgeReply(chatBody({ message: '이거요' }), r4, { enqueue: fakeEnqueue }).templateKey, 'attachment_judge_alert');
  }

  // 7) 비용: 7-5 상한에 포함(채팅봇 호출과 합쳐 하루 40회 · 월 금액) — 넘으면 부르지 않고 알림, 채팅봇 한도 계산에도 이 호출이 들어감
  {
    const day = aj.kstDay(Date.parse('2026-09-24T15:00:00Z'));
    const full = { customerRoomFallbackLog: Array.from({ length: 30 }, () => ({ day, called: true, krw: 1 })), attachmentJudgeLog: Array.from({ length: 10 }, () => ({ day, called: true, krw: 1 })) };
    let called = 0;
    const capped = await aj.judge({ attachments: [{ name: 'a.png', mediaType: 'image/png', data: png1 }], message: '', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ state: full, runClaude: async () => { called += 1; return { text: '{}' }; } }) });
    assert.equal(called, 0, '하루 40회(채팅봇 30 + 첨부 10)면 부르지 않음');
    assert.ok(capped.alerts.some(a => /daily_call_cap/.test(a)));
    const month = { quoteJudgeLog: [{ day, called: true, krw: fbCfg.monthlyBudgetKrw }] };
    const cappedMonth = await aj.judge({ attachments: [{ name: 'a.png', mediaType: 'image/png', data: png1 }], message: '', context: { ok: true, serviceId: 'video_edit' }, deps: deps({ state: month, runClaude: async () => { called += 1; return { text: '{}' }; } }) });
    assert.equal(called, 0); assert.ok(cappedMonth.alerts.some(a => /monthly_budget_cap/.test(a)), '월 금액은 채팅봇·견적 판단과 합쳐');
    const now = Date.parse('2026-09-24T15:00:00Z');
    assert.equal(fb.todayUsage({ attachmentJudgeLog: [{ day, called: true, krw: 5 }] }, now).calls, 1, '채팅봇 하루 한도에도 첨부 판단 호출이 들어감');
    assert.equal(fb.monthUsage({ attachmentJudgeLog: [{ day, called: true, krw: 5 }] }, now).krw, 5, '월 금액에도');
    // 한 메시지에 파일 3개 → 3번(파일마다 1번), 4번째 파일은 받지 않음
    let perFile = 0;
    await aj.judge({ attachments: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.png`, mediaType: 'image/png', data: png1 })), context: { ok: true, serviceId: 'video_edit' }, deps: deps({ runClaude: async () => { perFile += 1; return { text: JSON.stringify({ kind: '사진', reply: '확인' }), usage: {} }; } }) });
    assert.equal(perFile, 3, '첨부 1건당 1번, 최대 3건');
  }

  // 8) 서버 경로: 스위치가 켜졌을 때만 기존 판독(attachmentRead·link-inspector)을 건너뛰고 이 판단이 맡음, 기록은 state.attachmentJudgeLog
  assert.match(server, /const judgeCfg = body\.quoteReadFollowup === true \|\| workflowForConversation\(before, conversationId\) \? null : attachmentJudge\.readConfig\(readOperatingPolicy\(\)\);/);
  assert.match(server, /let linkReply = body\.quoteReadFollowup === true \|\| judgeHandles \|\|/);
  assert.match(server, /const attachmentRead = body\.quoteReadFollowup === true \|\| judgeHandles \|\|/);
  assert.match(server, /attachmentJudge\.appendLog\(current, entry\)/);
  assert.match(server, /kind: reply\.attachmentRead \|\| reply\.attachmentJudge \? 'attachment' : 'chat'/, '알림 목록에 첨부로 표시');
  assert.equal(netCalls, 0, '외부 호출 없음');
  console.log('attachment-judge-20: ok');
})().catch(error => { console.error(error); process.exit(1); });
