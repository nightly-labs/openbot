import ExpoModulesCore

private let openEvent = "onShortcutOpen"

/// Gives JavaScript the screen that a button of a shortcut card opens.
public class ShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotShortcuts")

    Events(openEvent)

    /// The shortcuts need the snippets of iOS 26. An older iOS has none, so Settings hides them.
    Constant("supported") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }

    OnStartObserving { [weak self] in
      ShortcutBridge.shared.listen { payload in
        self?.sendEvent(openEvent, ["payload": payload])
      }
    }

    OnStopObserving {
      ShortcutBridge.shared.listen(nil)
    }
  }
}
