package com.merona.todaytrace

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class ListeningService : Service(), RecognitionListener {
    private var recognizer: SpeechRecognizer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var stopping = false
    private var lastPartial = ""

    // Android 13+ 고감도 입력용
    private var audioRecord: AudioRecord? = null
    private var agc: AutomaticGainControl? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private var pipeRead: ParcelFileDescriptor? = null
    private var pipeWrite: ParcelFileDescriptor? = null
    private var audioThread: Thread? = null
    private val pumping = AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification(statusText()))
        LocalStore.setRunning(this, true)
        startRecognizer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopping = true
        handler.removeCallbacksAndMessages(null)
        cleanupAudioCapture()
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        LocalStore.setRunning(this, false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startRecognizer() {
        if (stopping || !SpeechRecognizer.isRecognitionAvailable(this)) return
        handler.post {
            if (stopping) return@post
            lastPartial = ""
            cleanupAudioCapture()
            try {
                recognizer?.destroy()
                recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { it.setRecognitionListener(this) }

                val intent = baseRecognizerIntent()
                if (Build.VERSION.SDK_INT >= 33) {
                    try {
                        attachHighSensitivityAudio(intent)
                    } catch (_: Exception) {
                        cleanupAudioCapture()
                    }
                }
                recognizer?.startListening(intent)
            } catch (_: Exception) {
                cleanupAudioCapture()
                restartSoon(2500)
            }
        }
    }

    private fun baseRecognizerIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        // 말 사이 짧은 침묵 때문에 문장이 너무 빨리 끊기는 것을 완화합니다.
        putExtra("android.speech.extras.SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS", 1700L)
        putExtra("android.speech.extras.SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS", 1200L)
    }

    /**
     * Android 13(API 33)+에서는 우리가 AudioRecord를 직접 열고
     * VOICE_RECOGNITION + AGC 경로로 받은 PCM을 SpeechRecognizer에 전달합니다.
     * 프로젝트는 compileSdk 30이라 API 33 상수는 공식 문자열 값을 사용합니다.
     */
    private fun attachHighSensitivityAudio(intent: Intent) {
        val sampleRate = 16_000
        val min = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = max(if (min > 0) min * 2 else 4096, 8192)

        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            throw IllegalStateException("AudioRecord init failed")
        }
        audioRecord = recorder

        if (AutomaticGainControl.isAvailable()) {
            try {
                agc = AutomaticGainControl.create(recorder.audioSessionId)?.apply { enabled = true }
            } catch (_: Exception) { agc = null }
        }
        if (NoiseSuppressor.isAvailable()) {
            try {
                noiseSuppressor = NoiseSuppressor.create(recorder.audioSessionId)?.apply { enabled = true }
            } catch (_: Exception) { noiseSuppressor = null }
        }

        val pipe = ParcelFileDescriptor.createPipe()
        pipeRead = pipe[0]
        pipeWrite = pipe[1]

        // RecognizerIntent.EXTRA_AUDIO_SOURCE (API 33+)의 공식 문자열 값.
        intent.putExtra("android.speech.extra.AUDIO_SOURCE", pipeRead)
        intent.putExtra("android.speech.extra.AUDIO_SOURCE_CHANNEL_COUNT", 1)
        intent.putExtra("android.speech.extra.AUDIO_SOURCE_ENCODING", AudioFormat.ENCODING_PCM_16BIT)
        intent.putExtra("android.speech.extra.AUDIO_SOURCE_SAMPLING_RATE", sampleRate)

        pumping.set(true)
        recorder.startRecording()
        val writeSide = pipeWrite ?: throw IllegalStateException("Audio pipe missing")
        audioThread = Thread({
            val out = ParcelFileDescriptor.AutoCloseOutputStream(writeSide)
            val buffer = ByteArray(bufferSize)
            try {
                while (pumping.get() && recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val count = recorder.read(buffer, 0, buffer.size)
                    if (count > 0) {
                        out.write(buffer, 0, count)
                        out.flush()
                    } else if (count < 0) {
                        break
                    }
                }
            } catch (_: Exception) {
            } finally {
                try { out.close() } catch (_: Exception) {}
            }
        }, "TodayTraceMicPump").apply {
            isDaemon = true
            start()
        }
    }

    private fun cleanupAudioCapture() {
        pumping.set(false)
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { pipeWrite?.close() } catch (_: Exception) {}
        try { pipeRead?.close() } catch (_: Exception) {}
        try { audioThread?.interrupt() } catch (_: Exception) {}
        audioThread = null
        pipeWrite = null
        pipeRead = null
        try { agc?.release() } catch (_: Exception) {}
        try { noiseSuppressor?.release() } catch (_: Exception) {}
        agc = null
        noiseSuppressor = null
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
    }

    private fun saveBestResult(results: Bundle?): Boolean {
        val finalText = results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            .orEmpty()
            .trim()
        val text = if (finalText.isNotBlank()) finalText else lastPartial.trim()
        if (text.length >= 2) {
            LocalStore.addTranscript(this, text)
            return true
        }
        return false
    }

    private fun restartSoon(delay: Long = 700) {
        if (stopping) return
        handler.removeCallbacks(restartRunnable)
        handler.postDelayed(restartRunnable, delay)
    }

    private val restartRunnable = Runnable { startRecognizer() }

    override fun onResults(results: Bundle?) {
        saveBestResult(results)
        cleanupAudioCapture()
        restartSoon(500)
    }

    override fun onError(error: Int) {
        // 최종 결과 없이 세션이 닫혀도 꽤 긴 partial이 있었다면 버리지 않습니다.
        if (lastPartial.trim().length >= 3 &&
            (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_CLIENT)
        ) {
            LocalStore.addTranscript(this, lastPartial.trim())
        }
        cleanupAudioCapture()
        val delay = when (error) {
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 2500L
            // ERROR_TOO_MANY_REQUESTS는 compileSdk 30에 없어 숫자 10을 사용합니다.
            10 -> 10_000L
            else -> 900L
        }
        restartSoon(delay)
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val partial = partialResults
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            .orEmpty()
            .trim()
        if (partial.length > lastPartial.length) lastPartial = partial
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    private fun statusText(): String = if (Build.VERSION.SDK_INT >= 33) {
        "고감도 마이크 · 작은 목소리도 텍스트로 정리해요"
    } else {
        "생활 기록 중 · 말한 내용을 텍스트로 정리해요"
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "생활 기록",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "마이크 생활 기록이 켜져 있을 때 표시됩니다." }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("오늘기록이 듣고 있어요")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    companion object {
        const val ACTION_STOP = "com.merona.todaytrace.STOP"
        private const val CHANNEL_ID = "today_trace_recording"
        private const val NOTIFICATION_ID = 2201
    }
}
