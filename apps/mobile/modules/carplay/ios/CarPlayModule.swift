import ExpoModulesCore

private let connectionEvent = "onCarPlayConnection"
private let openEvent = "onCarPlayOpen"
private let voiceEndEvent = "onCarPlayVoiceEnd"
private let muteEvent = "onCarPlayMute"

struct CarPlayAgentRecord: Record {
  @Field var key: String = ""
  @Field var name: String = ""
  @Field var detail: String?
  @Field var picture: String?
  @Field var unread: Bool = false

  var value: CarPlayAgent {
    CarPlayAgent(key: key, name: name, detail: detail, picture: picture, unread: unread)
  }
}

struct CarPlayHomeRecord: Record {
  @Field var title: String = ""
  @Field var message: String?
  @Field var pinnedTitle: String = ""
  @Field var newTitle: String = ""
  @Field var agentsTitle: String = ""
  @Field var pinned: [CarPlayAgentRecord] = []
  @Field var fresh: [CarPlayAgentRecord] = []
  @Field var quiet: [CarPlayAgentRecord] = []

  var value: CarPlayHome {
    CarPlayHome(
      title: title,
      message: message,
      pinnedTitle: pinnedTitle,
      newTitle: newTitle,
      agentsTitle: agentsTitle,
      pinned: pinned.map(\.value),
      fresh: fresh.map(\.value),
      quiet: quiet.map(\.value)
    )
  }
}

struct CarPlayVoiceFramesRecord: Record {
  @Field var listening: [String] = []
  @Field var muted: [String] = []
  @Field var thinking: [String] = []
  @Field var speaking: [String] = []
  @Field var offline: [String] = []
  @Field var unavailable: [String] = []

  var value: [CarPlayVoiceState: [String]] {
    [.listening: listening, .muted: muted, .thinking: thinking, .speaking: speaking, .offline: offline, .unavailable: unavailable]
  }
}

struct CarPlayVoiceRecord: Record {
  @Field var listening: String = ""
  @Field var muted: String = ""
  @Field var thinking: String = ""
  @Field var speaking: String = ""
  @Field var offline: String = ""
  @Field var unavailable: String = ""

  var value: CarPlayVoiceText {
    CarPlayVoiceText(listening: listening, muted: muted, thinking: thinking, speaking: speaking, offline: offline, unavailable: unavailable)
  }
}

public class CarPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotCarPlay")

    Events(connectionEvent, openEvent, voiceEndEvent, muteEvent)

    OnStartObserving { [weak self] in
      Task { @MainActor in
        let hub = CarPlayHub.shared
        hub.onConnection = { connected in self?.sendEvent(connectionEvent, ["connected": connected]) }
        hub.onOpen = { key in self?.sendEvent(openEvent, ["key": key]) }
        hub.onVoiceEnd = { self?.sendEvent(voiceEndEvent, [:]) }
        hub.onMute = { self?.sendEvent(muteEvent, [:]) }
      }
    }

    OnStopObserving {
      Task { @MainActor in
        let hub = CarPlayHub.shared
        hub.onConnection = nil
        hub.onOpen = nil
        hub.onVoiceEnd = nil
        hub.onMute = nil
      }
    }

    AsyncFunction("isConnected") { () -> Bool in
      MainActor.assumeIsolated { CarPlayHub.shared.connected }
    }.runOnQueue(.main)

    AsyncFunction("setHome") { (home: CarPlayHomeRecord) in
      let value = home.value
      MainActor.assumeIsolated { CarPlayHub.shared.update(value) }
    }.runOnQueue(.main)

    AsyncFunction("showVoice") { (text: CarPlayVoiceRecord, state: String, frames: CarPlayVoiceFramesRecord) in
      let value = text.value
      let initial = CarPlayVoiceState(rawValue: state) ?? .thinking
      let pictures = frames.value
      MainActor.assumeIsolated { CarPlayHub.shared.showVoice(value, state: initial, frames: pictures) }
    }.runOnQueue(.main)

    AsyncFunction("setVoiceState") { (state: String) in
      guard let value = CarPlayVoiceState(rawValue: state) else { return }
      MainActor.assumeIsolated { CarPlayHub.shared.setVoiceState(value) }
    }.runOnQueue(.main)

    AsyncFunction("setVoiceFrames") { (frames: CarPlayVoiceFramesRecord) in
      let pictures = frames.value
      MainActor.assumeIsolated { CarPlayHub.shared.setVoiceFrames(pictures) }
    }.runOnQueue(.main)

    AsyncFunction("setVoiceMuted") { (muted: Bool) in
      MainActor.assumeIsolated { CarPlayHub.shared.setVoiceMuted(muted) }
    }.runOnQueue(.main)

    AsyncFunction("hideVoice") {
      MainActor.assumeIsolated { CarPlayHub.shared.hideVoice() }
    }.runOnQueue(.main)
  }
}
