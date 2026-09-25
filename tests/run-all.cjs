'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = [
  ['회귀 15건', 'tests/service-regression-baseline.cjs'],
  ['서비스 정의·분류', 'tests/service-definitions-stage1.cjs'],
  ['서비스 레지스트리 22건', 'tests/service-registry-stage2-1.cjs'],
  ['채팅 문구 서버 이관', 'tests/message-registry-stage2-4-0b.cjs'],
  ['숨고 견적봇 서버 분류', 'tests/soomgo-quote-extension-stage2-4-1.cjs'],
  ['크몽 분류·자동화', 'tests/kmong-automation.cjs'],
  ['기계 검사 샘플 28개', 'tests/quality-runner-stage4-2.cjs'],
  ['싱크 검사 샘플', 'tests/sync-drift-stage4-3.cjs'],
  ['4-4 납품 차단', 'tests/quality-delivery-stage4-4.cjs'],
  ['최종 채점 manual 모드', 'tests/final-grade-mode.cjs'],
  ['납품 계약', 'tests/workflow-delivery-contract.cjs'],
  ['속기 도장 삭제·비상 판정', 'tests/stenography-seal-emergency.cjs'],
  ['제작 제공자 전환', 'tests/production-provider-claude.cjs'],
  ['요청봇 스마트견적 나가기·삭제', 'tests/soomgo-bot-smartquote-exit.cjs'],
  ['문서 가격표', 'tests/pricing-table-document.cjs'],
  ['자체 재시작', 'tests/self-restart.cjs'],
  ['고객 링크 판단', 'tests/link-inspector.cjs'],
  ['상담 보강 규칙', 'tests/reply-guards.cjs'],
  ['첨부 판독·알림 목록', 'tests/attachment-reader.cjs'],
  ['워드·한글·링크 판독', 'tests/office-text.cjs'],
  ['견적 사람 확인 알림', 'tests/quote-review-attention.cjs'],
  ['제작 hold (API 0회)', 'tests/production-hold.cjs'],
  ['숨고 카테고리 분류·재방문 방지', 'tests/soomgo-category-classify.cjs'],
  ['숨고 자동 처리 규칙(D\')', 'tests/soomgo-auto-rules.cjs'],
  ['Jev 키 칸 (호출 0회)', 'tests/jev-key-slot.cjs'],
  ['Jev 내부 시뮬레이션 (가짜 호출)', 'tests/jev-simulation.cjs'],
  ['제브가 찾은 채팅 오판', 'tests/chat-jev-findings.cjs'],
  ['자막 검사 기준 v2', 'tests/subtitle-checks-v2.cjs'],
  ['자막 번역 가산·문구 일치', 'tests/subtitle-translation-pricing.cjs'],
  ['기본 수정 횟수(자막 2·문서 3)', 'tests/revision-included.cjs'],
  ['9/22 고객 답장 오답 수정', 'tests/chat-fixes-20260922.cjs'],
  ['숨고 시스템 알림·시험 메시지 제외', 'tests/system-notice-guard.cjs'],
  ['Jev 품질 실험 등록·정답 비교 (실행 0회)', 'tests/jev-quality-experiments.cjs'],
  ['Jev 대량 합성 표본 3,000개×4 (실행 0회)', 'tests/jev-synthetic.cjs'],
  ['PPT 디자인 유형 규칙 (미연결)', 'tests/presentation-design-types.cjs'],
  ['요청봇 삭제 버튼 범위(10명 마감만)', 'tests/request-bot-delete-scope.cjs'],
  ['학교 과제 수정 2회·자료조사 1만원', 'tests/school-assignment-revisions.cjs'],
  ['제브 실행 이어 돌리기 (가짜 호출)', 'tests/jev-resume.cjs'],
  ['빈 요청(화면 로딩 전) 거절', 'tests/empty-request-guard.cjs'],
  ['요청봇 카드 키 겹침 방지', 'tests/request-bot-card-key.cjs'],
  ['고객응대실 합치기 (Astra→Claude→정해진 문구, 가짜 호출)', 'tests/customer-room-fallback.cjs'],
  ['채팅봇 존댓말 필수', 'tests/honorific-guard.cjs'],
  ['식전영상·길이 모름 자동 견적(하루 30건)', 'tests/video-materials-quote.cjs'],
  ['지시 32 결제·흥정은 챗봇이(할인 85%·한 번)', 'tests/chat-payment-32.cjs'],
  ['알림방 같은 이상 중복 방지', 'tests/attention-dedupe.cjs'],
  ['깔때기 숫자에서 자체 점검 기록 제외', 'tests/funnel-synthetic-filter.cjs'],
  ['견적 발송 결과 미기록 알림', 'tests/quote-result-missing.cjs'],
  ['깔때기 답장 수는 고객이 쓴 말만', 'tests/funnel-human-replies.cjs'],
  ['짧은 승낙은 고용 요청으로·거절엔 감사 인사', 'tests/hire-path.cjs'],
  ['판매 안 하는 카테고리 삭제 유지', 'tests/unsold-category-block.cjs'],
  ['요청봇 PPT→문서→자막 우선', 'tests/request-bot-priority.cjs'],
  ['견적 결과 보고 예약·재전송', 'tests/quote-result-recovery.cjs'],
  ['견적 결과 순서 뒤바뀜 막기', 'tests/quote-result-order.cjs'],
  ['숨고 안내 3종 알림 분류', 'tests/soomgo-notice-classify.cjs'],
  ['P4 후속 답장 A·B·C', 'tests/p4-followup-replies.cjs'],
  ['채팅봇 발송 끔·Claude 대체 끔', 'tests/chat-send-off.cjs'],
  ['Astra 숨고 답장 기록', 'tests/astra-chat-log.cjs'],
  ['감사 인사(견적 첫 줄·나중에 연락 답장)', 'tests/thanks-copy.cjs'],
  ['PPT 디자인 샘플 자동 발송', 'tests/ppt-design-sample.cjs'],
  ['Claude 견적 판단·자동 발송 (가짜 호출)', 'tests/claude-quote.cjs'],
  ['견적 문구의 거래 확정 안내를 고용으로 오판 금지', 'tests/hired-detection-quote-text.cjs'],
  ['단가 질문 가격표 답변', 'tests/unit-price-reply.cjs'],
  ['제작 파이프라인 A/B/C 시뮬레이터 (가짜 호출)', 'tests/pipeline-sim.cjs'],
  ['Jev 납품 검수 · 번역 자막 내용 대조 (가짜 호출)', 'tests/jev-review.cjs'],
  ['파이버 채널 정의(승인 전)', 'tests/fiverr-channel.cjs'],
  ['파이버 영어 답장 초안 (가짜 호출)', 'tests/global-reply.cjs'],
  ['자동 유료 API 차단·대기열 Claude 스위치 (가짜 호출)', 'tests/paid-api-guard.cjs'],
  ['로컬 전사 모듈 T-3 (가짜 실행)', 'tests/transcribe.cjs'],
  ['자막 초벌 T-4: 기준 맞춘 SRT 초안·기계 검사·워크플로 연결·FFmpeg 경로', 'tests/subtitle-draft.cjs'],
  ['T-5 측정 도구: 스레드 지정·CPU 표본·샘플 받기·자막 입히기 (가짜 실행)', 'tests/t5-tools.cjs'],
  ['싱크 검사 v3: 실제 10분 전사로 중간부터 점점 밀림 재현(시작 블록·보정 재검사)', 'tests/sync-drift-v3.cjs'],
  ['시각만으로 맞추기(번역 자막용): 말·쉼 구간과 자막 시각만 비교', 'tests/timing-align.cjs'],
  ['S-2 전사 모델 고르기·용어 목록 (가짜 실행)', 'tests/transcribe-terms.cjs'],
  ['Jev 내용 대조 한 건: 앞·뒤 블록 비교로 한 칸 밀림 찾기 (가짜 Jev)', 'tests/jev-probe.cjs'],
  ['S-3 번인 자막 위치(아래·위·여백)', 'tests/burnin-position.cjs'],
  ['번역 자막 두 단계 싱크 검사: 판정·상한·가림 (가짜 Jev)', 'tests/translated-sync.cjs'],
  ['PPT 제작 Codex 대화방 경로: 사건·답 검사·PPTX (유료 API 0)', 'tests/codex-production.cjs'],
  ['번역 자막 Codex 대화방 경로: 조각·답 검사·원어 시각 그대로 SRT (유료 API 0)', 'tests/codex-subtitle-translation.cjs'],
  ['PPTX 글꼴 넣기(Node판 = embed-fonts.py 결과)', 'tests/pptx-embed-fonts.cjs'],
  ['Astra 운영 기준 생성물 = 견적 함수 계산값·판매 안 함·고객용 줄 할인 없음', 'tests/astra-brief.cjs'],
  ['영상 편집 견적 계산·자동 발송 없음 (합성 입력)', 'tests/video-edit-quote.cjs'],
  ['채팅 답장 안전 수정(금지 주제·한도·말투·영상 편집, 스위치 꺼짐)', 'tests/chat-guard-7-5.cjs'],
  ['말투 규칙 블록이 챗봇 프롬프트에 없음(지시 29, 합성 3건)', 'tests/tone-human-newcomer.cjs'],
  ['영상 편집 자동 견적(스위치 기본 꺼짐)·틀린 자동 문구 6개 (지시 24)', 'tests/video-auto-quote-24.cjs'],
  ['숨고 문서·교정·PPT 자동 견적 멈춤(보내지 않음·삭제 안 함, 지시 27)', 'tests/soomgo-pause-27.cjs'],
  ['채팅 답장 지연·안부 멘트 시각·120자 나누기·AI 티 점검 (지시 28)', 'tests/chat-timing-28.cjs'],
  ['챗봇 붙여넣기 방식 + 고객 말은 Claude가 답함 (지시 29·30)', 'tests/chat-paste-29-30.cjs'],
  ['영상 편집 견적 말투(준희 예시)·31~69분·섞인 편집·끝이 열린 길이 (지시 25)', 'tests/video-auto-quote-25.cjs'],
  ['견적 판단(Claude, 스위치 기본 꺼짐)·합성 5건·한도 (지시 19)', 'tests/quote-judge-19.cjs'],
  ['고객 첨부 판단(Claude, 스위치 기본 꺼짐)·합성 첨부 5건·영상은 길이만 (지시 20)', 'tests/attachment-judge-20.cjs'],
  ['Claude 사용 단가 = 정책 claudeQuote', 'tests/claude-usage-rate.cjs']
];

const results = [];
for (const [name, script] of suites) {
  const run = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }
  });
  const passed = run.status === 0;
  results.push({ name, script, passed, exitCode: run.status });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${name} (${script})\n`);
  if (!passed) {
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    process.exitCode = 1;
    break;
  }
}

const passed = results.filter(item => item.passed).length;
process.stdout.write(`\n전체 결과: ${passed}/${suites.length} 통과\n`);
if (passed !== suites.length) process.exitCode = 1;
