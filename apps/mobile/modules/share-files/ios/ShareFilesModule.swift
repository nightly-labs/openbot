import ExpoModulesCore
import UIKit

final class NoFilesException: Exception, @unchecked Sendable {
  override var reason: String { "No files to share" }
}

final class NoPresenterException: Exception, @unchecked Sendable {
  override var reason: String { "No screen can show the share sheet" }
}

/// One share sheet with many files. `expo-sharing` takes one file only.
public class ShareFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotShareFiles")

    AsyncFunction("shareAsync") { [weak self] (urls: [URL], _: String, promise: Promise) in
      guard !urls.isEmpty else { throw NoFilesException() }
      guard let presenter = self?.appContext?.utilities?.currentViewController() else {
        throw NoPresenterException()
      }
      let controller = UIActivityViewController(activityItems: urls, applicationActivities: nil)
      // The sheet calls this once when it closes, whatever the user chose.
      controller.completionWithItemsHandler = { _, _, _, _ in promise.resolve(nil) }
      if let popover = controller.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
      }
      presenter.present(controller, animated: true)
    }
    .runOnQueue(.main)
  }
}
