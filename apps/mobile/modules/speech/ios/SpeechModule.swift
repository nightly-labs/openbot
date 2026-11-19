import AVFoundation
import ExpoModulesCore
import SherpaOnnxC
import UIKit

private let supertonicFiles = (
  durationPredictor: "duration_predictor.int8.onnx",
  textEncoder: "text_encoder.int8.onnx",
  vectorEstimator: "vector_estimator.int8.onnx",
  vocoder: "vocoder.int8.onnx",
  ttsJson: "tts.json",
  unicodeIndexer: "unicode_indexer.bin",
  voiceStyle: "voice.bin"
)

private struct SpeechPart {
  let id: String
  let samples: [Float]
  let sampleRate: Double
}

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

private let parakeetFiles = (
  encoder: "encoder.int8.onnx",
  decoder: "decoder.int8.onnx",
  joiner: "joiner.int8.onnx",
  tokens: "tokens.txt"
)

private let qwen3AsrFiles = (
  convFrontend: "conv_frontend.onnx",
  encoder: "encoder.int8.onnx",
  decoder: "decoder.int8.onnx"
)

private final class OfflineSpeechRecognizer {
  enum Model {
    case parakeet
    case qwen3Asr
  }

  let directory: String
  let model: Model
  let recognizer: OpaquePointer

  init(directory: String, model: Model, threads: Int) throws {
    let file = { (name: String) in strdup((directory as NSString).appendingPathComponent(name)) }
    var config = SherpaOnnxOfflineRecognizerConfig()
    config.feat_config.sample_rate = Int32(captureSampleRate)
    config.feat_config.feature_dim = 80
    config.model_config.num_threads = Int32(threads)
    config.model_config.debug = 0
    let strings: [UnsafeMutablePointer<CChar>?]
    switch model {
    case .parakeet:
      strings = [
        file(parakeetFiles.encoder), file(parakeetFiles.decoder), file(parakeetFiles.joiner), file(parakeetFiles.tokens),
        strdup("cpu"), strdup("nemo_transducer"), strdup("greedy_search"),
      ]
      config.model_config.transducer.encoder = UnsafePointer(strings[0])
      config.model_config.transducer.decoder = UnsafePointer(strings[1])
      config.model_config.transducer.joiner = UnsafePointer(strings[2])
      config.model_config.tokens = UnsafePointer(strings[3])
      config.model_config.provider = UnsafePointer(strings[4])
      config.model_config.model_type = UnsafePointer(strings[5])
      config.decoding_method = UnsafePointer(strings[6])
      config.max_active_paths = 4
    case .qwen3Asr:
      strings = [
        file(qwen3AsrFiles.convFrontend), file(qwen3AsrFiles.encoder), file(qwen3AsrFiles.decoder), strdup(directory),
        strdup("cpu"), strdup(""), strdup("greedy_search"),
      ]
      config.model_config.qwen3_asr.conv_frontend = UnsafePointer(strings[0])
      config.model_config.qwen3_asr.encoder = UnsafePointer(strings[1])
      config.model_config.qwen3_asr.decoder = UnsafePointer(strings[2])
      config.model_config.qwen3_asr.tokenizer = UnsafePointer(strings[3])
      config.model_config.qwen3_asr.max_total_len = 512
      config.model_config.qwen3_asr.max_new_tokens = 256
      config.model_config.qwen3_asr.temperature = 1e-6
      config.model_config.qwen3_asr.top_p = 0.8
      config.model_config.qwen3_asr.seed = 42
      config.model_config.qwen3_asr.hotwords = UnsafePointer(strings[5])
      config.model_config.provider = UnsafePointer(strings[4])
      config.decoding_method = UnsafePointer(strings[6])
    }
    defer { strings.forEach { free($0) } }
    guard let recognizer = SherpaOnnxCreateOfflineRecognizer(&config) else { throw SpeechError.modelLoadFailed }
    self.directory = directory
    self.model = model
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

private let captureSampleRate = 16_000.0
private let frameSamples = 1_600

private struct LoudnessMeter {
  private var noise = Double.infinity
  private var peak = -Double.infinity

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

private let speechLoudness = 0.3
private let speechStartFrames = 3
private let segmentEndFrames = 7
private let maximumSegmentSamples = 25 * 16_000
private let leadingSilenceSamples = 4_800
private let interimFrames = 10

private final class SpeechCapture {
  let queue = DispatchQueue(label: "run.openbot.speech.capture", qos: .userInitiated)
  private(set) var engine = AVAudioEngine()
  private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: captureSampleRate, channels: 1, interleaved: false)!
  private var meter = LoudnessMeter()
  private var pending: [Float] = []
  private var segment: [Float] = []
  private var loudFrames = 0
  private var quietFrames = 0
  private var spoke = false
  private var framesSinceInterim = 0
  private var interimRunning = false
  private(set) var session = 0
  private(set) var mode: String?

  private let recognition: DispatchQueue
  private let recognizer: () -> OfflineSpeechRecognizer?
  private let send: (String, [String: Any]) -> Void

  init(recognition: DispatchQueue, recognizer: @escaping () -> OfflineSpeechRecognizer?, send: @escaping (String, [String: Any]) -> Void) {
    self.recognition = recognition
    self.recognizer = recognizer
    self.send = send
  }

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
    allowHapticsWhileRecording()
    engine = AVAudioEngine()
    let input = engine.inputNode
    let hardware = input.inputFormat(forBus: 0)
    guard hardware.sampleRate > 0, hardware.channelCount > 0 else { throw CaptureError.noMicrophone }
    let own = session
    var converter: AVAudioConverter?
    try EXUtilities.catchException { [self] in
      input.installTap(onBus: 0, bufferSize: 4_096, format: nil) { [weak self] buffer, _ in
        guard let self else { return }
        if converter?.inputFormat != buffer.format { converter = AVAudioConverter(from: buffer.format, to: self.target) }
        guard let converter, let samples = self.convert(buffer, with: converter) else { return }
        self.queue.async {
          guard own == self.session else { return }
          self.receive(samples)
        }
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

  func cancel() {
    stopEngine()
    session += 1
    mode = nil
    reset()
  }

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
  }

  private func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> [Float]? {
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

private final class SpeechPlayer {
  private let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private let timePitch = AVAudioUnitTimePitch()
  private var format: AVAudioFormat?
  private var scheduled: [String] = []
  private let onStart: (String) -> Void
  private let onDone: (String) -> Void
  let queue = DispatchQueue(label: "run.openbot.speech.playback")

  init(onStart: @escaping (String) -> Void, onDone: @escaping (String) -> Void) {
    self.onStart = onStart
    self.onDone = onDone
    engine.attach(node)
    engine.attach(timePitch)
  }

  func setSpeed(_ speed: Float) {
    timePitch.rate = speed
  }

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

  func stop() {
    scheduled.removeAll()
    node.stop()
  }

  private func start(format: AVAudioFormat) throws {
    let session = AVAudioSession.sharedInstance()
    if session.category != .playAndRecord || session.mode != .default {
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
    }
    try session.setActive(true)
    if self.format != format {
      node.stop()
      engine.disconnectNodeOutput(node)
      engine.disconnectNodeOutput(timePitch)
      engine.connect(node, to: timePitch, format: format)
      engine.connect(timePitch, to: engine.mainMixerNode, format: format)
      self.format = format
    }
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    if !node.isPlaying { try EXUtilities.catchException { self.node.play() } }
  }
}

public class SpeechModule: Module {
  private let synthesis = DispatchQueue(label: "run.openbot.speech.synthesis", qos: .userInitiated)
  private var voice: SupertonicVoice?
  private var recognizer: OfflineSpeechRecognizer?
  private let recognitionQueue = DispatchQueue(label: "run.openbot.speech.recognition", qos: .userInitiated)
  private var observers: [NSObjectProtocol] = []
  private lazy var capture = SpeechCapture(
    recognition: recognitionQueue,
    recognizer: { [weak self] in self?.recognizer },
    send: { [weak self] name, body in self?.sendEvent(name, body) }
  )
  private let lock = NSLock()
  private var generation = 0
  private lazy var player = SpeechPlayer(
    onStart: { [weak self] id in self?.sendEvent("onSpeechStart", ["id": id]) },
    onDone: { [weak self] id in self?.sendEvent("onSpeechDone", ["id": id]) }
  )

  private func loadRecognizer(_ directory: URL, model: OfflineSpeechRecognizer.Model, threads: Int, promise: Promise) {
    recognitionQueue.async {
      if self.recognizer?.directory == directory.path && self.recognizer?.model == model {
        promise.resolve(nil)
        return
      }
      self.recognizer = nil
      do {
        self.recognizer = try OfflineSpeechRecognizer(directory: directory.path, model: model, threads: threads)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_SPEECH_MODEL", "The speech recognition model could not load.")
      }
    }
  }

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

    OnCreate { [self] in
      let center = NotificationCenter.default
      let capture = self.capture
      let stopped = { (_: Notification) in
        capture.queue.async { capture.fail("interrupted") }
      }
      observers = [
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { notification in
          let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
          if type == .began { stopped(notification) }
        },
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { notification in
          let changed = notification.object as AnyObject?
          capture.queue.async {
            if changed === capture.engine && !capture.engine.isRunning { capture.fail("interrupted") }
          }
        },
        center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
          guard let self else { return }
          capture.queue.async {
            guard capture.mode == nil else { return }
            self.recognitionQueue.async { self.recognizer = nil }
          }
        },
      ]
    }

    AsyncFunction("loadRecognizer") { (directory: URL, threads: Int, promise: Promise) in
      self.loadRecognizer(directory, model: .parakeet, threads: threads, promise: promise)
    }

    AsyncFunction("loadQwenRecognizer") { (directory: URL, threads: Int, promise: Promise) in
      self.loadRecognizer(directory, model: .qwen3Asr, threads: threads, promise: promise)
    }

    AsyncFunction("unloadRecognizer") { (promise: Promise) in
      self.recognitionQueue.async {
        self.recognizer = nil
        promise.resolve(nil)
      }
    }

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

    Function("allowHapticsWhileRecording") {
      allowHapticsWhileRecording()
    }

    Function("setCallAudio") { (active: Bool) in
      guard active else { return }
      let session = AVAudioSession.sharedInstance()
      let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
      if session.category == .playAndRecord && session.mode == .voiceChat && session.categoryOptions.contains(options) {
        return
      }
      try? session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
      allowHapticsWhileRecording()
    }

    Function("finishCapture") {
      let capture = self.capture
      capture.queue.async { capture.finish() }
    }

    Function("cancelCapture") {
      let capture = self.capture
      capture.queue.async { capture.cancel() }
    }

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

    AsyncFunction("unload") { (promise: Promise) in
      self.synthesis.async {
        self.voice = nil
        promise.resolve(nil)
      }
    }

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

    Function("playPcm") { (id: String, pcm: Uint8Array, sampleRate: Int) in
      let own = self.currentGeneration()
      let data = Data(bytes: pcm.rawPointer, count: pcm.byteLength)
      var samples = [Float](repeating: 0, count: data.count / 2)
      data.withUnsafeBytes { raw in
        for index in samples.indices {
          samples[index] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32_768
        }
      }
      self.enqueue(SpeechPart(id: id, samples: samples, sampleRate: Double(sampleRate)), generation: own)
    }

    Function("setSpeed") { (speed: Double) in
      let player = self.player
      player.queue.async { player.setSpeed(Float(speed)) }
    }

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

func allowHapticsWhileRecording() {
  try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)
}
