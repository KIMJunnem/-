import sys,os,json,time,subprocess
from pathlib import Path
B=Path(r'C:\Users\vdfr7\Documents\Codex\2026-09-13\37\swan-samples-20260923\build')
R=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(B/'asr-deps'))
os.environ['HF_HUB_OFFLINE']='1'
from faster_whisper import WhisperModel
model_name=sys.argv[1] if len(sys.argv)>1 else 'small'
m=WhisperModel(model_name,device='cpu',compute_type='int8',cpu_threads=4,download_root=str(B/'asr-models'),local_files_only=True)
t=time.time()
segs,info=m.transcribe(str(R/'opus-output/Swan_Subtitle_Compare_21s.mp4'),language='en',beam_size=5,word_timestamps=True,vad_filter=False,condition_on_previous_text=False)
rows=[]
for s in segs:
 rows.append({'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in s.words]})
 print(round(s.start,2),round(s.end,2),s.text,flush=True)
out={'method':f'faster-whisper {model_name} CPU int8, VAD off, local cache only, independent no script prompt','elapsedSeconds':round(time.time()-t,2),'segments':rows}
(R/f'codex/build/opus-independent-asr-{model_name}.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
