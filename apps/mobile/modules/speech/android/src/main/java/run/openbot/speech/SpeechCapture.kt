package run.openbot.speech

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** The sample rate of the microphone audio for Parakeet and ElevenLabs. */
internal const val CAPTURE_SAMPLE_RATE = 16_000
/** One frame of the level meter and of the audio sent to JavaScript: 100 ms. */
private const val FRAME_SAMPLES = 1_600
/** The loudness that counts as speech, as on desktop. */
private const val SPEECH_LOUDNESS = 0.3
/** Speech for this long starts a segment; silence for this long after it ends the segment. */
private const val SPEECH_START_FRAMES = 3
private const val SEGMENT_END_FRAMES = 7
/** A segment this long ends even while the user speaks, so one decode stays short. */
private const val MAXIMUM_SEGMENT_SAMPLES = 25 * CAPTURE_SAMPLE_RATE
/** Silence before speech is kept for this long, so the first word is not cut. */
private const val LEADING_SILENCE_SAMPLES = 4_800
/** How often the words of the current segment are recognized again while the user speaks. */
private const val INTERIM_FRAMES = 10

/**
 * Parakeet TDT 0.6B v3 in sherpa-onnx: the speech recognizer of desktop. It finds the spoken
 * language itself. Only the recognition executor uses it.
 */
internal class ParakeetRecognizer(val directory: String, threads: Int) {
  private val recognizer: OfflineRecognizer

  init {
    val file = { name: String -> File(directory, name).absolutePath }
    recognizer = OfflineRecognizer(
      config = OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = CAPTURE_SAMPLE_RATE, featureDim = 80),
        modelConfig = OfflineModelConfig(
          transducer = OfflineTransducerModelConfig(
            encoder = file("encoder.int8.onnx"),
            decoder = file("decoder.int8.onnx"),
            joiner = file("joiner.int8.onnx"),
          ),
          tokens = file("tokens.txt"),
          numThreads = threads,
          debug = false,
          provider = "cpu",
          modelType = "nemo_transducer",
        ),
        decodingMethod = "greedy_search",
      ),
    )
  }

  fun decode(samples: FloatArray): String {
    if (samples.isEmpty()) return ""
    val stream = recognizer.createStream()
    return try {
      stream.acceptWaveform(samples, CAPTURE_SAMPLE_RATE)
      recognizer.decode(stream)
      recognizer.getResult(stream).text.trim()
    } finally {
      stream.release()
    }
  }

  fun release() = recognizer.release()
}

/** The samples of the current segment, without a copy for each frame. */
private class SampleBuffer {
  private var samples = FloatArray(16 * FRAME_SAMPLES)
  var size = 0
    private set

  fun append(frame: FloatArray) {
    if (size + frame.size > samples.size) samples = samples.copyOf(max(samples.size * 2, size + frame.size))
    frame.copyInto(samples, size)
    size += frame.size
  }

  /** Keeps only the newest `count` samples. */
  fun keepLast(count: Int) {
    if (size <= count) return
    samples.copyInto(samples, 0, size - count, size)
    size = count
  }

  fun toArray(): FloatArray = samples.copyOf(size)

  fun clear() {
    size = 0
  }
}

/** The loudness above the room noise, as the desktop voice conversation measures it, in dB. */
private class LoudnessMeter {
  private var noise = Double.POSITIVE_INFINITY
  private var peak = Double.NEGATIVE_INFINITY

  /** From 0 (the room noise) to 1 (the loudest speech so far). */
  fun loudness(frame: FloatArray): Double {
    var sum = 0.0
    for (sample in frame) sum += sample.toDouble() * sample
    val db = 20 * log10(max(sqrt(sum / max(frame.size, 1)), 1e-5))
    if (db > -90) {
      noise = if (db < noise) db else min(db, noise + 0.125)
      peak = max(db, peak - 0.06)
    }
    val range = max(12.0, peak - noise - 6)
    return min(1.0, max(0.0, (db - noise - 6) / range))
  }
}

/**
 * The microphone at 16 kHz mono. In `transcribe` mode it cuts the speech into segments at the user's
 * pauses and recognizes each one with Parakeet; in `stream` mode it sends the audio. All state
 * belongs to `executor`; a reader thread hands it the frames.
 */
internal class SpeechCapture(
  private val executor: ExecutorService,
  private val recognition: ExecutorService,
  private val recognizer: () -> ParakeetRecognizer?,
  private val send: (String, Map<String, Any?>) -> Unit,
) {
  private var record: AudioRecord? = null
  private var reader: Thread? = null
  private var meter = LoudnessMeter()
  private val segment = SampleBuffer()
  private var loudFrames = 0
  private var quietFrames = 0
  private var spoke = false
  private var framesSinceInterim = 0
  private var interimRunning = false
  /** Each start, finish and cancel makes the work of the session before it stale. */
  @Volatile private var session = 0
  var mode: String? = null
    private set

  class PermissionException : Exception()

  /** Runs on `executor`. The caller checked the microphone permission. */
  @SuppressLint("MissingPermission")
  fun start(mode: String) {
    stopRecord()
    session += 1
    this.mode = mode
    reset()
    meter = LoudnessMeter()
    val minimum = AudioRecord.getMinBufferSize(CAPTURE_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val created = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      CAPTURE_SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_FLOAT,
      max(minimum, FRAME_SAMPLES * 4 * 4),
    )
    if (created.state != AudioRecord.STATE_INITIALIZED) {
      created.release()
      this.mode = null
      throw IllegalStateException("The microphone could not start.")
    }
    created.startRecording()
    record = created
    val own = session
    reader = Thread({
      val frame = FloatArray(FRAME_SAMPLES)
      var filled = 0
      while (own == session) {
        val count = created.read(frame, filled, FRAME_SAMPLES - filled, AudioRecord.READ_BLOCKING)
        if (count < 0) {
          executor.execute { if (own == session) fail("interrupted") }
          break
        }
        filled += count
        if (filled == FRAME_SAMPLES) {
          val copy = frame.copyOf()
          filled = 0
          executor.execute { if (own == session) handle(copy) }
        }
      }
    }, "openbot-speech-capture").apply { start() }
  }

  /** Runs on `executor`. Recognizes the speech that is left, then sends the end after it. */
  fun finish() {
    val current = mode ?: return
    stopRecord()
    val own = session
    if (current == "transcribe") {
      if (spoke) commit()
      recognition.execute { executor.execute { if (own == session) end(null) } }
    } else {
      end(null)
    }
  }

  /** Runs on `executor`. No event follows. */
  fun cancel() {
    stopRecord()
    session += 1
    mode = null
    reset()
  }

  /** Runs on `executor`. The microphone stopped without a finish. */
  fun fail(code: String) {
    if (mode == null) return
    stopRecord()
    end(code)
  }

  private fun end(error: String?) {
    session += 1
    mode = null
    reset()
    send("onCaptureEnd", if (error == null) emptyMap() else mapOf("error" to error))
  }

  private fun reset() {
    segment.clear()
    loudFrames = 0
    quietFrames = 0
    spoke = false
    framesSinceInterim = 0
  }

  private fun stopRecord() {
    // The reader sees the new session, or a read error from the stopped record, and ends.
    val current = record ?: return
    record = null
    session += 1
    try {
      current.stop()
    } catch (error: IllegalStateException) {
      // It never started.
    }
    reader?.join(500)
    reader = null
    current.release()
  }

  private fun handle(frame: FloatArray) {
    val loudness = meter.loudness(frame)
    val speaking = loudness >= SPEECH_LOUDNESS
    send("onCaptureLevel", mapOf("level" to loudness * loudness, "speaking" to speaking))
    if (mode == "stream") {
      sendAudio(frame)
      return
    }
    segment.append(frame)
    if (speaking) {
      loudFrames += 1
      quietFrames = 0
      if (loudFrames >= SPEECH_START_FRAMES) spoke = true
    } else {
      loudFrames = 0
      quietFrames += 1
    }
    if (!spoke) {
      if (segment.size > 2 * LEADING_SILENCE_SAMPLES) segment.keepLast(LEADING_SILENCE_SAMPLES)
      return
    }
    framesSinceInterim += 1
    if (quietFrames >= SEGMENT_END_FRAMES || segment.size >= MAXIMUM_SEGMENT_SAMPLES) {
      commit()
    } else if (framesSinceInterim >= INTERIM_FRAMES && !interimRunning) {
      interim()
    }
  }

  /** Recognizes the segment once more and sends it as final; the next words start a new segment. */
  private fun commit() {
    val samples = segment.toArray()
    val own = session
    reset()
    recognition.execute {
      val text = decode(samples)
      executor.execute { if (own == session) send("onCaptureText", mapOf("text" to text, "final" to true)) }
    }
  }

  /** Shows the words of the segment so far. One runs at a time, so a slow phone skips some. */
  private fun interim() {
    val samples = segment.toArray()
    val own = session
    framesSinceInterim = 0
    interimRunning = true
    recognition.execute {
      val text = decode(samples)
      executor.execute {
        interimRunning = false
        // A final text of this segment can be on its way already; it is sent after this one.
        if (own == session && mode == "transcribe") send("onCaptureText", mapOf("text" to text, "final" to false))
      }
    }
  }

  private fun decode(samples: FloatArray): String =
    try {
      recognizer()?.decode(samples) ?: ""
    } catch (error: Throwable) {
      ""
    }

  private fun sendAudio(frame: FloatArray) {
    val bytes = ByteBuffer.allocate(frame.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (sample in frame) bytes.putShort((max(-1f, min(1f, sample)) * 32_767).toInt().toShort())
    send("onCaptureAudio", mapOf("pcm" to Base64.encodeToString(bytes.array(), Base64.NO_WRAP)))
  }
}
