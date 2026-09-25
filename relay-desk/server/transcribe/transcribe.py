# Relay Desk 로컬 전사(2026-09-22, T-3). faster-whisper, CPU 전용. 외부 전송 없음(모델은 로컬 폴더에서만 읽음).
# 사용: python transcribe.py --input <파일> --out <결과 JSON 경로> --model <모델 폴더> [--language ko] [--threads 4] [--compute int8] [--vad 1]
#        [--terms "SSG, 구단주"] [--term-mode hotwords|prompt|both]  (S-2, 2026-09-23: 고유명사·전문용어를 엔진에 미리 알려 준다)
# 결과 JSON: {language, languageProbability, duration, segments:[{id,start,end,text,words:[{start,end,word,probability}]}]}
import argparse, json, os, sys, time

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--model', required=True)
    p.add_argument('--language', default='')
    p.add_argument('--threads', type=int, default=4)
    p.add_argument('--compute', default='int8')
    p.add_argument('--vad', type=int, default=1)
    p.add_argument('--terms', default='')
    p.add_argument('--term-mode', default='hotwords')
    a = p.parse_args()
    os.environ.setdefault('HF_HUB_OFFLINE', '1')  # 모델을 인터넷에서 다시 받지 않는다
    from faster_whisper import WhisperModel
    started = time.time()
    model = WhisperModel(a.model, device='cpu', compute_type=a.compute, cpu_threads=a.threads, num_workers=1, local_files_only=True)
    terms = ', '.join([t.strip() for t in a.terms.replace('\n', ',').split(',') if t.strip()])
    kwargs = dict(language=(a.language or None), vad_filter=bool(a.vad), word_timestamps=True, beam_size=5)
    used_mode = 'none'
    if terms:
        if a.term_mode in ('prompt', 'both'):
            kwargs['initial_prompt'] = terms
            used_mode = 'prompt'
        if a.term_mode in ('hotwords', 'both'):
            kwargs['hotwords'] = terms
            used_mode = 'both' if used_mode == 'prompt' else 'hotwords'
    try:
        segments, info = model.transcribe(a.input, **kwargs)
    except TypeError:
        # 오래된 faster-whisper라 hotwords를 모르면 initial_prompt로만 넣는다
        kwargs.pop('hotwords', None)
        if terms:
            kwargs['initial_prompt'] = terms
            used_mode = 'prompt_fallback'
        segments, info = model.transcribe(a.input, **kwargs)
    out = []
    for i, s in enumerate(segments, 1):
        out.append({
            'id': i, 'start': round(s.start, 3), 'end': round(s.end, 3), 'text': s.text.strip(),
            'words': [{'start': round(w.start, 3), 'end': round(w.end, 3), 'word': w.word, 'probability': round(w.probability, 3)} for w in (s.words or [])]
        })
    result = {
        'engine': 'faster-whisper', 'language': info.language, 'languageProbability': round(info.language_probability, 3),
        'duration': round(info.duration, 3), 'elapsedSeconds': round(time.time() - started, 2), 'segments': out,
        'settings': {'model': os.path.basename(os.path.normpath(a.model)), 'computeType': a.compute, 'threads': a.threads, 'vad': bool(a.vad), 'terms': len([t for t in terms.split(', ') if t]), 'termMode': used_mode}
    }
    tmp = a.out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, a.out)
    print(json.dumps({'ok': True, 'out': a.out, 'segments': len(out), 'duration': result['duration'], 'elapsedSeconds': result['elapsedSeconds']}))

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'ok': False, 'error': type(e).__name__ + ': ' + str(e)[:400]}))
        sys.exit(1)
