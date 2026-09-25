# 파이버 맞춤 견적 틀 — 3가지 경우 (2026-09-23, 지시 5)

> **초안이다.** 답장·견적 발송은 준희가 파이버 화면에서 직접 한다. Relay Desk는 파이버를 읽거나 누르지 않는다.
> `[PRICE — 준희]` `[DAYS — 준희]`는 준희가 채운다. 이 파일에는 계산식·추천가를 쓰지 않는다.
> `{중괄호}`는 고객 메시지를 보고 바꿔 넣는 자리.
> 수정 횟수는 자막 2회(decisions.md 3번). 파이버 밖 연락처·외부 결제·외부 링크는 쓰지도, 요구하지도 않는다.

**AI를 물어보면 (세 경우 공통, 한 줄 덧붙임)**
```
Yes, I use AI for the first draft. Then I check the subtitles myself, including the timing across the whole video.
```
(AI draft + human sync check. "100% human"이라고 쓰지 않는다)

---

## 1. 자막 입힌 영상(MP4) 요청

**① 첫 답장**
```
Hi {buyer name}, thanks for your message.
You'd like Korean subtitles for your {N}-minute {language} video, and you also need the subtitles burned into the video as an MP4 file.
My standard packages include the SRT file only. Burning the subtitles into the video is possible, but I handle it with a custom offer, so I'll send you one here on Fiverr.
You'll get both files: the SRT and the MP4 with subtitles.
One question before I send the offer: do you have a preference for where the subtitles appear on screen (bottom center is the default), for example because there is already text at the bottom of your video?
```

**② 맞춤 견적서 칸 (Fiverr Custom Offer)**
| 칸 | 넣을 내용 |
|---|---|
| Description | `Korean subtitles for a {N}-minute {language} video. Delivered as an SRT file plus an MP4 with the subtitles burned in. Timing checked from start to finish. 2 revisions included.` |
| Delivery | `[DAYS — 준희]` |
| Revisions | 2 |
| Price | `[PRICE — 준희]` |

---

## 2. 30분 넘는 영상

**① 첫 답장**
```
Hi {buyer name}, thanks for your message.
Your video is about {N} minutes long and in {language}, and you need Korean subtitles (SRT){ for purpose}.
My packages go up to 30 minutes, so for a longer video I'll send you a custom offer here on Fiverr.
I check the timing from start to finish on the whole video, not just a few parts, so longer videos take me a little more time.
One question: could you tell me the exact length of the video (for example 42 minutes), so the offer matches it?
```
(길이를 이미 정확히 적었으면 질문을 바꾼다: "Do you have a script or existing subtitles I can refer to?")

**② 맞춤 견적서 칸**
| 칸 | 넣을 내용 |
|---|---|
| Description | `Korean subtitles (SRT) for a {N}-minute {language} video. Timing checked from start to finish. 2 revisions included.` |
| Delivery | `[DAYS — 준희]` |
| Revisions | 2 |
| Price | `[PRICE — 준희]` |

---

## 3. 영어·프랑스어가 아닌 원어

**① 첫 답장**
```
Hi {buyer name}, thanks for your message.
Your video is in {language}, about {N} minutes long, and you need Korean subtitles (SRT).
English and French are the languages I have already worked with. For {language}, I'd like to check first before you pay.
If you can send the video here in Fiverr messages, I'll listen to about the first minute and tell you honestly whether I can deliver good quality.
If I can, I'll send you a custom offer. If I can't, I'll tell you so, and you won't be charged anything.
```
(질문 대신 "영상 보내 주세요" 한 가지 부탁으로 끝낸다. 부탁이 두 개가 되지 않게 한다)

**확인 뒤 — 가능할 때 ② 맞춤 견적서 칸**
| 칸 | 넣을 내용 |
|---|---|
| Description | `Korean subtitles (SRT) for a {N}-minute {language} video. Timing checked from start to finish. 2 revisions included.` |
| Delivery | 30분 이하면 기본 패키지와 같은 날수(5·10분 2일 / 30분 3일), 30분 넘으면 `[DAYS — 준희]` |
| Revisions | 2 |
| Price | `[PRICE — 준희]` |

**확인 뒤 — 어려울 때 (답장만, 견적 없음)**
```
Thank you for sending the video. I listened to the first part, and I don't think I can deliver the quality you need for {language}, so I'd rather not take this order. I'm sorry I can't help this time.
```

---

## 준희가 채울 칸

| 경우 | 가격 | 납기 |
|---|---|---|
| 1. MP4 요청 | `[PRICE — 준희]` | `[DAYS — 준희]` |
| 2. 30분 초과 | `[PRICE — 준희]` | `[DAYS — 준희]` |
| 3. 다른 원어(가능할 때) | `[PRICE — 준희]` | 30분 이하는 기본 날수, 초과는 `[DAYS — 준희]` |

## 서버 초안(server/global-reply.js)과 대조 — 코드는 고치지 않음

- **맞음**: 30분 초과·MP4 요청 → 서버도 "맞춤 견적 — 준희가 금액을 정해 Custom offer로 보냄"으로 표시. 이 틀도 "I'll send you a custom offer"로 같다
- **맞음**: 파이버 밖 연락 금지, "100% human"·경력·"best/perfect" 금지 — 서버 규칙과 같다
- **어긋남 1**: 서버 프롬프트는 "checks timing **block by block**"라고 쓴다. 게시본·이 틀은 "from start to finish". 게다가 두 단계 검사는 1~2블록 밀림은 못 잡는다(fiverr-gig-draft.md 7번). 서버 문구를 게시본에 맞추는 건 개발방 몫
- **어긋남 2**: 서버는 영어·프랑스어가 아닌 원어를 따로 다루지 않는다. 길이만 맞으면 **패키지 금액 줄을 그대로 넣는다**. 이 틀(3번)은 "먼저 1분 확인 → 가능하면 맞춤 견적"이다. 다른 원어 문의에서 서버 초안을 쓰면 금액 줄을 지우고 3번 틀로 바꿔야 한다. 서버 쪽 처리는 개발방 몫
- [추정] 파이버 메시지에서 구매 전 영상 파일을 받을 수 있는지(첨부 크기 한도 등)는 파이버 화면에서 확인 필요
