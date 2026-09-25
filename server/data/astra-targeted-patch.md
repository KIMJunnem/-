```diff
--- a/TARGET.js
+++ b/TARGET.js
@@ -1,14 +1,19 @@
+function finiteEnvNumber(value, fallback) {
+  const parsed = Number(value || fallback);
+  return Number.isFinite(parsed) ? parsed : fallback;
+}
+
 const HOST = process.env.RELAY_HOST || '0.0.0.0';
-const PORT = Number(process.env.RELAY_PORT || 8787);
+const PORT = finiteEnvNumber(process.env.RELAY_PORT, 8787);
 const MAX_BODY = 30 * 1024 * 1024;
 // Keep one document synchronized with the current Relay Desk state. The
 // interval is configurable for local testing, and defaults to 30 minutes.
-const REPORT_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.RELAY_REPORT_INTERVAL_MS || 30 * 60 * 1000));
+const REPORT_INTERVAL_MS = Math.max(60 * 1000, finiteEnvNumber(process.env.RELAY_REPORT_INTERVAL_MS, 30 * 60 * 1000));
 // Provider calls can spend more than 45 seconds on a long handoff prompt.
 // Keep the timeout configurable, but give normal research runs enough time to
 // finish before the fallback provider is attempted.
-const PROVIDER_TIMEOUT_MS = Number(process.env.RELAY_PROVIDER_TIMEOUT_MS || 90000);
+const PROVIDER_TIMEOUT_MS = finiteEnvNumber(process.env.RELAY_PROVIDER_TIMEOUT_MS, 90000);
 // 비용 보호 장치. API별 정확한 청구액은 계정·모델·할인에 따라 달라질 수
 // 있으므로 토큰은 확정값으로 제한하고 비용은 설정 가능한 추정치로 기록한다.
-const DAILY_TOKEN_CAP = Math.max(0, Number(process.env.RELAY_DAILY_TOKEN_CAP || 2000000));
-const DAILY_COST_CAP_USD = Math.max(0, Number(process.env.RELAY_DAILY_COST_CAP_USD || 10));
+const DAILY_TOKEN_CAP = Math.max(0, finiteEnvNumber(process.env.RELAY_DAILY_TOKEN_CAP, 2000000));
+const DAILY_COST_CAP_USD = Math.max(0, finiteEnvNumber(process.env.RELAY_DAILY_COST_CAP_USD, 10));
```

```bash
# TARGET.js는 실제 파일 경로로 치환하세요. 아래 검사는 패치 적용 후 실행합니다.
# 제공된 정규식의 판매\s*페이지|상품\s*페이지는 이미 올바릅니다.
# 따라서 productQualityBrief와 결제 상태 전이는 변경하지 않습니다.
TARGET='TARGET.js'

node --check "$TARGET" &&
node --input-type=commonjs - "$TARGET" <<'NODE'
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');

const config = source.match(
  /^function finiteEnvNumber\(value, fallback\) \{[\s\S]*?^const DAILY_COST_CAP_USD = [^\r\n]+/m
);
assert.ok(config, '설정 코드 구간을 찾을 수 없습니다.');

const keys = [
  'RELAY_PORT',
  'RELAY_REPORT_INTERVAL_MS',
  'RELAY_PROVIDER_TIMEOUT_MS',
  'RELAY_DAILY_TOKEN_CAP',
  'RELAY_DAILY_COST_CAP_USD',
];
const defaults = [8787, 1800000, 90000, 2000000, 10];

function check(env, expected) {
  const actual = vm.runInNewContext(
    config[0] + '\n[PORT, REPORT_INTERVAL_MS, PROVIDER_TIMEOUT_MS, DAILY_TOKEN_CAP, DAILY_COST_CAP_USD];',
    { process: { env } }
  );
  assert.ok(actual.every(Number.isFinite));
  assert.deepEqual(Array.from(actual), expected);
}

check({}, defaults);
for (const value of ['', 'NaN', 'Infinity', '-Infinity', '1e309', 'invalid']) {
  for (const key of keys) check({ [key]: value }, defaults);
}
check(Object.fromEntries(keys.map(key => [key, '0'])), [0, 60000, 0, 0, 0]);
check({
  RELAY_PORT: '8080',
  RELAY_REPORT_INTERVAL_MS: '120000',
  RELAY_PROVIDER_TIMEOUT_MS: '45000',
  RELAY_DAILY_TOKEN_CAP: '12345',
  RELAY_DAILY_COST_CAP_USD: '2.5',
}, [8080, 120000, 45000, 12345, 2.5]);
check({
  RELAY_REPORT_INTERVAL_MS: '-1',
  RELAY_DAILY_TOKEN_CAP: '-1',
  RELAY_DAILY_COST_CAP_USD: '-1',
}, [8787, 60000, 90000, 0, 0]);

const briefSource = source.match(
  /^function productQualityBrief\(request = \{\}, quote = \{\}\) \{[\s\S]*?^\}/m
);
assert.ok(briefSource, 'productQualityBrief를 찾을 수 없습니다.');
const brief = vm.runInNewContext(
  briefSource[0] + '\nproductQualityBrief;',
  { RELAY_DESK_PRODUCT_QUALITY_PLAYBOOK: '' }
);
const track = '시장·경쟁사·리서치·사업계획서 기준을 우선 적용한다.';
for (const text of [
  '판매페이지', '판매 페이지', '판매  페이지', '판매\t페이지', '판매\n페이지',
  '상품페이지', '상품 페이지', '상품\t페이지',
]) {
  assert.ok(brief({ text }).includes(track), JSON.stringify(text));
}
assert.ok(!brief({ text: '판매s페이지' }).includes(track));
console.log('OK: 유한값·기본값·하한 및 판매/상품 페이지 정규식 검사 통과');
NODE
```