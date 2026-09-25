import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
const B=path.dirname(fileURLToPath(import.meta.url)),R=path.dirname(B),O=path.join(R,'output-v3');
const SK='C:/Users/vdfr7/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const PY='C:/Users/vdfr7/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const p=Presentation.create({slideSize:{width:1280,height:720}});let n=0;
function txt(s,text,x,y,w,h,size=28,bold=false,color='#111111'){
 const q=s.shapes.add({name:'copy-'+(++n),geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 q.text=text;q.text.style={typeface:'Pretendard',fontSize:size,bold,color,autoFit:'none'};return q;
}
function slide(i,dark=false){
 const s=p.slides.add();s.background.fill=dark?'#121212':'#FFFFFF';
 txt(s,'swan',64,30,200,40,27,true,dark?'#FFFFFF':'#111111');
 txt(s,'자체 제작 샘플 · 원문을 발표용으로 재구성한 예시',64,664,1000,24,15,false,dark?'#BBBBBB':'#666666');
 txt(s,String(i).padStart(2,'0'),1170,664,48,24,15,false,dark?'#BBBBBB':'#666666');
 s.speakerNotes.textFrame.setText('출처: 함께 제공한 source-memo.txt 및 Swan_02_Edited_Report.docx. Swan 자체 제작 원문과 운영 제안이며 실제 고객 의뢰, 실적, 검증된 전환 성과를 의미하지 않습니다. 가격이나 납기를 제시하지 않습니다.');return s;
}
let s=slide(1,true);
txt(s,'swan 브랜드 콘텐츠 운영안',65,123,1100,52,28,false,'#BBBBBB');
txt(s,'고객의 자료를\n쓰기 좋은 형태로',61,222,1150,213,70,true,'#FFFFFF');
txt(s,'영상은 한국어 자막으로,\n초안은 문서로, 보고서는 발표 자료로 정리합니다.',67,506,1100,97,31,false,'#EEEEEE');
s=slide(2);
txt(s,'맡길 자료와 받을 결과를 명확하게',62,116,1160,78,48,true);
const entries=[['영상 자막','영상과 대본 유무 확인','한국어 자막 파일(SRT)','외국어 영상은 한국어로 번역\n영상 삽입은 별도 범위'],['일반 문서','초안과 참고 자료 확인','순서와 표현을 정리한 문서','원문의 내용과 의도 유지'],['PPT 변환','보고서와 원고 확인','핵심을 나눈 발표 자료','슬라이드별 전달 목적 정리']];
for(let i=0;i<3;i++){
 const x=66+i*407;
 txt(s,entries[i][0],x,260,365,55,35,true);
 txt(s,entries[i][1],x,356,365,45,24,false,'#555555');
 txt(s,entries[i][2],x,435,365,48,27,true);
 txt(s,entries[i][3],x,515,365,75,22,false,'#666666');
}
s=slide(3);
txt(s,'제작 전에 세 가지를 맞춥니다',62,114,1150,80,49,true);
const qs=[['01','원자료','기존 영상·초안·보고서가 있나요?'],['02','사용 목적','어디에 쓰고, 누가 볼 자료인가요?'],['03','필요한 시점','언제까지 필요하신가요?']];
qs.forEach((v,i)=>{let y=268+i*118;txt(s,v[0],67,y,95,55,33,false,'#888888');txt(s,v[1],187,y,260,55,33,true);txt(s,v[2],526,y+3,660,54,29,false,'#333333');});
s=slide(4);
txt(s,'완성한 뒤에도 원문으로 돌아갑니다',62,116,1160,80,47,true);
txt(s,'내용',67,255,300,60,37,true);txt(s,'뜻과 조건이\n바뀌지 않았는지',67,345,337,110,31,false,'#333333');
txt(s,'파일',479,255,300,60,37,true);txt(s,'열리고 읽히며\n잘리지 않는지',479,345,337,110,31,false,'#333333');
txt(s,'자막',890,255,300,60,37,true);txt(s,'음성보다 늦거나\n빠르지 않은지',890,345,326,110,31,false,'#333333');
txt(s,'수정한 이유를 기록해 다음 작업의 체크리스트에 반영합니다.',67,554,1120,52,27,true);
const candidateRaw=path.join(B,'candidate-v3.pptx');await(await PresentationFile.exportPptx(p)).save(candidateRaw);
const {embedFonts}=await import('file:///C:/Users/vdfr7/Documents/Codex/relay-desk-site/server/pptx-embed-fonts.js');
const candidate=path.join(B,'candidate-v3-embedded.pptx');await embedFonts({src:candidateRaw,out:candidate});
// The existing embedder inserts r:id but this producer uses another relationship prefix.
// Repair only this sample package, without changing the server module.
const JSZip=createRequire('file:///C:/Users/vdfr7/Documents/Codex/relay-desk-site/server/pptx-embed-fonts.js')('jszip');
const z=await JSZip.loadAsync(await fs.readFile(candidate));
let xml=await z.file('ppt/presentation.xml').async('string');
if(!/<p:presentation\b[^>]*xmlns:r=/.test(xml))xml=xml.replace('<p:presentation ','<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
z.file('ppt/presentation.xml',xml);await fs.writeFile(candidate,await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
const {finalizePresentation}=await import(pathToFileURL(path.join(SK,'container_tools/artifact_tool_utils.mjs')));
const final=path.join(O,'Swan_03_Report_to_PPT.pptx');
const result=await finalizePresentation({workspaceDir:R,candidatePath:candidate,finalPath:final,pythonExecutable:PY,integrityValidatorPath:path.join(SK,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SK,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:4,requiredNativeTableOwnerSlides:[],fontPolicy:{basis:'design',families:['Pretendard']},verifyArtifactToolImport:true,receiptPath:path.join(B,'deck-validation-v3.json')});
console.log(JSON.stringify(result));
const fin=await PresentationFile.importPptx(await FileBlob.load(final));await fs.mkdir(path.join(B,'slides-v3'),{recursive:true});
for(let i=0;i<fin.slides.items.length;i++){const img=await fin.export({slide:fin.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(B,'slides-v3',`slide-${i+1}.png`),new Uint8Array(await img.arrayBuffer()));}
console.log('4 slides rendered');
