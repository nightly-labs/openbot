import AVFoundation
import SwiftUI

struct ListenView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  @Environment(\.dismiss) private var dismiss
  @StateObject private var reader = ReplyReader()
  let agent: WatchAgent

  var body: some View {
    VStack(spacing: 8) {
      AgentAvatar(agent: agent, size: 40)
      Label(text(TextKey.listenReading), systemImage: "speaker.wave.2")
        .font(.footnote.weight(.semibold))
        .symbolEffect(.variableColor.iterative, isActive: reader.speaking)
      Button(role: .destructive) {
        reader.stop()
        dismiss()
      } label: {
        Label(text(TextKey.stop), systemImage: "stop.fill")
      }
    }
    .navigationTitle(agent.name)
    .onAppear {
      reader.read(agent.reply ?? "", language: session.language)
    }
    .onDisappear {
      reader.stop()
    }
    .onChange(of: reader.finished) { _, finished in
      if finished { dismiss() }
    }
  }
}

@MainActor
final class ReplyReader: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
  @Published private(set) var speaking = false
  @Published private(set) var finished = false
  private let synthesizer = AVSpeechSynthesizer()

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  func read(_ reply: String, language: String) {
    guard !reply.isEmpty, !synthesizer.isSpeaking else { return }
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    let utterance = AVSpeechUtterance(string: reply)
    utterance.voice = AVSpeechSynthesisVoice(language: language)
    speaking = true
    finished = false
    synthesizer.speak(utterance)
  }

  func stop() {
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    speaking = false
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    Task { @MainActor in
      self.speaking = false
      self.finished = true
    }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    Task { @MainActor in self.speaking = false }
  }
}
