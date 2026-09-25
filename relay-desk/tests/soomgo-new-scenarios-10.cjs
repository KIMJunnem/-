const assert = require('node:assert/strict');

const endpoint = 'http://127.0.0.1:8787/api/soomgo/reply';
const seed = Date.now();

const scenarios = [
  {
    name: '예산이 부족한 고객의 가격 협상',
    message: '예산이 2만원인데 조금 할인해 주실 수 있나요?',
    history: '[고객 요청] 회사 소개서 문장 정리 5쪽',
    quote: { amount: 29000, regularAmount: 41000, days: '당일~1일', basicScope: 'A4 5쪽 문장 정리·수정 1회', extraScope: '추가 페이지와 추가 수정은 별도' },
    check: r => r.manualReview && r.templateKey === 'manual_billing'
  },
  {
    name: '워드와 PDF 동시 납품 요청',
    message: '완성본은 워드하고 PDF 두 파일로 받을 수 있나요?',
    history: '[고객 요청] 사내 안내문 정리',
    quote: { amount: 19000, days: '당일~1일', basicScope: 'A4 3쪽·수정 1회' },
    check: r => r.autoSend && /워드/.test(r.text) && /PDF/.test(r.text)
  },
  {
    name: '민감한 회사 자료의 보안 문의',
    message: '회사 내부자료라 외부 유출이 걱정되는데 비밀 보장되나요?',
    history: '[고객 요청] 내부 업무 매뉴얼 교정',
    quote: { amount: 35000, days: '당일~1일', basicScope: '업무 매뉴얼 10쪽 교정' },
    check: r => r.autoSend && /비밀|보안|내부자료|외부|약정/.test(r.text)
  },
  {
    name: '화상회의를 요구하는 고객',
    message: '오늘 저녁 줌으로 화상 미팅하면서 같이 작성하고 싶어요.',
    history: '[고객 요청] 사업 소개 자료',
    quote: { amount: 49000, days: '당일~1일' },
    check: r => r.manualReview && r.templateKey === 'manual_direct'
  },
  {
    name: '채팅만 원하는 비대면 고객',
    message: '통화 없이 온라인 채팅으로만 진행 가능한가요?',
    history: '[고객 요청] 블로그 원고 교정',
    quote: { amount: 19000, days: '당일~1일' },
    check: r => r.autoSend && /채팅|온라인|비대면/.test(r.text)
  },
  {
    name: '숨고의 견적 열람 시스템 알림',
    message: '고객님이 견적을 읽었습니다',
    history: '',
    quote: { amount: 19000, days: '당일~1일' },
    check: r => r.skip && !r.autoSend
  },
  {
    name: '이미 고용된 고객의 추가 메시지',
    message: '파일은 여기 첨부하면 되나요?',
    history: '[시스템] 고객이 고용을 확정했습니다\n[고객] 파일은 어디로 보내나요?',
    quote: { amount: 29000, days: '당일~1일' },
    check: r => r.skip && r.templateKey === 'manual_hired'
  },
  {
    name: '대본 제작 요청',
    message: '유튜브 영상 대본 10분짜리 작성 가능하세요?',
    history: '[고객 요청] 영상 콘텐츠 제작',
    quote: { amount: 39000, days: '당일~1일' },
    check: r => r.manualReview && r.templateKey === 'manual_script'
  },
  {
    name: '고객의 의미 없는 짧은 반응',
    message: '??',
    history: '[내 답변] 작업 범위와 가격을 안내했습니다.',
    quote: { amount: 29000, days: '당일~1일' },
    check: r => r.skip && r.templateKey === 'low_signal'
  },
  {
    name: '취소와 환불을 묻는 고객',
    message: '진행하다가 취소하면 환불은 어떻게 되나요?',
    history: '[고객 요청] 제품 소개서 작성',
    quote: { amount: 49000, days: '1~2일' },
    check: r => r.manualReview && r.templateKey === 'manual_billing'
  }
];

async function run() {
  const results = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: `SIM-NEW-${seed}-${index + 1}`,
        messageId: `MSG-${seed}-${index + 1}`,
        message: scenario.message,
        conversationText: scenario.history,
        quote: scenario.quote
      })
    });
    assert.equal(response.ok, true, `${scenario.name}: HTTP ${response.status}`);
    const payload = await response.json();
    const reply = payload.reply || {};
    const passed = Boolean(scenario.check(reply));
    results.push({ name: scenario.name, passed, reply });
  }
  for (const result of results) {
    console.log(`[${result.passed ? 'PASS' : 'FAIL'}] ${result.name}`);
    console.log(`  action=${result.reply.templateKey || 'ai'} auto=${Boolean(result.reply.autoSend)} manual=${Boolean(result.reply.manualReview)} skip=${Boolean(result.reply.skip)} provider=${result.reply.aiProvider || '-'}`);
    console.log(`  ${result.reply.text || result.reply.reason || '(no response)'}`);
  }
  assert.equal(results.every(result => result.passed), true, 'one or more new simulations failed');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
