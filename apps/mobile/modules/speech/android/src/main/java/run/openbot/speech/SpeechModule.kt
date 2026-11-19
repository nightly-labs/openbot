package run.openbot.speech

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.PlaybackParams
import android.net.Uri
import android.os.Build
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

private class SpeechPart(val id: String?, val samples: FloatArray, val sampleRate: Int, val generation: Int)

private class SpeechModelException : CodedException("ERR_SPEECH_MODEL", "The speech model could not load.", null)

private class CapturePermissionException : CodedException("ERR_CAPTURE_PERMISSION", "Microphone access is off.", null)

private class CaptureException : CodedException("ERR_CAPTURE", "The microphone could not start.", null)

private val CALL_HEADSETS = setOf(
  AudioDeviceInfo.TYPE_WIRED_HEADSET,
  AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
  AudioDeviceInfo.TYPE_USB_HEADSET,
  AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
  AudioDeviceInfo.TYPE_BLE_HEADSET,
)

private fun pathOf(location: String): String =
  if (location.startsWith("file:")) Uri.parse(location).path ?: location else location

class SpeechModule : Module() {
  private val synthesis = Executors.newSingleThreadExecutor()
  private val parts = LinkedBlockingQueue<SpeechPart>()
  private val generation = AtomicInteger(0)
  private var tts: OfflineTts? = null
  private var loadedDirectory: String? = null
  @Volatile private var track: AudioTrack? = null
  @Volatile private var speed = 1f
  private var playback: Thread? = null
  private var callModeBefore: Int? = null
  private var recognizer: OfflineSpeechRecognizer? = null
  private val recognition = Executors.newSingleThreadExecutor()
  private val captureExecutor = Executors.newSingleThreadExecutor()
  private val capture = SpeechCapture(
    executor = captureExecutor,
    recognition = recognition,
    recognizer = { recognizer },
    send = { name, body -> sendEvent(name, body) },
  )

  override fun definition() = ModuleDefinition {
    Name("OpenBotSpeech")

    Events("onSpeechStart", "onSpeechDone", "onSpeechError", "onCaptureLevel", "onCaptureAudio", "onCaptureText", "onCaptureEnd")

    OnCreate {
      playback = Thread({ playLoop() }, "openbot-speech-playback").apply { start() }
    }

    AsyncFunction("load") { location: String, threads: Int, promise: Promise ->
      synthesis.execute {
        val directory = pathOf(location)
        if (loadedDirectory == directory && tts != null) {
          promise.resolve(null)
          return@execute
        }
        tts?.release()
        tts = null
        loadedDirectory = null
        try {
          val file = { name: String -> File(directory, name).absolutePath }
          val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
              supertonic = OfflineTtsSupertonicModelConfig(
                durationPredictor = file("duration_predictor.int8.onnx"),
                textEncoder = file("text_encoder.int8.onnx"),
                vectorEstimator = file("vector_estimator.int8.onnx"),
                vocoder = file("vocoder.int8.onnx"),
                ttsJson = file("tts.json"),
                unicodeIndexer = file("unicode_indexer.bin"),
                voiceStyle = file("voice.bin"),
              ),
              numThreads = threads,
              debug = false,
              provider = "cpu",
            ),
            maxNumSentences = 1,
          )
          tts = OfflineTts(config = config)
          loadedDirectory = directory
          promise.resolve(null)
        } catch (error: Throwable) {
          promise.reject(SpeechModelException())
        }
      }
    }

    Function("modelRoot") {
      val context = appContext.reactContext ?: throw SpeechModelException()
      val root = File(context.filesDir, "voice").apply { mkdirs() }
      Uri.fromFile(root).toString()
    }

    AsyncFunction("loadRecognizer") { location: String, threads: Int, promise: Promise ->
      loadRecognizer(location, RecognizerModel.PARAKEET, threads, promise)
    }

    AsyncFunction("loadQwenRecognizer") { location: String, threads: Int, promise: Promise ->
      loadRecognizer(location, RecognizerModel.QWEN3_ASR, threads, promise)
    }

    AsyncFunction("unloadRecognizer") { promise: Promise ->
      recognition.execute {
        recognizer?.release()
        recognizer = null
        promise.resolve(null)
      }
    }

    AsyncFunction("startCapture") { mode: String, promise: Promise ->
      val context = appContext.reactContext
      if (context?.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject(CapturePermissionException())
        return@AsyncFunction
      }
      captureExecutor.execute {
        try {
          capture.start(if (mode == "stream") "stream" else "transcribe")
          promise.resolve(null)
        } catch (error: Throwable) {
          capture.cancel()
          promise.reject(CaptureException())
        }
      }
    }

    Function("finishCapture") {
      captureExecutor.execute { capture.finish() }
    }

    Function("cancelCapture") {
      captureExecutor.execute { capture.cancel() }
    }

    Function("setCallAudio") { active: Boolean ->
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return@Function
      if (active) {
        if (callModeBefore == null) callModeBefore = audio.mode
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val devices = audio.availableCommunicationDevices
          val output = devices.firstOrNull { it.type in CALL_HEADSETS }
            ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          if (output != null) audio.setCommunicationDevice(output)
        } else {
          val headset = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in CALL_HEADSETS }
          @Suppress("DEPRECATION")
          audio.isSpeakerphoneOn = !headset
        }
      } else {
        val before = callModeBefore ?: return@Function
        callModeBefore = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          audio.clearCommunicationDevice()
        } else {
          @Suppress("DEPRECATION")
          audio.isSpeakerphoneOn = false
        }
        audio.mode = before
      }
    }

    AsyncFunction("unload") { promise: Promise ->
      synthesis.execute {
        tts?.release()
        tts = null
        loadedDirectory = null
        promise.resolve(null)
      }
    }

    Function("speak") { id: String, text: String, language: String, speaker: Int, steps: Int ->
      val own = generation.get()
      synthesis.execute {
        if (own != generation.get()) return@execute
        val voice = tts
        if (voice == null) {
          sendEvent("onSpeechError", mapOf("id" to id, "code" to "model-not-loaded"))
          return@execute
        }
        val audio = try {
          voice.generateWithConfig(
            text,
            GenerationConfig(
              silenceScale = 0.2f,
              speed = 1f,
              sid = speaker,
              numSteps = steps,
              extra = mapOf("lang" to language),
            ),
          )
        } catch (error: Throwable) {
          null
        }
        if (audio == null || audio.samples.isEmpty()) {
          sendEvent("onSpeechError", mapOf("id" to id, "code" to "inference-failed"))
          return@execute
        }
        if (own == generation.get()) parts.put(SpeechPart(id, audio.samples, audio.sampleRate, own))
      }
    }

    Function("playPcm") { id: String, pcm: Uint8Array, sampleRate: Int ->
      val bytes = ByteArray(pcm.byteLength)
      pcm.read(bytes, 0, pcm.byteLength)
      val shorts = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val samples = FloatArray(shorts.remaining()) { shorts.get(it) / 32768f }
      parts.put(SpeechPart(id, samples, sampleRate, generation.get()))
    }

    Function("setSpeed") { value: Double ->
      speed = value.toFloat()
      try {
        track?.let { applySpeed(it) }
      } catch (error: IllegalStateException) {
      }
    }

    Function("stop") {
      generation.incrementAndGet()
      parts.clear()
      track?.let {
        it.pause()
        it.flush()
      }
    }

    OnDestroy {
      generation.incrementAndGet()
      parts.clear()
      parts.put(SpeechPart(null, FloatArray(0), 0, -1))
      synthesis.execute {
        tts?.release()
        tts = null
      }
      synthesis.shutdown()
      captureExecutor.execute { capture.cancel() }
      captureExecutor.shutdown()
      recognition.execute {
        recognizer?.release()
        recognizer = null
      }
      recognition.shutdown()
    }
  }

  private fun loadRecognizer(location: String, model: RecognizerModel, threads: Int, promise: Promise) {
    recognition.execute {
      val directory = pathOf(location)
      if (recognizer?.directory == directory && recognizer?.model == model) {
        promise.resolve(null)
        return@execute
      }
      recognizer?.release()
      recognizer = null
      try {
        recognizer = OfflineSpeechRecognizer(directory, model, threads)
        promise.resolve(null)
      } catch (error: Throwable) {
        promise.reject(SpeechModelException())
      }
    }
  }

  private fun playLoop() {
    while (true) {
      val part = parts.take()
      val id = part.id ?: break
      if (part.generation != generation.get()) continue
      sendEvent("onSpeechStart", mapOf("id" to id))
      val completed = try {
        play(part)
      } catch (error: Throwable) {
        sendEvent("onSpeechError", mapOf("id" to id, "code" to "playback-failed"))
        continue
      }
      if (completed) sendEvent("onSpeechDone", mapOf("id" to id))
    }
    track?.release()
    track = null
  }

  private var trackRate = 0

  private fun play(part: SpeechPart): Boolean {
    val audio = trackFor(part.sampleRate)
    val stale = { part.generation != generation.get() }
    val head = { audio.playbackHeadPosition.toLong() and 0xffffffffL }
    val end = head() + part.samples.size
    if (audio.playState != AudioTrack.PLAYSTATE_PLAYING) audio.play()
    var offset = 0
    while (offset < part.samples.size && !stale()) {
      val count = audio.write(part.samples, offset, part.samples.size - offset, AudioTrack.WRITE_NON_BLOCKING)
      if (count < 0) break
      if (count == 0) Thread.sleep(10)
      offset += count
    }
    val deadline = System.nanoTime() + (part.samples.size * 1_000_000_000L / part.sampleRate * 4 / 3) + 2_000_000_000L
    while (!stale() && offset == part.samples.size && head() < end) {
      if (System.nanoTime() > deadline) break
      Thread.sleep(20)
    }
    return !stale() && offset == part.samples.size
  }

  private fun trackFor(sampleRate: Int): AudioTrack {
    val current = track
    if (current != null && trackRate == sampleRate) {
      return current
    }
    current?.release()
    val minimum = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val created = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(minimum * 4)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    applySpeed(created)
    track = created
    trackRate = sampleRate
    return created
  }

  private fun applySpeed(audio: AudioTrack) {
    audio.playbackParams = PlaybackParams().setSpeed(speed).setPitch(1f)
  }
}
