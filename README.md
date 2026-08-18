# 오늘기록 v0.9 고감도 마이크

- 기존 Java 8 모바일 IDE 호환 빌드 유지
- Android 13+에서 AudioRecord VOICE_RECOGNITION 입력 사용
- AutomaticGainControl(지원 기기) 활성화
- NoiseSuppressor(지원 기기) 활성화
- Android 13+ 공식 SpeechRecognizer 외부 오디오 입력 사용
- 부분 인식 결과 보존: 최종 결과가 없어도 의미 있는 partial을 저장
- 기존 기기에서는 v0.8 방식으로 자동 fallback
