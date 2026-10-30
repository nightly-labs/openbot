import AVFoundation
import ExpoModulesCore
import SherpaOnnxC
import UIKit

/// The files of the Supertonic 3 export, as `@openbot/contracts/speech-models` downloads them.
private let supertonicFiles = (
  durationPredictor: "duration_predictor.int8.onnx",
  textEncoder: "text_encoder.int8.onnx",
  vectorEstimator: "vector_estimator.int8.onnx",
  vocoder: "vocoder.int8.onnx",
  ttsJson: "tts.json",
  unicodeIndexer: "unicode_indexer.bin",
  voiceStyle: "voice.bin"
)

/// One part of a reply that waits to play: its id for the events, and its mono samples.
private struct SpeechPart {
  let id: String
  let samples: [Float]
  let sampleRate: Double
}

/// The Supertonic 3 model in sherpa-onnx. Only the synthesis queue uses it.
private final class SupertonicVoice {
  let directory: String
  let tts: OpaquePointer

  init(directory: String, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    let paths = [
      file(supertonicFiles.durationPredictor), file(supertonicFiles.textEncoder), file(supertonicFiles.vectorEstimator),
      file(supertonicFiles.vocoder), file(supertonicFiles.ttsJson), file(supertonicFiles.unicodeIndexer),
      file(supertonicFiles.voiceStyle), strdup("cpu"),
    ]
    defer { paths.forEach { free($0) } }
    var config = SherpaOnnxOfflineTtsConfig()
    config.model.supertonic.duration_predictor = UnsafePointer(paths[0])
    config.model.supertonic.text_encoder = UnsafePointer(paths[1])
    config.model.supertonic.vector_estimator = UnsafePointer(paths[2])
    config.model.supertonic.vocoder = UnsafePointer(paths[3])
    config.model.supertonic.tts_json = UnsafePointer(paths[4])
    config.model.supertonic.unicode_indexer = UnsafePointer(paths[5])
    config.model.supertonic.voice_style = UnsafePointer(paths[6])
    config.model.provider = UnsafePointer(paths[7])
    config.model.num_threads = Int32(threads)
    config.model.debug = 0
    config.max_num_sentences = 1
    guard let tts = SherpaOnnxCreateOfflineTts(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.tts = tts
  }

  deinit {
    SherpaOnnxDestroyOfflineTts(tts)
  }

  func generate(text: String, language: String, speaker: Int, steps: Int) -> (samples: [Float], sampleRate: Double)? {
    var generation = SherpaOnnxGenerationConfig()
    generation.sid = Int32(speaker)
    generation.speed = 1
    generation.silence_scale = 0.2
    generation.num_steps = Int32(steps)
    // The language is the one value of the reply that the JSON carries; it is one of the codes
    // that `SPEECH_LANGUAGES` lists, so it needs no escaping.
    let extra = "{\"lang\":\"\(language)\"}"
    let audio = text.withCString { textPointer in
      extra.withCString { extraPointer -> UnsafePointer<SherpaOnnxGeneratedAudio>? in
        generation.extra = extraPointer
        return SherpaOnnxOfflineTtsGenerateWithConfig(tts, textPointer, &generation, nil, nil)
      }
    }
    guard let audio else { return nil }
    defer { SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio) }
    let count = Int(audio.pointee.n)
    guard count > 0, let samples = audio.pointee.samples else { return nil }
    return (Array(UnsafeBufferPointer(start: samples, count: count)), Double(audio.pointee.sample_rate))
  }
}

private enum SpeechError: Error {
  case modelLoadFailed
}

/// The files of the Parakeet TDT 0.6B v3 export, as `@openbot/contracts/speech-models` downloads them.
private let parakeetFiles = (
  encoder: "encoder.int8.onnx",
  decoder: "decoder.int8.onnx",
  joiner: "joiner.int8.onnx",
  tokens: "tokens.txt"
)

/// Parakeet TDT 0.6B v3 in sherpa-onnx: the speech recognizer of desktop. It finds the spoken
/// language itself. Only the recognition queue uses it.
private final class ParakeetRecognizer {
  let directory: String
  let recognizer: OpaquePointer

  init(directory: String, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    let strings = [
      file(parakeetFiles.encoder), file(parakeetFiles.decoder), file(parakeetFiles.joiner), file(parakeetFiles.tokens),
      strdup("cpu"), strdup("nemo_transducer"), strdup("greedy_search"),
    ]
    defer { strings.forEach { free($0) } }
    var config = SherpaOnnxOfflineRecognizerConfig()
    config.feat_config.sample_rate = Int32(captureSampleRate)
    config.feat_config.feature_dim = 80
    config.model_config.transducer.encoder = UnsafePointer(strings[0])
    config.model_config.transducer.decoder = UnsafePointer(strings[1])
    config.model_config.transducer.joiner = UnsafePointer(strings[2])
    config.model_config.tokens = UnsafePointer(strings[3])
    config.model_config.provider = UnsafePointer(strings[4])
    config.model_config.model_type = UnsafePointer(strings[5])
    config.model_config.num_threads = Int32(threads)
    config.model_config.debug = 0
    config.decoding_method = UnsafePointer(strings[6])
    config.max_active_paths = 4
    guard let recognizer = SherpaOnnxCreateOfflineRecognizer(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.recognizer = recognizer
  }

  deinit {
    SherpaOnnxDestroyOfflineRecognizer(recognizer)
  }

  func decode(_ samples: [Float]) -> String {
    guard !samples.isEmpty, let stream = SherpaOnnxCreateOfflineStream(recognizer) else { return "" }
    defer { SherpaOnnxDestroyOfflineStream(stream) }
    samples.withUnsafeBufferPointer { buffer in
      SherpaOnnxAcceptWaveformOffline(stream, Int32(captureSampleRate), buffer.baseAddress, Int32(buffer.count))
    }
    SherpaOnnxDecodeOfflineStream(recognizer, stream)
    guard let result = SherpaOnnxGetOfflineStreamResult(stream) else { return "" }
    defer { SherpaOnnxDestroyOfflineRecognizerResult(result) }
    guard let text = result.pointee.text else { return "" }
    return String(cString: text).trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

/// The sample rate of the microphone audio for Parakeet and ElevenLabs.
private let captureSampleRate = 16_000.0
/// One frame of the level meter and of the audio sent to JavaScript: 100 ms.
private let frameSamples = 1_600

/// The loudness above the room noise, as the desktop voice conversation measures it, in dB.
private struct LoudnessMeter {
  private var noise = Double.infinity
  private var peak = -Double.infinity

  /// From 0 (the room noise) to 1 (the loudest speech so far).
  mutating func loudness(_ frame: ArraySlice<Float>) -> Double {
    var sum = 0.0
    for sample in frame { sum += Double(sample) * Double(sample) }
    let db = 20 * log10(max((sum / Double(max(frame.count, 1))).squareRoot(), 1e-5))
    if db > -90 {
      noise = db < noise ? db : min(db, noise + 0.125)
      peak = max(db, peak - 0.06)
    }
    let range = max(12, peak - noise - 6)
    return min(1, max(0, (db - noise - 6) / range))
  }
}

/// The loudness that counts as speech, as on desktop.
private let speechLoudness = 0.3
/// Speech for this long starts a segment; silence for this long after it ends the segment.
private let speechStartFrames = 3
private let segmentEndFrames = 7
/// A segment this long ends even while the user speaks, so one decode stays short.
private let maximumSegmentSamples = 25 * 16_000
/// Silence before speech is kept for this long, so the first word is not cut.
private let leadingSilenceSamples = 4_800
/// How often the words of the current segment are recognized again while the user speaks.
private let interimFrames = 10

/// The microphone, converted to 16 kHz mono. In `transcribe` mode it cuts the speech into segments
/// at the user's pauses and recognizes each one with Parakeet; in `stream` mode it sends the audio.
private final class SpeechCapture {
  let queue = DispatchQueue(label: "run.openbot.speech.capture", qos: .userInitiated)
  /// Its own engine: the playback engine changes its configuration when a reply starts.
  let engine = AVAudioEngine()
  private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: captureSampleRate, channels: 1, interleaved: false)!
  private var converter: AVAudioConverter?
  private var meter = LoudnessMeter()
  private var pending: [Float] = []
  private var segment: [Float] = []
  private var loudFrames = 0
  private var quietFrames = 0
  private var spoke = false
  private var framesSinceInterim = 0
  private var interimRunning = false
  /// Each start, finish and cancel makes the work of the session before it stale.
  private(set) var session = 0
  private(set) var mode: String?

  private let recognition: DispatchQueue
  private let recognizer: () -> ParakeetRecognizer?
  private let send: (String, [String: Any]) -> Void

  init(recognition: DispatchQueue, recognizer: @escaping () -> ParakeetRecognizer?, send: @escaping (String, [String: Any]) -> Void) {
    self.recognition = recognition
    self.recognizer = recognizer
    self.send = send
  }

  /// Runs on `queue`.
  func start(mode: String) throws {
    stopEngine()
    session += 1
    self.mode = mode
    reset()
    meter = LoudnessMeter()
    let audio = AVAudioSession.sharedInstance()
    guard audio.recordPermission == .granted else { throw CaptureError.permission }
    try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP])
    try audio.setActive(true)
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0, let converter = AVAudioConverter(from: format, to: target) else {
      throw CaptureError.noMicrophone
    }
    self.converter = converter
    let own = session
    input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
      guard let self, let samples = self.convert(buffer) else { return }
      self.queue.async {
        guard own == self.session else { return }
        self.receive(samples)
      }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
  }

  /// Runs on `queue`. Recognizes the speech that is left, then sends the end after it.
  func finish() {
    guard mode != nil else { return }
    stopEngine()
    let own = session
    if mode == "transcribe" {
      if spoke { commit() }
      recognition.async { [weak self] in
        guard let self else { return }
        self.queue.async {
          guard own == self.session else { return }
          self.end(error: nil)
        }
      }
    } else {
      if !pending.isEmpty { sendAudio(pending[...]) }
      end(error: nil)
    }
  }

  /// Runs on `queue`. No event follows.
  func cancel() {
    stopEngine()
    session += 1
    mode = nil
    reset()
  }

  /// Runs on `queue`. The microphone stopped without a finish, such as for a phone call.
  func fail(_ code: String) {
    guard mode != nil else { return }
    stopEngine()
    end(error: code)
  }

  private func end(error: String?) {
    session += 1
    mode = nil
    reset()
    send("onCaptureEnd", error.map { ["error": $0] } ?? [:])
  }

  private func reset() {
    pending.removeAll()
    segment.removeAll()
    loudFrames = 0
    quietFrames = 0
    spoke = false
    framesSinceInterim = 0
  }

  private func stopEngine() {
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    converter = nil
  }

  /// Runs on the tap's thread, one buffer after another, so the converter keeps its state.
  private func convert(_ buffer: AVAudioPCMBuffer) -> [Float]? {
    guard let converter else { return nil }
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * captureSampleRate / buffer.format.sampleRate) + 1
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, let channel = output.floatChannelData?[0] else { return nil }
    return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
  }

  private func receive(_ samples: [Float]) {
    pending.append(contentsOf: samples)
    while pending.count >= frameSamples {
      let frame = pending[0..<frameSamples]
      handle(frame)
      pending.removeFirst(frameSamples)
    }
  }

  private func handle(_ frame: ArraySlice<Float>) {
    let loudness = meter.loudness(frame)
    let speaking = loudness >= speechLoudness
    send("onCaptureLevel", ["level": loudness * loudness, "speaking": speaking])
    if mode == "stream" {
      sendAudio(frame)
      return
    }
    segment.append(contentsOf: frame)
    if speaking {
      loudFrames += 1
      quietFrames = 0
      if loudFrames >= speechStartFrames { spoke = true }
    } else {
      loudFrames = 0
      quietFrames += 1
    }
    if !spoke {
      if segment.count > 2 * leadingSilenceSamples { segment.removeFirst(segment.count - leadingSilenceSamples) }
      return
    }
    framesSinceInterim += 1
    if quietFrames >= segmentEndFrames || segment.count >= maximumSegmentSamples {
      commit()
    } else if framesSinceInterim >= interimFrames && !interimRunning {
      interim()
    }
  }

  /// Recognizes the segment once more and sends it as final; the next words start a new segment.
  private func commit() {
    let samples = segment
    let own = session
    segment.removeAll()
    loudFrames = 0
    quietFrames = 0
    spoke = false
    framesSinceInterim = 0
    recognition.async { [weak self] in
      guard let self, let recognizer = self.recognizer() else { return }
      let text = recognizer.decode(samples)
      self.queue.async {
        guard own == self.session else { return }
        self.send("onCaptureText", ["text": text, "final": true])
      }
    }
  }

  /// Shows the words of the segment so far. One runs at a time, so a slow phone skips some.
  private func interim() {
    let samples = segment
    let own = session
    framesSinceInterim = 0
    interimRunning = true
    recognition.async { [weak self] in
      guard let self else { return }
      let text = self.recognizer()?.decode(samples) ?? ""
      self.queue.async {
        self.interimRunning = false
        // A final text of this segment can be on its way already; it is sent after this one.
        guard own == self.session, self.mode == "transcribe" else { return }
        self.send("onCaptureText", ["text": text, "final": false])
      }
    }
  }

  private func sendAudio(_ frame: ArraySlice<Float>) {
    var data = Data(capacity: frame.count * 2)
    for sample in frame {
      let value = Int16(max(-1, min(1, sample)) * 32_767).littleEndian
      withUnsafeBytes(of: value) { data.append(contentsOf: $0) }
    }
    send("onCaptureAudio", ["pcm": data.base64EncodedString()])
  }
}

private enum CaptureError: Error {
  case permission
  case noMicrophone
}

/// The playback of reply parts, one after another, on one audio engine.
private final class SpeechPlayer {
  private let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private var format: AVAudioFormat?
  /// The parts that are scheduled, in order. The first one plays.
  private var scheduled: [String] = []
  private let onStart: (String) -> Void
  private let onDone: (String) -> Void
  let queue = DispatchQueue(label: "run.openbot.speech.playback")

  init(onStart: @escaping (String) -> Void, onDone: @escaping (String) -> Void) {
    self.onStart = onStart
    self.onDone = onDone
    engine.attach(node)
  }

  /// Runs on `queue`. A part of a stopped reply is dropped by its caller.
  func play(_ part: SpeechPart, isCurrent: @escaping () -> Bool) throws {
    guard
      let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: part.sampleRate, channels: 1, interleaved: false),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(part.samples.count)),
      let channel = buffer.floatChannelData?[0]
    else { return }
    part.samples.withUnsafeBufferPointer { source in
      if let base = source.baseAddress { channel.update(from: base, count: part.samples.count) }
    }
    buffer.frameLength = AVAudioFrameCount(part.samples.count)
    try start(format: format)
    let idle = scheduled.isEmpty
    scheduled.append(part.id)
    if idle { onStart(part.id) }
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.queue.async {
        guard isCurrent(), self.scheduled.first == part.id else { return }
        self.scheduled.removeFirst()
        self.onDone(part.id)
        if let next = self.scheduled.first { self.onStart(next) }
      }
    }
  }

  /// Runs on `queue`. The completions of the dropped parts see that they are not current.
  func stop() {
    scheduled.removeAll()
    node.stop()
  }

  private func start(format: AVAudioFormat) throws {
    // The recognizer leaves the session in its measurement mode, which plays quietly. A reply plays
    // at the normal volume on the speaker, and the ringer switch does not silence it.
    let session = AVAudioSession.sharedInstance()
    if session.category != .playAndRecord || session.mode != .default {
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
    }
    try session.setActive(true)
    if self.format != format {
      // A new sample rate, such as a reply of the other voice engine, needs a new connection.
      node.stop()
      engine.disconnectNodeOutput(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      self.format = format
    }
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    if !node.isPlaying { node.play() }
  }
}

public class SpeechModule: Module {
  private let synthesis = DispatchQueue(label: "run.openbot.speech.synthesis", qos: .userInitiated)
  private var voice: SupertonicVoice?
  /// Only `recognitionQueue` reads and writes it.
  private var recognizer: ParakeetRecognizer?
  private let recognitionQueue = DispatchQueue(label: "run.openbot.speech.recognition", qos: .userInitiated)
  private var observers: [NSObjectProtocol] = []
  private lazy var capture = SpeechCapture(
    recognition: recognitionQueue,
    recognizer: { [weak self] in self?.recognizer },
    send: { [weak self] name, body in self?.sendEvent(name, body) }
  )
  private let lock = NSLock()
  /// Each stop makes the parts that wait or play stale.
  private var generation = 0
  private lazy var player = SpeechPlayer(
    onStart: { [weak self] id in self?.sendEvent("onSpeechStart", ["id": id]) },
    onDone: { [weak self] id in self?.sendEvent("onSpeechDone", ["id": id]) }
  )

  private func currentGeneration() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  private func enqueue(_ part: SpeechPart, generation own: Int) {
    let player = self.player
    player.queue.async { [weak self] in
      guard let self, own == self.currentGeneration() else { return }
      do {
        try player.play(part) { [weak self] in own == self?.currentGeneration() }
      } catch {
        self.sendEvent("onSpeechError", ["id": part.id, "code": "playback-failed"])
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("OpenBotSpeech")

    Events("onSpeechStart", "onSpeechDone", "onSpeechError", "onCaptureLevel", "onCaptureAudio", "onCaptureText", "onCaptureEnd")

    OnCreate {
      let center = NotificationCenter.default
      // A phone call or another app takes the microphone, or the route changes, such as headphones
      // that connect: the engine stops, and the session ends with what it heard.
      let capture = self.capture
      let stopped = { (_: Notification) in
        capture.queue.async { capture.fail("interrupted") }
      }
      observers = [
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { notification in
          let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
          if type == .began { stopped(notification) }
        },
        // The notice can also come for the change that the start itself made; only a stopped engine ends it.
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: capture.engine, queue: nil) { _ in
          capture.queue.async { if !capture.engine.isRunning { capture.fail("interrupted") } }
        },
        // About 1 GB that the next session can load again.
        center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
          guard let self else { return }
          capture.queue.async {
            guard capture.mode == nil else { return }
            self.recognitionQueue.async { self.recognizer = nil }
          }
        },
      ]
    }

    /// Loads Parakeet from a downloaded model directory. A second call with the same directory keeps
    /// the loaded model.
    AsyncFunction("loadRecognizer") { (directory: URL, threads: Int, promise: Promise) in
      self.recognitionQueue.async {
        if self.recognizer?.directory == directory.path {
          promise.resolve(nil)
          return
        }
        self.recognizer = nil
        do {
          self.recognizer = try ParakeetRecognizer(directory: directory.path, threads: threads)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_SPEECH_MODEL", "The speech recognition model could not load.")
        }
      }
    }

    /// Frees the recognizer, such as before its files are deleted.
    AsyncFunction("unloadRecognizer") { (promise: Promise) in
      self.recognitionQueue.async {
        self.recognizer = nil
        promise.resolve(nil)
      }
    }

    /// Opens the microphone: `transcribe` recognizes speech with Parakeet, `stream` sends the audio.
    AsyncFunction("startCapture") { (mode: String, promise: Promise) in
      let capture = self.capture
      capture.queue.async {
        do {
          try capture.start(mode: mode == "stream" ? "stream" : "transcribe")
          promise.resolve(nil)
        } catch CaptureError.permission {
          capture.cancel()
          promise.reject("ERR_CAPTURE_PERMISSION", "Microphone access is off.")
        } catch {
          capture.cancel()
          promise.reject("ERR_CAPTURE", "The microphone could not start.")
        }
      }
    }

    /// Closes the microphone, sends the text of the speech that is left, then `onCaptureEnd`.
    Function("finishCapture") {
      let capture = self.capture
      capture.queue.async { capture.finish() }
    }

    /// Closes the microphone and drops the speech that was not sent.
    Function("cancelCapture") {
      let capture = self.capture
      capture.queue.async { capture.cancel() }
    }

    /// Loads Supertonic 3 from a downloaded model directory. A second call with the same directory
    /// keeps the loaded model.
    AsyncFunction("load") { (directory: URL, threads: Int, promise: Promise) in
      self.synthesis.async {
        if self.voice?.directory == directory.path {
          promise.resolve(nil)
          return
        }
        self.voice = nil
        do {
          self.voice = try SupertonicVoice(directory: directory.path, threads: threads)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_SPEECH_MODEL", "The speech model could not load.")
        }
      }
    }

    /// The directory for downloaded voice models: Application Support, out of the backup. The phone
    /// can download the files again, so they must not fill the user's iCloud backup.
    Function("modelRoot") { () throws -> String in
      var root = try FileManager.default
        .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("voice", isDirectory: true)
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try root.setResourceValues(values)
      return root.absoluteString
    }

    /// Frees the model, such as before its files are deleted.
    AsyncFunction("unload") { (promise: Promise) in
      self.synthesis.async {
        self.voice = nil
        promise.resolve(nil)
      }
    }

    /// Reads one part of a reply with Supertonic 3 and plays it after the parts before it. The next
    /// part is synthesized while this one plays.
    Function("speak") { (id: String, text: String, language: String, speaker: Int, steps: Int) in
      let own = self.currentGeneration()
      self.synthesis.async {
        guard own == self.currentGeneration() else { return }
        guard let voice = self.voice else {
          self.sendEvent("onSpeechError", ["id": id, "code": "model-not-loaded"])
          return
        }
        guard let audio = voice.generate(text: text, language: language, speaker: speaker, steps: steps) else {
          self.sendEvent("onSpeechError", ["id": id, "code": "inference-failed"])
          return
        }
        self.enqueue(SpeechPart(id: id, samples: audio.samples, sampleRate: audio.sampleRate), generation: own)
      }
    }

    /// Plays little-endian 16-bit mono PCM, such as a reply part from ElevenLabs, after the parts before it.
    Function("playPcm") { (id: String, pcm: Uint8Array, sampleRate: Int) in
      let own = self.currentGeneration()
      // The typed array belongs to JavaScript: copy it before this call returns.
      let data = Data(bytes: pcm.rawPointer, count: pcm.byteLength)
      var samples = [Float](repeating: 0, count: data.count / 2)
      data.withUnsafeBytes { raw in
        for index in samples.indices {
          samples[index] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32_768
        }
      }
      self.enqueue(SpeechPart(id: id, samples: samples, sampleRate: Double(sampleRate)), generation: own)
    }

    /// Stops the part that plays and drops the parts that wait.
    Function("stop") {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      let player = self.player
      player.queue.async { player.stop() }
    }

    OnDestroy {
      self.lock.lock()
      self.generation += 1
      self.lock.unlock()
      let player = self.player
      player.queue.sync { player.stop() }
      self.synthesis.sync { self.voice = nil }
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      let capture = self.capture
      capture.queue.sync { capture.cancel() }
      self.recognitionQueue.sync { self.recognizer = nil }
    }
  }
}
