import ExpoModulesCore

private let openEvent = "onShortcutOpen"
private let messageEvent = "onShortcutSend"

/// Gives JavaScript the screen that a button of a shortcut card opens, and a message of Send Message
/// while the app is open.
public class ShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotShortcuts")

    Events(openEvent, messageEvent)

    /// The shortcuts need the snippets of iOS 26. An older iOS has none, so Settings hides them.
    Constant("supported") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }

    Function("listenForSends") { [weak self] (listening: Bool) in
      ShortcutBridge.shared.listenForSends(
        listening
          ? { id, payload in self?.sendEvent(messageEvent, ["id": id, "payload": payload]) }
          : nil
      )
    }

    Function("answerSend") { (id: String, outcome: String) in
      ShortcutBridge.shared.answerSend(id, outcome: outcome)
    }

    OnStartObserving { [weak self] in
      ShortcutBridge.shared.listen { payload in
        self?.sendEvent(openEvent, ["payload": payload])
      }
    }

    OnStopObserving {
      ShortcutBridge.shared.listen(nil)
    }

    OnDestroy {
      ShortcutBridge.shared.listenForSends(nil)
    }
  }
}
