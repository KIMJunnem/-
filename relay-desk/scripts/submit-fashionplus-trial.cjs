const fs = require('node:fs/promises');
const path = require('node:path');

const api = 'http://127.0.0.1:8787';
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'outputs', 'fashionplus-order-downloader');
const requestId = '6aaa4c966c2c1f21c1de3872';
const taskId = 'SOOMGO-TRIAL-FASHIONPLUS-20260916';

async function request(url, options = {}) {
  const response = await fetch(`${api}${url}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${url} ${response.status}: ${data.error || 'request failed'}`);
  return data;
}

async function main() {
  const state = await request('/api/state');
  const lead = (state.soomgoLeads || []).find(item => item.requestId === requestId);
  if (!lead) throw new Error('FashionPlus 의뢰 기록을 찾지 못했습니다.');
  if ((state.soomgoWorkflows || []).some(item => item.id === `WF-${taskId}`)) {
    console.log(`이미 숨고 의뢰 진행상황에 등록돼 있습니다: ${taskId}`);
    return;
  }

  const names = ['fashionplus-download.js', 'README.md', 'package.json', 'package-lock.json'];
  const files = [];
  for (const name of names) {
    const data = await fs.readFile(path.join(folder, name));
    const result = await request('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name, source: 'Relay Desk · 친구 시범', project: '숨고 의뢰 처리', taskId,
        mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain',
        status: '교차검증 대상', dataBase64: data.toString('base64')
      })
    });
    files.push(result.file);
  }

  const code = await fs.readFile(path.join(folder, 'fashionplus-download.js'), 'utf8');
  const readme = await fs.readFile(path.join(folder, 'README.md'), 'utf8');
  const pkg = await fs.readFile(path.join(folder, 'package.json'), 'utf8');
  const now = new Date().toISOString();
  const qualityPlan = {
    passes: 2,
    label: '교차검증 2회',
    gates: ['요청·범위 확인 및 다운로드 동작 점검', '보안·비파괴 동작·테스트·실행 안내 독립 검토'],
    rationale: '로그인정보 보호 및 주문 상태 미변경을 우선으로 검증'
  };
  const task = {
    id: taskId,
    title: 'FashionPlus 주문 파일 다운로드 자동화 · 친구 시범',
    description: '친구 시범 제작으로 Relay Desk 교차검증 2회를 진행합니다. 실제 숨고 고용·결제 완료로 표시하지 않으며, 현재 단계는 사전고용 시범 작업입니다.',
    qualityPlan, ai: 'OpenAI', priority: '높음', status: 'active', label: '교차검증 1차 실행 대기',
    tone: 'blue', dot: '', meta: '친구 시범 · Relay Desk 교차검증',
    project: '숨고 의뢰 처리', category: '숨고 의뢰 처리', lane: 'soomgo_fulfillment',
    source: 'Soomgo · 친구 시범', sourceRequestId: requestId,
    sourceUrl: 'https://seller.fashionplus.co.kr/login', decisionAuthority: false,
    decisionOwner: '사용자 승인', createdAt: now, updatedAt: now
  };
  const prompt = `FashionPlus 판매자 포털 주문 파일 자동화 시범본을 코드 검토 및 보완하라.
요청 범위: 판매자 로그인 후 지정된 주문 페이지로 이동하고 기존 주문 엑셀 파일을 내려받는 자동화. 의뢰 대화에서 분석은 제외하고 파일 다운로드 위주로 원한다고 정정되었다. 주문 상태변경·발주 확정·삭제·고객 연락 등 비가역 동작은 자동화하지 말 것. 주문 처리 단계, 정확한 주문 페이지 경로, 사이트 DOM, 로그인 계정은 제공되지 않았으므로 실제 사이트에서 작동한다고 주장하지 마라.

현재 시범 소스:
--- fashionplus-download.js ---
${code}
--- README.md ---
${readme}
--- package.json ---
${pkg}

수행사항:
1. 실제 버그, 잘못된 셀렉터 선택 위험, URL·파일명 안전성, 타임아웃·에러 처리, 로그인 UX를 검토하고 수정안을 제시한다.
2. 사이트 계정 없이 실행 가능한 테스트를 제안하거나 작성한다. 실제 사이트 실행·다운로드를 했다고 주장하지 않는다.
3. 명확한 파일 다운로드만 사용자 선택·확인 후 실행하고 주문 데이터나 자격증명을 로그/파일에 남기지 않는다.
4. 수정된 전체 파일 또는 구체적인 unified diff를 포함한다.
5. 실제 동작 검증을 위해 고객에게 받아야 할 정보를 3개 이내로 남긴다.

이 작업은 친구 시범으로 Relay Desk 교차검증 대상이며, 실제 고용·수금으로 기록하지 않는다. 다음 AI가 독립 검토할 수 있도록 위험과 미검증 항목을 빠짐없이 남겨라.`;
  const post = {
    id: `POST-${taskId}`, taskId, title: 'FashionPlus 시범본 · 1차 독립 점검',
    source: 'Soomgo', nextAI: 'OpenAI', prompt, status: '게시됨', mode: 'analysis',
    followUpMode: 'analysis', cycle: 1, maxCycles: 2, autoContinue: true,
    lane: 'soomgo_fulfillment', sourceRequestId: requestId,
    decisionAuthority: false, decisionOwner: '사용자 승인', createdAt: now
  };
  const workflow = {
    id: `WF-${taskId}`, leadId: lead.id, requestId, conversationId: '', taskId,
    currentTaskId: taskId, currentPostId: post.id, request: {
      purpose: '웹 크롤링', format: 'Excel', volume: '주문 파일 다운로드',
      topic: 'FashionPlus 판매자 포털 주문 다운로드 자동화 시범'
    }, quote: {}, stage: 'trial_crosscheck_running', cycle: 1, maxCycles: 2,
    pendingDelivery: null, pendingAction: null, additionalFees: [], feedbacks: [],
    createdAt: now, updatedAt: now, trial: true
  };
  await request('/api/state', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: [task], promptPosts: [post], soomgoWorkflows: [workflow], files, activities: [[now, '사용자', taskId, '친구 시범본을 숨고 진행상황에 등록 · Relay Desk 교차검증 2회 시작']] })
  });
  console.log(JSON.stringify({ taskId, postId: post.id, requestId, files: files.map(file => file.name), stage: workflow.stage }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
