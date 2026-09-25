'use strict';

// 워드·한글·파워포인트 글자 추출과 링크(드라이브·시트) 판독 회귀 검사.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const ot = require('../server/office-text');
const ar = require('../server/attachment-reader');
const li = require('../server/link-inspector');
const { createWorkflowDocx } = require('../server/workflow-docx');

// 한글 5.0 압축 문서(표 컨트롤 포함) 샘플
const HWP = zlib.gunzipSync(Buffer.from('H4sIADIwsWoC/7twXvDBwo1SDxnQgB0DM8O//5wMbEhijEDMDOMIQPgg/O////8w4f+jYEiBv0D8DwmPgpEFQPmXCZqvQfHPipafR8HwBh7hAQou+cmlual5JQpumTmp6AqYGVgZh7H/i5M8ElIOcM2JlDNYE3m4wqkx8dTGrekpfJ+MLB4Gnj5wqFfp0NmCFN+3gTObuXgYs10b00ze2FY8PDdtr7V/TtUmz37HRsdva5iaDQ/fC157XFFpD8/Q8n8QQz4QljAoMLgy5AHpIoZKkvSLAZMHrCxhIlIPSF0DNFG5MWQy5DCkMngAcSJDCpAsItF+Jkbk8oxojVD7nYC+TwH6OQRocwXQ/6QCIQZGRkZou4eZjPAPBtqbDLQ3E+iOPAYDMuwn3f8sYHshAACUDpWMAAoAAA==', 'base64'));

(async () => {
  const hwp = ot.extractText(HWP, '견적.hwp');
  assert.equal(hwp.status, 'ok', JSON.stringify(hwp));
  assert.match(hwp.text, /견적 요청서/);
  assert.match(hwp.text, /계약서 교정 부탁드립니다\. 총 3쪽입니다\./, '컨트롤 문자 건너뛰기');

  const docx = createWorkflowDocx('회사 소개서\n우리 회사는 서울에 있습니다.');
  const word = ot.extractText(docx, '소개서.docx');
  assert.equal(word.status, 'ok');
  assert.match(word.text, /우리 회사는 서울에 있습니다/);

  assert.equal(ot.extractText(Buffer.from('not a file'), 'x.hwp').status, 'error');
  assert.equal(ot.extractText(Buffer.from('x'), 'x.zip').status, 'unsupported');
  assert.equal(ot.extractText(Buffer.from('﻿메모 내용', 'utf8'), 'memo.txt').text, '메모 내용');

  // 첨부로 온 한글·워드 → 글자만 Claude에 전달
  let sent = null;
  const claude = async content => { sent = content; return { text: '{"summary":"계약서 교정","documentType":"계약서","pages":3,"taskGuess":"proofreading","concerns":[]}' }; };
  const read = await ar.readAttachments([
    { name: '견적.hwp', mediaType: 'application/octet-stream', data: HWP.toString('base64') },
    { name: '소개서.docx', mediaType: '', data: docx.toString('base64') }
  ], claude, { message: '[파일] 견적.hwp' });
  assert.equal(read.status, 'ok');
  assert.equal(sent.filter(block => block.type === 'text').length, 3, '파일 2개 글 + 지시문');
  assert.match(sent[0].text, /\[파일: 견적\.hwp\]\n견적 요청서/);
  assert.equal(read.attachments[0].extract.status, 'ok');
  assert.ok(!JSON.stringify(read).includes(HWP.toString('base64').slice(0, 40)), '기록에 파일 본문 없음');

  // 배포용 한글처럼 글자를 못 뽑으면 Claude를 부르지 않고 알림만
  const bad = await ar.readAttachments([{ name: '보호.hwp', mediaType: '', data: Buffer.from('zz').toString('base64') }], async () => { throw new Error('should_not_call'); });
  assert.equal(bad.status, 'unreadable');

  // 링크 문서 요약
  const linkRead = await ar.readDocumentText('회의록 초안 5쪽', claude, { name: '고객 링크 문서' });
  assert.equal(linkRead.status, 'ok');

  // 링크 종류 판별
  assert.equal(li.classifyLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit').kind, 'google_sheet');
  assert.equal(li.classifyLink('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit').kind, 'google_slides');
  assert.equal(li.classifyLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=sharing').kind, 'drive_file');
  assert.equal(li.classifyLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWx').kind, 'drive_file');
  assert.equal(li.classifyLink('https://drive.google.com.evil.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view').kind, 'unknown');

  // 드라이브 파일: 원본을 받아 파일 정보만 남기고 본문은 기록에서 숨긴다
  const urls = [];
  const fakeFetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'manual');
    if (url.startsWith('https://drive.google.com/uc')) return { status: 303, ok: false, headers: { get: n => (n === 'location' ? 'https://drive.usercontent.google.com/download?id=x' : null) } };
    return { status: 200, ok: true, headers: { get: n => ({ 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''%EA%B2%AC%EC%A0%81.hwp", 'content-length': String(HWP.length) })[n] || null }, arrayBuffer: async () => HWP.buffer.slice(HWP.byteOffset, HWP.byteOffset + HWP.length) };
  };
  const inspection = await li.inspectMessageLinks('자료 https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view', fakeFetch);
  assert.equal(urls[0], 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWx');
  assert.equal(inspection.links[0].status, 'ok');
  assert.equal(inspection.links[0].fileName, '견적.hwp');
  assert.ok(inspection.links[0].file.data.length > 100);
  assert.ok(!JSON.stringify(inspection).includes('"data"'), '저장되는 기록에는 파일 본문 없음');
  assert.equal(li.replyForInspection(inspection).templateKey, 'link_document_review');

  // 드라이브 로그인 화면으로 넘어가면 비공개
  const privateFetch = async () => ({ status: 302, ok: false, headers: { get: n => (n === 'location' ? 'https://accounts.google.com/ServiceLogin' : null) } });
  const priv = li.replyForInspection(await li.inspectMessageLinks('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view', privateFetch));
  assert.equal(priv.templateKey, 'link_private_document');

  const fs = require('node:fs');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /templateKey: 'link_document_read'/);
  console.log('office-text: PASS');
})().catch(error => { console.error(error); process.exit(1); });
