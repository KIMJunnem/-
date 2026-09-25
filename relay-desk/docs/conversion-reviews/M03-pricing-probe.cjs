'use strict';
// Read-only local reproduction. Synthetic cases, no customer identifiers/network/server start.
const pricing = require('../../server/pricing-table.js');
const fs = require('node:fs');
const path = require('node:path');
const cases = [
  {id:'infographic',purpose:'인포그래픽 디자인',topic:'기관 연구과제의 간행물 인포그래픽 디자인',volume:'A4 기준 1',pages:1},
  {id:'existing-report-design',purpose:'기술문서',topic:'기존 보고서를 좀더 보기 좋게 디자인',volume:'A4 기준 16',pages:16},
  {id:'explicit-layout-control',purpose:'기술문서',topic:'기존 보고서의 내용은 유지하고 레이아웃 편집',volume:'A4 기준 16',pages:16},
  {id:'writing-control',purpose:'브랜드 소개글',topic:'제공 자료로 소개글 작성',volume:'A4 기준 1',pages:1}
];
const results = cases.map(c => {const q=pricing.documentQuote(c);return {id:c.id,input:c,type:q.type,amount:q.amount,days:q.days,schoolAssignment:q.schoolAssignment,includedRevisions:q.includedRevisions};});
const result={observedAt:new Date().toISOString(),syntheticInputs:true,externalCalls:0,results};
fs.writeFileSync(path.join(__dirname,'M03-pricing-probe-results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
