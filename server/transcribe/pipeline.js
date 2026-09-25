'use strict';

// 자막 제작 초벌(2026-09-22, T-4). 로컬 전사 → SRT 초안(checkParams 기준) → 기계 검사(quality-runner) → 결과 저장.
// - 한국어 영상: draft.srt가 초안. 기계 검사 결과를 quality.json으로 같이 둔다.
// - 외국어 영상: 같은 방식으로 만든 원어 SRT를 source.srt로 보관(내부 파일, 납품 안 함)하고,
//   번역은 C-2 대기열(state.translationQueue)에 자리만 만든다. 번역 자체는 이 단계 범위 밖.
// - workflowId가 오면 해당 워크플로에 independentTranscript(싱크 검사용)·subtitleDraft·sourceLanguageSrt를 기록한다.
//   → qualityContextForWorkflow가 이 값을 읽어 sync_drift·srt_coverage가 manual_review 대신 자동 판정한다.
// - 유료 API·외부 전송 없음. 납품·발송하지 않는다(초안만).

const fs = require('node:fs');
const path = require('node:path');
const transcribe = require('./index');

const KOREAN = 'ko';

function summarizeQuality(q) {
  return { status: q.status, passed: q.passed, failures: (q.failures || []).map(f => ({ id: f.id, status: f.status, detail: f.detail, location: f.location })), checks: (q.results || []).map(r => ({ id: r.id, status: r.status })) };
}

async function prepareSubtitleSource({ policy, inputPath, language = '', workflowId = null, checkParams, runChecks, readState, writeState, threads = null, model = null, terms = null, termMode = 'hotwords', transcribeImpl = transcribe.transcribe, now = Date.now() }) {
  // 용어 목록(S-2): 직접 준 것 + 워크플로 주문 정보(request.terms / request.glossary / terms)
  let termList = terms;
  if (!termList && workflowId && typeof readState === 'function') {
    try {
      const wf = (readState().soomgoWorkflows || []).find(item => String(item.id) === String(workflowId));
      termList = wf?.request?.terms || wf?.request?.glossary || wf?.terms || null;
    } catch (_) { termList = null; }
  }
  const t = await transcribeImpl({ policy, inputPath, language, checkParams, threads, model, terms: termList, termMode });
  if (!t.ok) return { ok: false, stage: 'transcribe', error: t.error };
  const dir = path.dirname(t.transcriptPath);
  const lang = String(t.language || language || '').toLowerCase();
  const independentTranscript = { path: t.checksTranscriptPath || t.transcriptPath, raw: t.transcriptPath, jobId: t.jobId, language: lang };
  const out = { ok: true, jobId: t.jobId, language: lang, languageProbability: t.languageProbability, duration: t.duration, elapsedSeconds: t.elapsedSeconds, threads: t.threads, model: t.model, terms: t.terms, cpu: t.cpu, independentTranscript };
  if (lang === KOREAN) {
    const quality = runChecks('subtitle', { path: t.srtPath }, { independentTranscript: { path: independentTranscript.path }, translated: false });
    const summary = summarizeQuality(quality);
    fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify({ checkedAt: new Date(now).toISOString(), ...summary }, null, 2));
    out.kind = 'korean_draft';
    out.draft = { srtPath: t.srtPath, qualityPath: path.join(dir, 'quality.json'), quality: summary };
  } else {
    const sourcePath = path.join(dir, 'source.srt');
    fs.copyFileSync(t.srtPath, sourcePath);
    out.kind = 'foreign_source';
    out.sourceLanguageSrt = { path: sourcePath, language: lang };
    out.translation = { status: 'waiting_c2', note: '번역은 C-2 대기열에서 처리(이번 범위 아님)' };
  }
  if (workflowId && readState && writeState) {
    const latest = readState();
    const wf = (Array.isArray(latest.soomgoWorkflows) ? latest.soomgoWorkflows : []).find(item => String(item.id) === String(workflowId));
    if (!wf) return { ...out, workflowUpdated: false, workflowError: 'workflow_not_found' };
    wf.independentTranscript = independentTranscript;
    if (out.kind === 'korean_draft') wf.subtitleDraft = { ...out.draft, jobId: t.jobId, createdAt: new Date(now).toISOString() };
    else {
      wf.sourceLanguageSrt = out.sourceLanguageSrt;
      const queue = Array.isArray(latest.translationQueue) ? latest.translationQueue : [];
      if (!queue.some(item => item.workflowId === wf.id && item.jobId === t.jobId)) {
        queue.unshift({ id: `TQ-${t.jobId}`, workflowId: wf.id, jobId: t.jobId, sourceLanguage: lang, sourceSrtPath: out.sourceLanguageSrt.path, transcriptPath: independentTranscript.path, targetLanguage: 'ko', status: 'waiting_c2', createdAt: new Date(now).toISOString() });
      }
      latest.translationQueue = queue.slice(0, 200);
    }
    wf.updatedAt = new Date(now).toISOString();
    writeState(latest);
    out.workflowUpdated = true;
  }
  return out;
}

module.exports = { prepareSubtitleSource, summarizeQuality };
