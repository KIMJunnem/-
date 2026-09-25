'use strict';

// 상담 단계 채팅 보강 규칙(2026-09-21). soomgoReply의 기존 규칙보다 먼저 확인한다.
// 목적: 고객 질문을 무시하는 일반 안내문, 인수인계 규칙 위반(나간 고객에게 발송,
// 숨고 밖 거래 수락 등)을 막는다. 금액·일정처럼 사람이 정할 내용은 자동 발송하지
// 않고 초안과 함께 담당자 확인으로 넘긴다.

const LARGE_FILE_TEXT = '파일 용량이 커서 숨고 채팅으로 전송되지 않는 경우에는 pd960723@gmail.com으로 보내 주세요. 메일 제목에 숨고 고객명과 의뢰 종류를 적어 주시고, 전송 후 이 채팅에 “메일 보냈습니다”라고 남겨 주시면 바로 확인하겠습니다.';

// 숨고 시스템 알림(2026-09-22 준희 지시): '숨고 알리미'·'숨고페이'·'거래가 성사됐다면'으로 시작하는 알림은
// 고객 메시지가 아니므로 답장하지 않는다(intent system_notice).
// - '숨고페이'는 알림 제목 형태(뒤에 고객에게/서비스를 진행해 주세요/안전결제 잊지/거래 확정…)만 본다.
//   고객이 쓴 "숨고페이로 결제했어요", "숨고페이 결제 완료했습니다"는 알림이 아니다.
// - 고객이 알림을 두고 묻는 말("숨고 알리미 떴는데 이거 뭐예요?")은 제외한다.
// - '고객이 요청사항을 추가했습니다' 알림은 고객이 쓴 내용이 들어 있어, 답장은 하지 않되 사람 확인으로 넘긴다.
const SYSTEM_NOTICE_HEAD = /^(?:숨고\s*알리미|거래가\s*성사\s*됐다면|숨고\s*페이\s+(?:고객에게|고객님께|서비스를\s*진행해\s*주세요|안전\s*결제\s*잊지|거래\s*확정|결제가\s*완료되었|정산))/;
const CUSTOMER_ABOUT_NOTICE = /떴는데|왔는데|받았는데|이거\s*뭐|뭐(?:예요|에요|죠|지)|무슨\s*(?:뜻|말)/;
function isSystemNoticeHead(m) { return SYSTEM_NOTICE_HEAD.test(m) && !CUSTOMER_ABOUT_NOTICE.test(m); }

const RULES = [
  {
    key: 'system_notice',
    test: m => isSystemNoticeHead(m) && /고객이\s*요청사항을\s*추가했/.test(m),
    reply: { autoSend: false, manualReview: true, skip: false, intent: 'system_notice', reason: '숨고 알림(고객 요청사항 추가) · 답장하지 않고 담당자가 추가 내용을 확인' }
  },
  {
    key: 'system_notice',
    test: m => isSystemNoticeHead(m),
    reply: { autoSend: false, manualReview: false, skip: true, intent: 'system_notice', reason: '숨고 시스템 알림 · 답장하지 않음' }
  },
  {
    key: 'guard_customer_left',
    test: m => /님이\s*채팅방을\s*나갔습니다|채팅방을\s*나갔습니다|대화방을\s*나갔습니다/.test(m),
    reply: { autoSend: false, manualReview: false, skip: true, closeConversation: true, reason: '고객이 채팅방을 나감 · 후속 메시지 중단' }
  },
  {
    key: 'guard_hired_other',
    test: m => /다른\s*고수(?:님)?를?\s*(?:고용|선택)했|다른\s*고수(?:님)?(?:과|와|랑|한테|에게)\s*(?:진행|하기로|계약|맡기)|다른\s*(?:분|곳|업체)(?:과|와|랑|에)\s*(?:진행|하기로|맡기)|이미\s*(?:다른\s*)?(?:분|곳|고수)(?:을|를)?\s*(?:구했|정했|찾았)|(?:의뢰|작업)?\s*진행(?:은|을)?\s*안\s*하기로|진행하지\s*않기로/.test(m),
    reply: { autoSend: false, manualReview: false, skip: true, closeConversation: true, reason: '고객이 다른 고수를 선택하거나 진행하지 않기로 함 · 후속 메시지 중단' }
  },
  {
    key: 'guard_off_platform',
    test: m => /숨고\s*(?:밖|외부|말고)|직거래|계좌\s*(?:로|이체)\s*(?:바로|직접)|수수료\s*(?:없이|아끼)|외부\s*(?:결제|거래)/.test(m),
    reply: { autoSend: true, manualReview: false, text: '안전거래를 위해 결제와 진행은 숨고 안에서만 하고 있습니다. 작업 조건을 이 채팅에 남겨 주시면 바로 확인해서 금액과 일정을 알려드리겠습니다.' }
  },
  {
    key: 'guard_meeting',
    test: m => /만나서|대면|직접\s*(?:만나|뵙|방문)|방문\s*(?:해|가능)|오프라인\s*(?:미팅|상담)|미팅\s*(?:가능|할\s*수)/.test(m),
    reply: { autoSend: true, manualReview: false, text: '작업은 온라인으로만 진행하고 있어 대면 상담은 어렵습니다. 필요한 내용과 자료를 이 채팅에 남겨 주시면 바로 확인해서 금액과 일정을 알려드리겠습니다.' }
  },
  {
    key: 'guard_personal_id',
    test: m => /주민\s*(?:등록)?\s*번호|신분증|여권\s*번호|카드\s*번호|계좌\s*비밀번호/.test(m),
    reply: { autoSend: true, manualReview: false, text: '주민등록번호나 신분증, 카드번호 같은 개인 식별 정보는 필요하지 않습니다. 보내지 않으셔도 됩니다.' }
  },
  {
    key: 'large_file_email',
    test: m => /(?:파일|자료|영상|녹음).{0,15}(?:너무\s*)?(?:커서|크다|커요|용량).{0,20}(?:안\s*(?:올라|보내|가)|못\s*(?:올리|보내)|전송|첨부|업로드)|(?:안\s*올라가|업로드가?\s*안\s*돼)/.test(m),
    reply: { autoSend: true, manualReview: false, text: LARGE_FILE_TEXT }
  },
  {
    // 학교 과제 작성 자체는 기존 판매 범위(자동 접수)다. 표절·AI 검사 통과를 조건으로
    // 거는 요청만 거절한다(인수인계: 표절 요청 금지).
    key: 'guard_plagiarism_evasion',
    test: m => /카피\s*킬러|gpt\s*킬러|표절\s*(?:률|율|검사)|ai\s*(?:탐지|판별|검출)|zero\s*gpt|turnitin/i.test(m),
    reply: {
      autoSend: true, manualReview: false, reason: '표절·AI 검사 통과 조건 요청 · 정중히 거절',
      text: '표절률이나 AI 판별 결과를 특정 수치 아래로 맞춰야 하는 조건의 작업은 진행하지 않습니다. 이 조건 없이 필요한 문서 작업이 있으면 말씀해 주세요.'
    }
  },
  {
    key: 'guard_price_negotiation',
    test: m => /(?:좀\s*더|조금\s*더|더)\s*(?:싸게|저렴|깎|할인)|깎아|네고|너무\s*비싸|가격\s*(?:조정|협의|낮)|\d[\d,]*\s*원(?:에|으로)\s*(?:해|가능|안\s*될)/.test(m),
    reply: {
      // D'(2026-09-21 준희 승인): 흥정은 금액을 유지하고 범위 조정안을 자동으로 보낸다.
      autoSend: true, manualReview: false, reason: '가격 흥정 · 금액 유지, 범위 조정안 안내',
      text: '지금 금액은 요청하신 분량을 기준으로 한 기본 가격이라 따로 할인해 드리기는 어렵습니다. 대신 분량이나 작업 범위를 줄이시면 그 기준으로 다시 계산해 드리겠습니다. 줄이고 싶은 부분이 있으신가요?'
    }
  },
  {
    key: 'guard_customer_frustrated',
    test: m => /(?:왜|언제).{0,8}(?:답|연락|대답).{0,6}(?:없|안)|답(?:변|장)\s*(?:좀|주세요|부탁)|확인\s*(?:하셨|했)나요|아까\s*(?:보낸|말씀)|읽고\s*(?:답|왜)|씨발|시발|ㅅㅂ|개새|존나|장난\s*하/.test(m),
    reply: { autoSend: false, manualReview: true, urgent: true, reason: '고객 재촉·불만 · 담당자가 바로 직접 답변 필요' }
  },
  {
    // 고객이 준비가 늦어진다고 알릴 때: 짧게 받고 기다린다(2026-09-22, 고객 …8811 사례).
    key: 'guard_customer_waiting',
    test: m => !/[?？]/.test(m) && /(?:아직|좀|조금|나중에|천천히).{0,12}(?:안\s*나와|안\s*됐|준비|정리|기다려|걸릴|걸려|보낼게|드릴게|연락)|(?:기다려야|기다려\s*주세요|기다려주세요)/.test(m),
    reply: { autoSend: true, manualReview: false, text: '네, 준비되시면 편하게 보내주세요.' }
  },
  {
    // 도면·CAD·물량 산출은 판매하지 않는다(2026-09-22, 고객 …3346 사례).
    key: 'guard_unsupported_cad',
    test: m => /오토\s*캐드|autocad|\bcad\b|캐드|도면\s*(?:작성|제작|수정|변환|작업)|물량\s*(?:산출|산정)|적산/i.test(m),
    reply: { autoSend: true, manualReview: false, text: '죄송하지만 도면·CAD 작업이나 물량 산출은 하지 않고 있습니다.' }
  },
  {
    key: 'guard_human_question',
    test: m => /사람이\s*(?:하|작업|쓰|직접)|사람\s*맞(?:죠|나요|아요)|직접\s*(?:하시|작업하시|쓰시)나요|봇\s*(?:이에요|인가요|아니)|자동\s*(?:답변|응답)\s*(?:인가요|이에요)/.test(m),
    reply: { autoSend: true, manualReview: false, text: '상담 답변은 자동 응답을 함께 쓰고 있고, 작업 초안에는 AI 도구를 보조로 활용합니다. 결과물은 보내드리기 전에 담당자가 직접 확인합니다.' }
  },
  {
    key: 'guard_spam',
    test: m => /부업\s*(?:하실|모집)|광고\s*(?:입니다|문의)|수익\s*보장|투자\s*(?:권유|리딩)|텔레그램|선착순\s*모집/.test(m),
    reply: { autoSend: false, manualReview: false, skip: true, reason: '광고·스팸 메시지 · 답변하지 않음' }
  },
  {
    key: 'guard_attachment_notice',
    test: m => /^(?:사진|이미지|파일|동영상|영상|음성\s*메시지|녹음)을?\s*보냈습니다\.?$/.test(m.trim()),
    reply: { autoSend: false, manualReview: true, reason: '고객이 파일·사진을 보냄 · 내용 확인 후 금액·일정 답변 필요', text: '보내주신 자료 잘 받았습니다. 분량과 내용을 확인해서 금액과 완료 날짜를 바로 알려드리겠습니다.' }
  },
  {
    key: 'guard_emoji_only',
    test: m => /^\(?(?:이모티콘|스티커)\)?$|^[\p{Extended_Pictographic}\s]+$/u.test(m.trim()),
    reply: { autoSend: false, manualReview: false, skip: true, reason: '이모티콘·스티커만 있는 메시지 · 답변하지 않음' }
  }
];

function soomgoReplyGuard(message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const rule = RULES.find(item => item.test(text));
  if (!rule) return null;
  return { templateKey: rule.key, ...rule.reply, text: rule.reply.text || '' };
}

module.exports = { soomgoReplyGuard, RULES, LARGE_FILE_TEXT, isSystemNoticeHead };
