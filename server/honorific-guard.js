'use strict';

// 채팅봇 존댓말 필수(2026-09-25 준희 지시: "채팅봇은 기존 설정에 무조건 존댓말이 필수로 나가도록").
// 고객에게 나갈 문장마다 끝맺음을 본다. 반말로 끝나는 문장이 하나라도 있으면 보내지 않고 사람 확인으로 넘긴다.
// - 존댓말 끝(~요, ~니다, ~니까, ~시오, ~죠)은 통과.
// - 반말 끝이 확실한 것만 막는다(~했어, ~할게, ~해, ~야, ~지, ~냐, ~한다/~했다, ~했음 등).
// - 문장이 아닌 줄(목록 "- 교정: 30,000원", [제목], 주소, 메일, 숫자·영문으로 끝나는 줄)과 명사로 끝나는 말은 보지 않는다.

const HONORIFIC_END = /(?:요|니다|니까|시오|죠|쇼)$/;

// 반말 끝(확실한 것만). 명사와 겹치는 한 글자 끝(아·어·지·다·자·음 등)은 앞 글자까지 같이 본다.
const BANMAL_END = new RegExp('(?:' + [
  // ~어/~아/~해 계열
  '해', '돼', '봐', '줘', '와', '보내', '알려', '기다려',
  '[했됐갔왔봤줬였겠있없]어', '같아', '좋아', '싫어', '맞아', '알아', '몰라', '괜찮아', '그래', '아니야', '뭐야',
  // ~야/~지/~냐/~니
  '이야', '거야', '[하되있없했좋알맞겠같됐]지', '[가-힣]냐', '[하있없되했갔왔봤]니',
  // ~게/~래/~자/~네/~군
  '[할줄볼갈올릴을]게', '[할줄볼갈올릴을]께', '[할볼갈줄을]래', '[하보가]자', '[하되있없좋했겠]네', '구나', '[하되이]군',
  // ~다(평서 반말). ~니다는 위에서 이미 통과
  '[같좋싶맞있없]다', '이다', '아니다',
  // ~거든/~는데/~잖아/~는걸
  '거든', '는데', '잖아', '는걸',
  // 메모체 ~음/~함/~됨/~임
  '[했됐있없였겠]음', '가능함', '필요함', '완료됨', '확인함', '진행함', '예정임', '드림'
].join('|') + ')$');

// 반말 끝과 모양이 같은 명사(문장 끝에 와도 반말이 아님)
const NOUN_WORDS = new Set(['이해', '피해', '오해', '손해', '올해', '방해', '포함', '이야기', '회의', '자기소개']);

function isListOrLabelLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^(?:[-*•·▶▷→※✔✓☑■□◆◇○●]|\d+[.)]\s|[①-⑳]|\[[^\]]*\]\s*$)/.test(t)) return true; // 목록·번호·[제목]
  if (/^[^.!?。]{0,30}[:：]\s*\S/.test(t) && !/[.!?。]\s*\S/.test(t)) return true; // "기간: 2일" 같은 항목 한 줄
  return false;
}

// 문장 끝 장식(이모티콘·ㅎㅎ·물결·닫는 괄호·따옴표·문장부호)을 떼어 낸다.
function stripDecoration(s) {
  let out = String(s || '').trim();
  let prev;
  do {
    prev = out;
    out = out
      .replace(/[\s~!?.…,，。]+$/u, '')
      .replace(/(?:\^\^|\^_\^|:\)|:D|;\)|ㅎ+|ㅋ+|ㅠ+|ㅜ+)$/u, '')
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+$/u, '')
      .replace(/[)\]}"'”’」』>]+$/u, '')
      .trim();
  } while (out !== prev);
  return out;
}

function splitSentences(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (isListOrLabelLine(line)) continue;
    for (const piece of line.split(/(?<=[.!?。…~])\s+/u)) {
      if (piece.trim()) out.push(piece.trim());
    }
  }
  return out;
}

// ~했다/~보냈다/~한다/~간다처럼 받침 ㅆ·ㄴ 뒤의 ~다(평서 반말). ~니다는 앞에서 이미 통과.
function pastOrPresentPlainDa(word) {
  if (word.length < 2 || !word.endsWith('다')) return false;
  const code = word.charCodeAt(word.length - 2) - 0xac00;
  if (code < 0 || code > 11171) return false;
  const jong = code % 28;
  return jong === 20 || jong === 4; // ㅆ, ㄴ
}

// ~보낼게/~드릴게/~할래/~할까처럼 받침 ㄹ 뒤의 게·께·래·까(반말). ~드릴게요는 앞에서 이미 통과.
function willEnding(word) {
  if (word.length < 2 || !/[게께래까]$/.test(word)) return false;
  const code = word.charCodeAt(word.length - 2) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 8; // ㄹ
}

// 반환: { ok, problems: [{ sentence, ending }] }
function checkHonorific(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const tokens = stripDecoration(sentence).split(/\s+/).filter(Boolean);
    const token = tokens[tokens.length - 1] || '';
    if (!/[가-힣]$/.test(token)) continue; // 숫자·영문·주소·기호로 끝나면 문장 끝맺음이 아님
    const word = token.replace(/^.*[^가-힣]/u, ''); // "(확인해" → "확인해"
    if (HONORIFIC_END.test(word)) continue;
    if (NOUN_WORDS.has(word)) continue;
    if (!BANMAL_END.test(word) && !pastOrPresentPlainDa(word) && !willEnding(word)) continue;
    problems.push({ sentence: sentence.slice(0, 120), ending: word.slice(-3) });
  }
  return { ok: problems.length === 0, problems };
}

function holdReason(result) {
  const first = result.problems[0];
  return `존댓말이 아닌 문장이 있어 보내지 않음(「${first ? first.sentence.slice(0, 40) : ''}」)`;
}

module.exports = { checkHonorific, holdReason, splitSentences };
