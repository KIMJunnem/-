(function () {
  'use strict';
  const KEY='relaySoomgoBotV2';
  const ENDPOINT='http://127.0.0.1:8787/api/soomgo/quote';
  const state={on:false,busy:false,processed:new Set(),lastDetail:'',lastUrl:location.href,status:'대기 중',lastRefresh:Date.now()};
  const clean=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
  const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const text=()=>clean(document.body?.innerText||'').slice(0,18000);
  const blocked=()=>/\/login|접근할 수 없습니다|로그인해 주세요|일시적인 오류|고객센터로 문의/i.test(location.href+' '+text());
  const detail=()=>/요청 상세|견적을 작성해 주세요|견적 금액|희망 서비스|고객 정보/i.test(text());
  const list=()=>/\/requests\/received\/?(?:\?|$)/i.test(location.pathname)&&/받은\s*요청|요청 목록|요청서|요청･견적/i.test(text());
  function panel(){let p=document.getElementById('relay-soomgo-v2');if(p)return p;p=document.createElement('aside');p.id='relay-soomgo-v2';p.innerHTML='<b>Relay Desk · 숨고 요청봇</b><button data-r=toggle>OFF</button><div data-r=status>차단 보호 대기 중</div><small>한 번에 한 요청 · 목록 주기 확인</small>';const st=document.createElement('style');st.textContent='#relay-soomgo-v2{position:fixed;z-index:2147483647;right:14px;bottom:14px;width:245px;padding:12px;border-radius:12px;background:#111827;color:#e5e7eb;font:13px sans-serif;box-shadow:0 8px 30px #0007}#relay-soomgo-v2 button{float:right;border:0;border-radius:7px;padding:5px 9px;background:#64748b;color:white}#relay-soomgo-v2 [data-r=status]{color:#a7f3d0;margin:9px 0 4px}#relay-soomgo-v2 small{color:#cbd5e1}';p.append(st);document.documentElement.append(p);p.onclick=async e=>{if(e.target.dataset.r==='toggle'){state.on=!state.on;await chrome.storage.local.set({[KEY]:{on:state.on}});draw(state.on?'감시 중':'정지')}};return p}
  function draw(s){state.status=s;const p=panel(),b=p.querySelector('[data-r=toggle]');p.querySelector('[data-r=status]').textContent=s;b.textContent=state.on?'ON':'OFF';b.style.background=state.on?'#10b981':'#64748b'}
  const field=rx=>[...document.querySelectorAll('input,textarea,[contenteditable=true]')].filter(visible).find(e=>rx.test(clean(e.getAttribute('aria-label')+' '+e.getAttribute('placeholder')+' '+e.name+' '+e.closest('label')?.textContent)));
  async function deleteAmbiguousQuote(){const first=[...document.querySelectorAll('button,[role=button],a')].filter(visible).find(e=>/^삭제하기$/i.test(clean(e.textContent||e.getAttribute('aria-label'))));if(!first)return false;first.click();await new Promise(r=>setTimeout(r,400));const scope=[...document.querySelectorAll('[role=dialog],[aria-modal=true],.modal,[class*=Modal]')].filter(visible).pop()||document;const confirm=[...scope.querySelectorAll('button,[role=button],a')].filter(visible).filter(e=>/^삭제하기$/i.test(clean(e.textContent||e.getAttribute('aria-label')))).pop();if(confirm)confirm.click();return Boolean(confirm)}
  const formScope=e=>e?.closest('form,[role=dialog],[aria-modal=true],fieldset')||document;
  const put=(e,v)=>{if(!e)return false;const raw=String(v).replace(/,/g,'');e.focus();if(e.isContentEditable){e.replaceChildren(document.createTextNode(String(v)));}else{const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)return false;setter.call(e,'');if(e.setRangeText)e.setRangeText(raw,0,0,'end');else setter.call(e,raw);e.setAttribute('value',raw);}e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:raw}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true};
  const read=e=>e?.isContentEditable?clean(e.textContent):clean(e.value);
  function extract(){const t=text();let purpose=(t.match(/희망 서비스\s*\n\s*([^\n]+)/i)||t.match(/서비스 분야\s+([^\n]+?)(?=\s+(?:원본|희망|이용 목적|진행 방식|고객 정보))/i)||t.match(/이용 목적\s*\n?\s*([^\n]+)/i)||[])[1]||'';if(!/영상|자막|숏폼|릴스|쇼츠/i.test(purpose)&&/영상\s*편집|개인\s*영상|자막\s*추가|숏폼\s*편집|릴스|쇼츠/i.test(t))purpose='영상 편집';return {purpose,topic:(t.match(/(?:의뢰\/희망사항|의뢰 내용|작성 주제)\s*\n?\s*([\s\S]{0,900}?)(?=\n?\s*(?:고객 정보|완료 희망일)|$)/i)||[])[1]||'',volume:(t.match(/(?:작업 분량|영상 길이|원본 길이|희망 길이|분량)\s*\n?\s*([^\n]+)/i)||[])[1]||'',format:(t.match(/(?:파일 형식|결과물 형식)\s*\n?\s*([^\n]+)/i)||[])[1]||'',sourceUrl:location.href,requestId:(location.pathname.match(/\/requests\/received\/([^/?]+)/i)||[])[1]||('PAGE-'+Date.now())};}
  function links(){
    const anchors=[...document.querySelectorAll('a[href*="/requests/received/"],a[href*="/pro/quotes/"]')].filter(visible);
    const detailButtons=[...document.querySelectorAll('button,[role=button]')].filter(visible).filter(e=>/^자세히\s*보기$/i.test(clean(e.textContent||e.getAttribute('aria-label'))));
    return [...anchors,...detailButtons];
  }
  async function runDetail(){if(!state.on||state.busy||!detail()||blocked())return;const req=extract();if(state.processed.has(req.requestId))return;state.busy=true;state.processed.add(req.requestId);draw('견적 계산 중 · '+(req.purpose||'요청'));try{const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','x-relay-bot':'soomgo-extension-v2'},body:JSON.stringify({...req,requestId:req.requestId+'-quote-'+Date.now()})});const d=await r.json();if(!r.ok||!d.quote)throw Error(d.error||'견적 응답 없음');const q=d.quote;if(q.manualReview||q.autoSend===false){draw('수동 검토 필요 · 자동 발송 안 함');return}const all=[...document.querySelectorAll('input,textarea,[contenteditable=true]')].filter(visible);const amount=all.find(e=>/금액|비용|price|amount/i.test(clean(e.getAttribute('aria-label')+' '+e.getAttribute('placeholder')+' '+e.name+' '+e.closest('label')?.textContent)))||all.find(e=>e.tagName==='INPUT'&&/number|numeric/i.test(e.type+' '+e.inputMode));if(!amount)throw Error('금액 입력창을 찾지 못했습니다');const scope=formScope(amount);const fields=[...scope.querySelectorAll('input,textarea,[contenteditable=true]')].filter(visible);const days=fields.find(e=>e!==amount&&/소요일|기간|day|period/i.test(clean(e.getAttribute('aria-label')+' '+e.getAttribute('placeholder')+' '+e.name)))||null;const desc=fields.find(e=>e!==amount&&(e.tagName==='TEXTAREA'||e.isContentEditable||/견적|서비스 설명|상세 내용|메시지|description|message/i.test(clean(e.getAttribute('aria-label')+' '+e.getAttribute('placeholder')+' '+e.name))))||all.find(e=>e!==amount&&e.tagName==='TEXTAREA')||all.find(e=>e!==amount&&e.isContentEditable);if(!desc)throw Error('견적 설명 입력창을 찾지 못했습니다');all.filter(e=>e!==amount&&e!==days&&e!==desc&&(e.tagName==='TEXTAREA'||e.isContentEditable)).forEach(e=>put(e,''));put(amount,q.amount);put(days,q.days);put(desc,q.message);await new Promise(r=>setTimeout(r,250));if(read(amount).replace(/[^0-9]/g,'')!==String(q.amount).replace(/[^0-9]/g,'')||read(desc)!==clean(q.message))throw Error('숨고 폼 상태 불일치');draw('견적 입력 완료 · 확인 필요');const send=[...document.querySelectorAll('button,[role=button]')].filter(visible).find(e=>/견적.*(보내|발송)|전송/i.test(clean(e.textContent)));if(send&&state.on){send.click();await new Promise(r=>setTimeout(r,1200));if(!/\/requests\/received\//i.test(location.pathname))history.back();}else draw('보내기 버튼 확인 필요');}catch(e){draw('오류로 정지 · '+String(e.message).slice(0,80));state.on=false;await chrome.storage.local.set({[KEY]:{on:false}})}finally{state.busy=false}}
  async function loop(){panel();if(location.href!==state.lastUrl){state.lastUrl=location.href;state.busy=false;state.lastDetail='';draw('페이지 전환 감지 · 현재 요청 다시 확인');}if(blocked()){draw('로그인·차단 화면 감지 · 자동 정지');state.on=false;return}if(!state.on)return;if(detail()){await runDetail();return}if(list()){const a=links().find(x=>{const k=x.href?.split('/').pop()||clean(x.closest('button,[role=button]')?.textContent||x.textContent).slice(0,180);return !state.processed.has(k)});if(a){const k=a.href?.split('/').pop()||clean(a.closest('button,[role=button]')?.textContent||a.textContent).slice(0,180);state.processed.add(k);draw('요청 1건만 여는 중');a.click();return}if(Date.now()-state.lastRefresh>=30000){state.lastRefresh=Date.now();draw('받은 요청 목록 새로고침');location.reload();}else draw('새 요청 대기');}}
  chrome.storage.local.get(KEY).then(x=>{state.on=Boolean(x[KEY]?.on);draw(state.on?'감시 중':'정지 · 로그인 후 직접 ON');setInterval(loop,1500);loop()});
})();














