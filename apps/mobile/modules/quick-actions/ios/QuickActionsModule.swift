import ExpoModulesCore
import UIKit

private let quickActionEvent = "onQuickAction"

private let symbols = [
  "agent": "bubble.left",
  "routines": "calendar",
  "search": "magnifyingglass",
  "share": "square.and.arrow.up",
  "support": "heart"
]

struct QuickActionItem: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String?
  @Field var icon: String = ""
}

final class QuickActionInbox {
  static let shared = QuickActionInbox()
  private var pending: String?
  private var deliver: ((String) -> Void)?

  func receive(_ id: String) {
    if let deliver { deliver(id) } else { pending = id }
  }

  func listen(_ deliver: ((String) -> Void)?) {
    self.deliver = deliver
    guard let deliver, let id = pending else { return }
    pending = nil
    deliver(id)
  }
}

public class QuickActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotQuickActions")

    Events(quickActionEvent)

    AsyncFunction("setItems") { (items: [QuickActionItem]) -> Bool in
      UIApplication.shared.shortcutItems = items.map { item in
        UIApplicationShortcutItem(
          type: item.id,
          localizedTitle: item.title,
          localizedSubtitle: item.subtitle,
          icon: symbols[item.icon].map { UIApplicationShortcutIcon(systemImageName: $0) },
          userInfo: nil
        )
      }
      return true
    }
    .runOnQueue(.main)

    OnStartObserving { [weak self] in
      DispatchQueue.main.async {
        QuickActionInbox.shared.listen { id in
          self?.sendEvent(quickActionEvent, ["id": id])
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        QuickActionInbox.shared.listen(nil)
      }
    }
  }
}

public class QuickActionsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    QuickActionInbox.shared.receive(shortcutItem.type)
    completionHandler(true)
  }
}
