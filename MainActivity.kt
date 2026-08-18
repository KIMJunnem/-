package com.merona.todaytrace

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.merona.todaytrace.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording() else toast("마이크 권한이 있어야 생활 기록을 시작할 수 있어요.")
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.dateText.text = SimpleDateFormat("M월 d일 EEEE", Locale.KOREAN).format(Date())
        binding.recordButton.setOnClickListener { toggleRecording() }
        binding.permissionButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }
        binding.addMemoButton.setOnClickListener {
            val text = binding.memoInput.text?.toString().orEmpty().trim()
            if (text.isNotBlank()) {
                LocalStore.addMemo(this, text)
                binding.memoInput.text?.clear()
                refresh()
            }
        }

        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch("android.permission.POST_NOTIFICATIONS")
        }
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun toggleRecording() {
        if (LocalStore.isRunning(this) || serviceIsRunning()) {
            stopService(Intent(this, ListeningService::class.java).apply { action = ListeningService.ACTION_STOP })
            LocalStore.setRunning(this, false)
            refresh()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            startRecording()
        }
    }

    private fun startRecording() {
        try {
            ContextCompat.startForegroundService(this, Intent(this, ListeningService::class.java))
            LocalStore.setRunning(this, true)
            refresh()
        } catch (e: Exception) {
            toast("기록을 시작하지 못했어요: ${e.message ?: "알 수 없는 오류"}")
        }
    }

    private fun serviceIsRunning(): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        @Suppress("DEPRECATION")
        return manager.getRunningServices(Int.MAX_VALUE).any { it.service.className == ListeningService::class.java.name }
    }

    private fun refresh() {
        val running = LocalStore.isRunning(this) || serviceIsRunning()
        binding.statusText.text = if (running) {
            if (Build.VERSION.SDK_INT >= 33) "● 고감도 마이크로 생활을 기록하고 있어요" else "● 지금 생활을 기록하고 있어요"
        } else "● 기록이 꺼져 있어요"
        binding.statusText.setTextColor(ContextCompat.getColor(this, if (running) R.color.green else R.color.subtext))
        binding.recordButton.text = if (running) "기록 종료" else "기록 시작"

        val usagePermission = UsageAnalyzer.hasPermission(this)
        binding.permissionButton.text = if (usagePermission) "✓ 앱 사용 기록 권한 허용됨" else "앱 사용 기록 권한 허용하기"

        val usage = UsageAnalyzer.today(this)
        binding.usageText.text = if (!usagePermission) {
            "버튼을 눌러 ‘오늘기록’의 사용 정보 접근을 허용해 주세요."
        } else if (usage.isEmpty()) {
            "오늘 1분 이상 사용한 다른 앱이 아직 없어요."
        } else {
            usage.joinToString("\n") { "${it.label}  ·  ${UsageAnalyzer.prettyDuration(it.millis)}" }
        }

        val memos = LocalStore.todayMemos(this)
        binding.memoText.text = if (memos.isEmpty()) "아직 메모가 없어요." else memos.joinToString("\n") { "• ${it.text}" }

        val transcripts = LocalStore.todayTranscripts(this)
        val timeFormat = SimpleDateFormat("HH:mm", Locale.KOREA)
        binding.timelineText.text = if (transcripts.isEmpty()) {
            "아직 기록된 말이 없어요."
        } else {
            transcripts.takeLast(20).joinToString("\n") { "${timeFormat.format(Date(it.time))}  ${it.text}" }
        }

        binding.summaryText.text = buildSummary(transcripts, memos, usage)
    }

    private fun buildSummary(
        transcripts: List<LocalStore.Entry>,
        memos: List<LocalStore.Entry>,
        usage: List<UsageAnalyzer.AppUse>
    ): String {
        if (transcripts.isEmpty() && memos.isEmpty() && usage.isEmpty()) {
            return "기록을 시작하면 오늘의 말과 앱 사용을 바탕으로 요약이 생겨요."
        }
        val importantWords = listOf("해야", "가야", "잊지", "기억", "약속", "전화", "사야", "내일", "다음주", "예약", "돈", "입금", "결제")
        val important = transcripts
            .filter { e -> importantWords.any { e.text.contains(it) } }
            .distinctBy { it.text }
            .takeLast(4)

        val parts = mutableListOf<String>()
        if (transcripts.isNotEmpty()) parts += "오늘 ${transcripts.size}개의 음성 기록이 잡혔어요."
        if (important.isNotEmpty()) {
            parts += "\n중요해 보이는 말\n" + important.joinToString("\n") { "• ${it.text}" }
        }
        if (memos.isNotEmpty()) {
            parts += "\n직접 저장한 메모\n" + memos.takeLast(4).joinToString("\n") { "• ${it.text}" }
        }
        if (usage.isNotEmpty()) {
            val top = usage.first()
            parts += "\n오늘 가장 오래 쓴 앱은 ${top.label}이고 ${UsageAnalyzer.prettyDuration(top.millis)} 사용했어요."
        }
        return parts.joinToString("\n")
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
