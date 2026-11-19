import ExpoModulesCore

private let openEvent = "onShortcutOpen"

public class ShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotShortcuts")

    Events(openEvent)

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
