const assert = require('node:assert/strict');
const { workflowPaymentAmount } = require('../server/relay-server.js');

const origin = 'http://127.0.0.1:8787';
const runId = Date.now();

async function storeFile(name, text, mime = 'text/plain; charset=utf-8') {
  const response = await fetch(`${origin}/api/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mime, dataBase64: Buffer.from(text, 'utf8').toString('base64') })
  });
  assert.equal(response.ok, true, `file upload failed: ${response.status}`);
  return response.json();
}

async function run() {
  const events = [];
  const customerBrief = [
    '의뢰: 교양 과제 레포트',
    '주제: 광고홍보의 한계와 개선 방향',
    '분량: A4 2쪽',
    '형식: 워드 원고용 텍스트',
    '마감: 내일',
    '추가 요청: 공개자료 조사와 표 1개'
  ].join('\n');
  const intake = await storeFile(`simulation-customer-brief-${runId}.txt`, customerBrief);
  events.push(['고객 파일 접수', intake.file?.serverPath || intake.path]);

  const workflow = {
    quote: { amount: 29000, days: '당일~1일', basicScope: 'A4 2쪽·수정 1회' },
    additionalFees: []
  };
  assert.equal(workflowPaymentAmount(workflow), 29000);
  events.push(['기본 견적 확정', '29,000원']);

  const firstDraft = [
    '광고홍보의 한계와 개선 방향',
    '',
    '1. 서론',
    '광고홍보는 소비자와 기업을 연결하지만 정보 과잉과 신뢰 저하라는 한계를 가진다.',
    '',
    '2. 주요 한계',
    '- 과도한 노출로 인한 광고 피로',
    '- 개인정보 기반 표적 광고에 대한 거부감',
    '- 과장 표현과 실제 경험의 불일치',
    '',
    '3. 개선 방향',
    '출처를 명확히 표시하고 소비자가 광고 설정을 통제할 수 있도록 해야 한다.',
    '',
    '[표 1] 문제-영향-개선 방향 요약',
    '정보 과잉 | 주목도 저하 | 빈도 제한',
    '개인정보 우려 | 신뢰 저하 | 동의와 설정권 강화',
    '과장 표현 | 불만 증가 | 근거 표시 강화'
  ].join('\n');
  const first = await storeFile(`simulation-first-draft-${runId}.txt`, firstDraft);
  const firstDownload = await fetch(`${origin}${first.file?.serverPath || first.path}`);
  assert.equal(firstDownload.ok, true);
  assert.match(await firstDownload.text(), /광고홍보의 한계/);
  events.push(['1차 파일 제작·회수', first.file?.serverPath || first.path]);

  workflow.additionalFees.push({ amount: 10000, reason: '공개자료 조사와 표 1개', accepted: true });
  assert.equal(workflowPaymentAmount(workflow), 39000);
  events.push(['추가금 고객 동의', '10,000원']);

  const finalText = `${firstDraft}\n\n4. 결론\n광고의 양보다 신뢰 가능한 정보와 소비자 통제권을 강화하는 방향이 지속 가능한 개선안이다.\n\n수정 반영: 결론 보강·표 표현 정리·오탈자 검수 완료`;
  const finalFile = await storeFile(`simulation-final-${runId}.txt`, finalText);
  const finalDownload = await fetch(`${origin}${finalFile.file?.serverPath || finalFile.path}`);
  assert.equal(finalDownload.ok, true);
  const delivered = await finalDownload.text();
  assert.match(delivered, /결론 보강/);
  assert.match(delivered, /표 표현 정리/);
  events.push(['최종 파일 제작·전달 준비', finalFile.file?.serverPath || finalFile.path]);

  const paymentAmount = workflowPaymentAmount(workflow);
  assert.equal(paymentAmount, 39000);
  events.push(['숨고페이 요청 금액', `${paymentAmount.toLocaleString('ko-KR')}원`]);
  events.push(['결제 이후 단계', '결제 완료 감지 → 리뷰 요청']);

  for (const [stage, evidence] of events) console.log(`[PASS] ${stage}: ${evidence}`);
  console.log(JSON.stringify({ ok: true, baseAmount: 29000, additionalFee: 10000, paymentAmount, intakeFile: intake.file?.serverPath || intake.path, firstFile: first.file?.serverPath || first.path, finalFile: finalFile.file?.serverPath || finalFile.path }, null, 2));
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
