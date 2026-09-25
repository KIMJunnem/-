# OpenAI API Astra 운영 라우팅

기준일: 2026-09-18

숨고 운영에서 대화·제작·최종검수·예외 판단을 ChatGPT 대화창이 아니라 OpenAI API의 `gpt-6-astra` 호출로 처리하도록 라우팅을 분리한다. 웹 확장프로그램은 숨고 화면의 감지·입력·첨부·전송 확인만 담당하고, 문장 생성과 결과물 판단은 서버의 Astra API 호출이 담당한다.

## Astra로 고정하는 운영 경로

| 경로 | 공급자 | 모델 | 권한 |
| --- | --- | --- | --- |
| 숨고 고객 채팅 응답 | OpenAI API | `gpt-6-astra` | 고객 질문 답변·범위·가격 설명 |
| 숨고 의뢰 결과물 제작 | OpenAI API | `gpt-6-astra` | DOCX·XLSX·PY 등 결과물 작성 |
| 기본 교차검수 후 최종검수 | OpenAI API | `gpt-6-astra` | 보수 채점·수정·전달 승인 |
| 결제·파일·전송 예외 | OpenAI API | `gpt-6-astra` | 상태 불일치 분석·자동 중단 판단 |

아이디어 확장용 다른 공급자는 고객 응대와 납품 판정의 의사결정권을 갖지 않는다. 운영 경로에는 Gemini·Claude·일반 Luna fallback을 두지 않는다. Astra API가 실패하면 고객에게 완료라고 말하지 않고, 자동 전송을 중단하고 담당자 확인 대기로 남긴다.

## 호출 설계

- Responses API를 사용한다.
- `store: false`를 유지하고 서버에는 응답 ID·사용량·상태만 감사 기록으로 남긴다.
- 모든 Astra 호출에 `prompt_cache_key`를 넣어 고정 지침과 카탈로그 접두부를 재사용할 수 있게 한다.
- 고객 채팅은 최근 대화·견적 사실·현재 워크플로 상태를 매번 명시적으로 전달한다. 이전 응답 ID에만 의존하지 않는다.
- 서버가 가격·결제·파일 형식·전송 성공 여부를 먼저 결정하고 Astra에는 확인된 사실을 제공한다. Astra가 숫자나 상태를 임의로 만들지 못하게 한다.
- 응답 후 서버에서 금액·납기·파일명·고용·결제 상태를 검증하고, 검증 실패 시 원문을 고객에게 보내지 않는다.

OpenAI 공식 문서상 `previous_response_id`를 통한 다중 턴 상태 연결이 가능하지만, 다음 요청에 지시문이 자동으로 이어지지 않을 수 있으므로 이 시스템은 안전을 위해 필요한 지시문과 상태를 서버가 매 요청에 명시적으로 포함한다. `prompt_cache_key`는 유사 요청의 캐시 최적화를 위한 키로 사용한다.

## 현재 코드 증거

- `server/relay-server.js`의 `SOOMGO_ASTRA_FINAL_MODEL = 'gpt-6-astra'`
- `astraOperationalRoute()`가 `soomgo_chat`, `soomgo_fulfillment`, `soomgo_final_review`, `soomgo_emergency`를 OpenAI API Astra 경로로 고정
- `conversationalSoomgoReply()`가 `gpt-6-astra`로 직접 호출하고 `aiRoute: 'Astra API'`를 기록
- `runOpenAI()`가 Responses API와 `prompt_cache_key`를 사용
- `/api/providers`가 Astra 모델·운영 경로·API 엔드포인트를 표시

## 확인 기준

`GET /api/providers`에서 Astra가 `configured: true`, `available: true`, `model: gpt-6-astra`, `apiEndpoint: /v1/responses`인지 확인한다. 고객 채팅 응답 기록에는 `aiProvider: OpenAI`, `aiModel: gpt-6-astra`, `aiRoute: Astra API`가 남아야 한다.

## 공식 근거

- [OpenAI Developer Quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [Responses API 상태·프롬프트 캐시·지시문](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal?lang=python)

