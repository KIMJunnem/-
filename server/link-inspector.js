'use strict';

// 고객 채팅에 들어온 링크를 서버가 판단한다(2026-09-21).
// - 채팅봇은 링크를 열지 않고 메시지를 그대로 서버에 넘긴다.
// - 서버는 허용된 주소만 직접 조회한다: 구글 문서·스프레드시트·프레젠테이션
//   (docs.google.com/.../d/ID), 구글 드라이브 파일(drive.google.com/file/d/ID).
//   고객이 보낸 URL을 그대로 요청하지 않고, 문서 ID로 내보내기 주소를 새로 만든다.
// - 그 밖의 주소는 열지 않고 담당자 확인으로 넘긴다.

const DOC_PATH = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/;
const DRIVE_PATH = /^\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/;
const MAX_BYTES = 300000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const EXPORT = { document: 'export?format=txt', spreadsheets: 'export?format=csv', presentation: 'export/txt' };
const ALLOWED_HOP = host => host === 'docs.google.com' || host === 'drive.google.com' || host === 'drive.usercontent.google.com' || host.endsWith('.googleusercontent.com');
const EVASION = /카피\s*킬러|gpt\s*킬러|표절\s*률|표절\s*검사|ai\s*(?:탐지|검출|판별)|ai\s*detect|zero\s*gpt|turnitin/i;
// 학위논문·연구 프로젝트 수준만 담당자 확인(기존 manual_academic 기준과 맞춤). 일반 학교 과제는 제외.
const ACADEMIC = /논문|학위|연구\s*계획서|선행\s*연구|중간\s*(?:진행\s*)?보고서|학술\s*db|j-stage|cinii|riss/i;

function extractUrls(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)]
    .map(match => match[0].replace(/[)\].,!?]+$/, ''))
    .slice(0, 5);
}

function classifyLink(raw) {
  let url;
  try { url = new URL(raw); } catch (_) { return { kind: 'invalid', host: '' }; }
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:' && host === 'docs.google.com') {
    const match = url.pathname.match(DOC_PATH);
    if (match) return { kind: match[1] === 'document' ? 'google_doc' : match[1] === 'spreadsheets' ? 'google_sheet' : 'google_slides', host, docType: match[1], docId: match[2] };
  }
  if (url.protocol === 'https:' && host === 'drive.google.com') {
    const match = url.pathname.match(DRIVE_PATH);
    const id = match?.[1] || (url.pathname === '/open' ? String(url.searchParams.get('id') || '') : '');
    if (/^[A-Za-z0-9_-]{20,}$/.test(id)) return { kind: 'drive_file', host, docId: id };
  }
  return { kind: 'unknown', host };
}

// 공개 문서는 googleusercontent.com으로 한 번 넘어간 뒤 본문을 준다.
// 로그인 화면(accounts.google.com 등)으로 넘어가면 비공개 문서로 본다.
function googleDownloadUrl(link) {
  if (link.kind === 'drive_file') return `https://drive.google.com/uc?export=download&id=${link.docId}`;
  return `https://docs.google.com/${link.docType || 'document'}/d/${link.docId}/${EXPORT[link.docType || 'document']}`;
}

// 구글 문서류는 글(txt·csv)로, 드라이브 파일은 원본 그대로 받는다.
async function fetchGoogleFile(link, fetchImpl = fetch) {
  let url = googleDownloadUrl(link);
  const binary = link.kind === 'drive_file';
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status >= 300 && response.status < 400) {
      const location = String(response.headers?.get?.('location') || '');
      let next;
      try { next = new URL(location, url); } catch (_) { return { status: 'error', code: 'bad_redirect' }; }
      const nextHost = next.hostname.toLowerCase();
      if (next.protocol === 'https:' && ALLOWED_HOP(nextHost)) { url = next.toString(); continue; }
      return { status: 'private' };
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) return { status: 'private' };
    if (!response.ok) return { status: 'error', code: response.status };
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > (binary ? MAX_FILE_BYTES : MAX_BYTES)) return { status: 'too_large', bytes: declared };
    const buffer = await response.arrayBuffer();
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (binary) {
      if (buffer.byteLength > MAX_FILE_BYTES) return { status: 'too_large', bytes: buffer.byteLength };
      // 큰 파일은 드라이브가 '바이러스 검사 불가' 안내 HTML을 준다 → 자동으로 받지 않음
      if (contentType === 'text/html') return { status: /accounts\.google\.com|로그인|Sign in/i.test(new TextDecoder('utf-8').decode(buffer.slice(0, 4000))) ? 'private' : 'too_large' };
      const disposition = String(response.headers?.get?.('content-disposition') || '');
      const name = decodeURIComponent((disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'drive-file').trim());
      return { status: 'ok', file: { name: name.slice(0, 160), mediaType: contentType, data: Buffer.from(buffer).toString('base64'), bytes: buffer.byteLength } };
    }
    if (buffer.byteLength > MAX_BYTES) return { status: 'too_large', bytes: buffer.byteLength };
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '').trim();
    if (/<html[\s>]/i.test(text.slice(0, 400))) return { status: 'private' };
    return { status: 'ok', text };
  }
  return { status: 'error', code: 'too_many_redirects' };
}

async function inspectMessageLinks(message, fetchImpl = fetch) {
  const urls = extractUrls(message);
  if (!urls.length) return null;
  const links = [];
  for (const raw of urls) {
    const link = classifyLink(raw);
    const entry = { host: link.host, kind: link.kind, status: 'not_opened' };
    if (link.kind !== 'unknown' && link.kind !== 'invalid') {
      try {
        const result = await fetchGoogleFile(link, fetchImpl);
        entry.status = result.status;
        if (result.status === 'ok' && result.file) {
          // 드라이브 파일: 서버가 첨부 판독(attachment-reader)으로 넘긴다. 기록에는 본문을 남기지 않는다.
          Object.defineProperty(entry, 'file', { value: result.file, enumerable: false });
          entry.fileName = result.file.name;
          entry.bytes = result.file.bytes;
        } else if (result.status === 'ok') {
          entry.chars = result.text.length;
          entry.excerpt = result.text.slice(0, 1500);
          Object.defineProperty(entry, 'text', { value: result.text, enumerable: false });
          entry.evasion = EVASION.test(result.text);
          entry.academic = ACADEMIC.test(result.text);
        }
      } catch (error) {
        entry.status = 'error';
        entry.code = String(error?.name || error?.message || 'fetch_failed').slice(0, 60);
      }
    }
    links.push(entry);
  }
  const messageText = String(message || '');
  return {
    links,
    evasion: links.some(item => item.evasion) || EVASION.test(messageText),
    academic: links.some(item => item.academic) || ACADEMIC.test(messageText)
  };
}

function replyForInspection(inspection) {
  if (!inspection) return null;
  const base = { linkInspection: inspection, templateKey: '', reason: '' };
  if (inspection.evasion) {
    return {
      ...base, autoSend: true, manualReview: false, templateKey: 'link_academic_integrity_decline',
      reason: '링크 문서에 표절·AI 검사 통과 조건이 있어 정중히 거절',
      text: '자료 확인했습니다. 표절률이나 AI 판별 결과를 특정 수치 아래로 맞춰야 하는 조건의 작업은 진행하지 않습니다. 이 조건 없이 필요한 문서 작업이 있으면 말씀해 주세요.'
    };
  }
  if (inspection.links.some(item => item.status === 'private')) {
    return {
      ...base, autoSend: true, manualReview: false, templateKey: 'link_private_document',
      reason: '고객 구글 문서·파일이 비공개라 열리지 않음',
      text: '보내주신 링크가 비공개로 설정되어 있어 열리지 않습니다. 공유 설정을 "링크가 있는 모든 사용자"로 바꿔 주시거나 파일을 이 채팅에 올려주시면 확인하고 금액을 바로 알려드리겠습니다.'
    };
  }
  if (inspection.academic) {
    return {
      ...base, autoSend: false, manualReview: true, templateKey: 'link_academic_review',
      reason: '링크 문서가 학업 과제·연구 관련 · 대신 작성 여부 담당자 확인',
      text: '자료 확인했습니다. 연구계획서·논문 관련 작업이라 담당자가 범위를 확인한 뒤 가능 여부와 금액을 안내드리겠습니다.'
    };
  }
  const readable = inspection.links.find(item => item.status === 'ok');
  if (readable) {
    return {
      ...base, autoSend: false, manualReview: true, templateKey: 'link_document_review',
      reason: readable.fileName ? `드라이브 파일 받음(${readable.fileName}) · 범위·금액 담당자 확인` : `구글 문서 확인됨(${readable.chars}자) · 범위·금액 담당자 확인`,
      text: ''
    };
  }
  const hosts = [...new Set(inspection.links.map(item => item.host).filter(Boolean))].join(', ') || '알 수 없는 주소';
  return {
    ...base, autoSend: false, manualReview: true, templateKey: 'link_not_opened',
    reason: `고객 링크(${hosts})는 자동으로 열지 않음 · 담당자 확인`,
    text: ''
  };
}

// 이전 이름 호환
const fetchGoogleDocText = (docId, fetchImpl = fetch) => fetchGoogleFile({ kind: 'google_doc', docType: 'document', docId }, fetchImpl);

module.exports = { extractUrls, classifyLink, fetchGoogleFile, fetchGoogleDocText, inspectMessageLinks, replyForInspection, EVASION, ACADEMIC };
