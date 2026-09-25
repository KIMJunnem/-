'use strict';

// 요청봇 0.4.8: 스마트견적 안내 화면 '나가기'와 제공 불가 요청 삭제 흐름 정적 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'soomgo-bot-extension', 'manifest.json'), 'utf8'));

// 안내 화면은 두 문구가 모두 있을 때만 판정하고, '나가기'만 누른다.
assert.match(source, /스마트견적을\\s\*지금\\s\*등록해\\s\*보세요\|AI가\\s\*완성했습니다/);
assert.match(source, /스마트견적에\\s\*임시\\s\*등록하기/);
assert.match(source, /\/\^나가기\$\/\.test/);
assert.doesNotMatch(source, /\.find\(el => \/\^?스마트견적에/, '임시 등록 버튼을 누르는 코드 없음');
// 채팅방 페이지 시작 시점과 루프 양쪽에서 처리, 봇 ON일 때만
assert.match(source, /storedOn && \/\\\/pro\\\/chats\\\/\/i\.test\(location\.pathname\)\) await waitAndDismissSmartQuotePromo\(\)/);
assert.match(source, /if \(state\.on && dismissSmartQuotePromo\(\)\) return;/);
// 0.4.15~16: 제공 불가 판정은 삭제하지 않고 승인 대기로 건너뜀. 고수 10명 마감 요청만 자동 삭제(현재 요청 버튼만, 애매하면 안 누름)
assert.match(source, /const AUTO_DELETE_ALLOWED = Object\.freeze\(\{ quoteClosed10: true, unsupported: false \}\);/);
assert.match(source, /async function deleteCurrentRequest\(kind = 'unsupported'\) \{\s*if \(AUTO_DELETE_ALLOWED\[kind\] !== true\) return false;/);
assert.equal((source.match(/await deleteCurrentRequest\(/g) || []).length, 1, '삭제 호출은 10명 마감 한 곳');
assert.match(source, /await deleteCurrentRequest\('quoteClosed10'\)/);
assert.match(source, /삭제 대상 · 승인 대기 · 삭제 안 함'\);\s*await new Promise\(resolve => setTimeout\(resolve, 600\)\);\s*await returnToRequestList\(\);/);
assert.match(source, /삭제 승인 대기\(봇은 삭제하지 않음\)/);
assert.match(source, /if \(!dialog \|\| requestId\(\) !== currentId\) return false;/, '확인은 대화상자 안에서만');
assert.equal(manifest.version, '0.4.24');
assert.match(source, /요청봇 0\.4\.24/);
assert.match(source, /const REQUEST_REFRESH_MS = 20000;/, '목록 새로고침 20초');
// 0.4.12: 탭 잠금·캐시 부족·계정 확인
assert.match(source, /createGuard\(\{\s*role: 'request'/);
assert.match(source, /숨고 캐시 부족 · 자동 정지/);
assert.match(source, /숨고 계정이 swan이 아님/);
// 0.4.11: 하루 신규 견적 20건, 한국 시간 기준
assert.match(source, /const DAILY_QUOTE_LIMIT = 30;/);
assert.doesNotMatch(source, />= 5\)/);
// 0.4.10: Relay Desk 연결 끊김 시 상세 화면에 머물지 않고 목록에서 대기
assert.match(source, /await queueForRelayDesk\(request, error, true\)/);
assert.match(source, /if \(connectionLost\) setRelayWait\(Date\.now\(\) \+ 30000\);/);
assert.match(source, /Relay Desk 연결 끊김 · 목록에서 대기/);
// 0.4.9: 고수 10명 견적 마감 팝업은 확인 → (0.4.15부터 삭제 안 함) → 목록 복귀
assert.match(source, /견적을\\s\*발송할\\s\*수\\s\*없어요/);
assert.match(source, /if \(state\.on && isDetail\(\) && quoteClosedConfirmButton\(\)\)/);
assert.match(source, /고수 10명 견적 마감 요청/);
console.log('soomgo-bot-smartquote-exit: PASS');
