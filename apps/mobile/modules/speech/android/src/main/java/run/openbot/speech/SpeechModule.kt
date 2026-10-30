package run.openbot.speech

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.net.Uri
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

/** One part of a reply that waits to play. A null id is the signal that ends the playback thread. */
private class SpeechPart(val id: String?, val samples: FloatArray, val sampleRate: Int, val generation: Int)

private class SpeechModelException : CodedException("ERR_SPEECH_MODEL", "The speech model could not load.", null)

private class CapturePermissionException : CodedException("ERR_CAPTURE_PERMISSION", "Microphone access is off.", null)

private class CaptureException : CodedException("ERR_CAPTURE", "The microphone could not start.", null)

/** A path from a `file://` URI, as the app's file system API names its files, or a plain path. */
private fun pathOf(location: String): String =
  if (location.startsWith("file:")) Uri.parse(location).path ?: location else location

/**
 * Reads replies aloud with Supertonic 3 through sherpa-onnx, and plays speech audio. One thread
 * synthesizes the parts of a reply in order, and another plays them, so the next part is synthesized
 * while one plays. A stop makes the parts that wait or play stale.
 */
class SpeechModule : Module() {
  private val synthesis = Executors.newSingleThreadExecutor()
  private val parts = LinkedBlockingQueue<SpeechPart>()
  private val generation = AtomicInteger(0)
  private var tts: OfflineTts? = null
  private var loadedDirectory: String? = null
  @Volatile private var track: AudioTrack? = null
  private var playback: Thread? = null
  /** Only the recognition executor reads and writes it. */
  private var recognizer: ParakeetRecognizer? = null
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

    /** Loads Supertonic 3 from a downloaded model directory. The same directory keeps the loaded model. */
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

    /**
     * The directory for downloaded voice models. It is in the app's files, because the app's file
     * system API writes only there and in the cache. Auto Backup leaves it out: the app's backup rules,
     * from expo-secure-store, include only shared preferences. A model is over the backup quota of the
     * whole app, and the phone can download it again.
     */
    Function("modelRoot") {
      val context = appContext.reactContext ?: throw SpeechModelException()
      val root = File(context.filesDir, "voice").apply { mkdirs() }
      Uri.fromFile(root).toString()
    }

    /** Loads Parakeet from a downloaded model directory. The same directory keeps the loaded model. */
    AsyncFunction("loadRecognizer") { location: String, threads: Int, promise: Promise ->
      recognition.execute {
        val directory = pathOf(location)
        if (recognizer?.directory == directory) {
          promise.resolve(null)
          return@execute
        }
        recognizer?.release()
        recognizer = null
        try {
          recognizer = ParakeetRecognizer(directory, threads)
          promise.resolve(null)
        } catch (error: Throwable) {
          promise.reject(SpeechModelException())
        }
      }
    }

    /** Frees the recognizer, such as before its files are deleted. */
    AsyncFunction("unloadRecognizer") { promise: Promise ->
      recognition.execute {
        recognizer?.release()
        recognizer = null
        promise.resolve(null)
      }
    }

    /** Opens the microphone: `transcribe` recognizes speech with Parakeet, `stream` sends the audio. */
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

    /** Closes the microphone, sends the text of the speech that is left, then `onCaptureEnd`. */
    Function("finishCapture") {
      captureExecutor.execute { capture.finish() }
    }

    /** Closes the microphone and drops the speech that was not sent. */
    Function("cancelCapture") {
      captureExecutor.execute { capture.cancel() }
    }

    /** Frees the model, such as before its files are deleted. */
    AsyncFunction("unload") { promise: Promise ->
      synthesis.execute {
        tts?.release()
        tts = null
        loadedDirectory = null
        promise.resolve(null)
      }
    }

    /** Reads one part of a reply with Supertonic 3 and plays it after the parts before it. */
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

    /** Plays little-endian 16-bit mono PCM, such as a reply part from ElevenLabs, after the parts before it. */
    Function("playPcm") { id: String, pcm: Uint8Array, sampleRate: Int ->
      // The typed array belongs to JavaScript: copy it before this call returns.
      val bytes = ByteArray(pcm.byteLength)
      pcm.read(bytes, 0, pcm.byteLength)
      val shorts = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val samples = FloatArray(shorts.remaining()) { shorts.get(it) / 32768f }
      parts.put(SpeechPart(id, samples, sampleRate, generation.get()))
    }

    /** Stops the part that plays and drops the parts that wait. */
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

  /** Plays the parts in order, one at a time, on one audio track for each sample rate. */
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

  /** Writes the part and waits until it has played. False when a stop came first. */
  private fun play(part: SpeechPart): Boolean {
    val audio = trackFor(part.sampleRate)
    val stale = { part.generation != generation.get() }
    // The head counts from the last flush: `stop` flushes the track, also while no part plays.
    val head = { audio.playbackHeadPosition.toLong() and 0xffffffffL }
    val end = head() + part.samples.size
    if (audio.playState != AudioTrack.PLAYSTATE_PLAYING) audio.play()
    var offset = 0
    // Non-blocking: a write to a track that `stop` paused would otherwise wait for ever.
    while (offset < part.samples.size && !stale()) {
      val count = audio.write(part.samples, offset, part.samples.size - offset, AudioTrack.WRITE_NON_BLOCKING)
      if (count < 0) break
      if (count == 0) Thread.sleep(10)
      offset += count
    }
    // The track plays what was written after `write` returns: wait for its head to reach the end,
    // and no longer than the part lasts and a little more, in case the track stalls.
    val deadline = System.nanoTime() + (part.samples.size * 1_000_000_000L / part.sampleRate) + 2_000_000_000L
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
    track = created
    trackRate = sampleRate
    return created
  }
}
