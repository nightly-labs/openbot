import ExpoModulesCore

private let commandEvent = "onWatchCommand"
private let stateEvent = "onWatchState"

public class WatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotWatch")

    Events(commandEvent, stateEvent)

    Constant("supported") { () -> Bool in
      WatchLink.shared.supported
    }

    Function("state") { () -> [String: Bool] in
      WatchLink.shared.state()
    }

    Function("updateContext") { (payload: String) in
      WatchLink.shared.update(payload: payload)
    }

    Function("respond") { (id: String, result: String) in
      WatchLink.shared.respond(id: id, result: result)
    }

    OnStartObserving { [weak self] in
      WatchLink.shared.activate()
      WatchLink.shared.listen(
        commands: { id, command in
          self?.sendEvent(commandEvent, ["id": id, "command": command])
        },
        state: {
          self?.sendEvent(stateEvent, WatchLink.shared.state())
        }
      )
    }

    OnStopObserving {
      WatchLink.shared.listen(commands: nil, state: nil)
    }
  }
}

public class WatchAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    WatchLink.shared.activate()
    return true
  }
}
