import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

private typealias PasteFunction = @convention(c) (AnyObject, Selector, Any?) -> Void
private typealias CanPerformFunction = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
private typealias KeyCommandsFunction = @convention(c) (AnyObject, Selector) -> NSArray?

final class ComposerPasteView: ExpoView {
  let onPasteFiles = EventDispatcher()
  let onSubmitKey = EventDispatcher()
  var extensions: Set<String> = []

  func pasteFiles() -> Bool {
    let providers = UIPasteboard.general.itemProviders.filter { PastedItem.isFile($0.registeredTypeIdentifiers) }
    guard !providers.isEmpty else { return false }
    PastedItem.copyFiles(providers, extensions) { [weak self] result in
      self?.onPasteFiles(result)
    }
    return true
  }
}

final class ChatDropView: ExpoView, UIDropInteractionDelegate {
  let onDropFiles = EventDispatcher()
  var extensions: Set<String> = []
  var enabled = true

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIDropInteraction(delegate: self))
  }

  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    enabled && session.items.contains { PastedItem.isFile($0.itemProvider.registeredTypeIdentifiers) }
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
    UIDropProposal(operation: enabled ? .copy : .forbidden)
  }

  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    let providers = session.items.map(\.itemProvider).filter { PastedItem.isFile($0.registeredTypeIdentifiers) }
    guard !providers.isEmpty else { return }
    PastedItem.copyFiles(providers, extensions) { [weak self] result in
      guard let self else {
        PastedItem.delete(result)
        return
      }
      self.onDropFiles(result)
    }
  }
}

private final class PastedCopies: @unchecked Sendable {
  private let lock = NSLock()
  private var slots: [[String: String]?]

  init(count: Int) {
    slots = Array(repeating: nil, count: count)
  }

  func set(_ index: Int, _ file: [String: String]?) {
    lock.lock()
    slots[index] = file
    lock.unlock()
  }

  var files: [[String: String]] {
    lock.lock()
    defer { lock.unlock() }
    return slots.compactMap { $0 }
  }
}

private enum PastedItem {
  static func copyFiles(
    _ providers: [NSItemProvider],
    _ extensions: Set<String>,
    done: @escaping @MainActor ([String: Any]) -> Void
  ) {
    let total = providers.count
    let copies = PastedCopies(count: total)
    let group = DispatchGroup()
    for (index, provider) in providers.enumerated() {
      guard let type = representation(provider.registeredTypeIdentifiers, extensions) else { continue }
      let fileName = name(provider.suggestedName, type)
      group.enter()
      _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        copies.set(index, url.flatMap { copy($0, name: fileName) })
        group.leave()
      }
    }
    group.notify(queue: .main) {
      let files = copies.files
      MainActor.assumeIsolated {
        done(["files": files, "failed": total - files.count])
      }
    }
  }

  static func isFile(_ identifiers: [String]) -> Bool {
    let types = identifiers.compactMap { UTType($0) }
    if types.contains(where: { $0.conforms(to: .image) || $0.conforms(to: .audiovisualContent) }) { return true }
    return !types.contains { $0.conforms(to: .text) } && types.contains(where: isContent)
  }

  static func isContent(_ type: UTType) -> Bool {
    type.conforms(to: .data) && !type.conforms(to: .url)
  }

  static func representation(_ identifiers: [String], _ extensions: Set<String>) -> UTType? {
    let types = identifiers.compactMap { UTType($0) }.filter(isContent)
    let ordered = types.filter { !$0.conforms(to: .text) } + types.filter { $0.conforms(to: .text) }
    let attachable = ordered.first { type in
      type.preferredFilenameExtension.map { extensions.contains($0.lowercased()) } ?? false
    }
    return attachable ?? ordered.first
  }

  static func name(_ suggested: String?, _ type: UTType) -> String {
    var stem = (suggested ?? "").replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: .whitespaces)
    let suggestedExtension = (stem as NSString).pathExtension
    if !suggestedExtension.isEmpty, let known = UTType(filenameExtension: suggestedExtension), !known.isDynamic {
      stem = (stem as NSString).deletingPathExtension
    }
    if stem.isEmpty {
      stem = type.conforms(to: .image) ? "pasted-image" : type.conforms(to: .movie) ? "pasted-video" : "pasted-file"
    }
    guard let fileExtension = type.preferredFilenameExtension else { return stem }
    return "\(stem).\(fileExtension)"
  }

  static func copy(_ url: URL, name: String) -> [String: String]? {
    let target = FileManager.default.temporaryDirectory
      .appendingPathComponent("openbot-paste-\(UUID().uuidString)")
      .appendingPathExtension(url.pathExtension)
    do {
      try FileManager.default.copyItem(at: url, to: target)
    } catch {
      return nil
    }
    return ["uri": target.absoluteString, "name": name]
  }

  static func delete(_ result: [String: Any]) {
    for file in result["files"] as? [[String: String]] ?? [] {
      if let uri = file["uri"], let url = URL(string: uri) {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }

  static func pasteboardHasFile() -> Bool {
    (UIPasteboard.general.types(forItemSet: nil) ?? []).contains(where: isFile)
  }
}

private extension UIView {
  var composerPasteTarget: ComposerPasteView? {
    var view = superview
    while let current = view {
      if let target = current as? ComposerPasteView { return target }
      view = current.superview
    }
    return nil
  }
}

private enum ComposerPaste {
  static let installed: Void = {
    guard let field = NSClassFromString("RCTUITextView") else { return }
    let paste = #selector(UIResponderStandardEditActions.paste(_:))
    if let method = ownMethod(field, paste) {
      let original = unsafeBitCast(method_getImplementation(method), to: PasteFunction.self)
      let replacement: @convention(block) (UITextView, Any?) -> Void = { view, sender in
        let handled = MainActor.assumeIsolated { view.isEditable && view.composerPasteTarget?.pasteFiles() == true }
        if !handled { original(view, paste, sender) }
      }
      method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
    let submitBlock: @convention(block) (UITextView, Any?) -> Void = { view, _ in
      MainActor.assumeIsolated { view.composerPasteTarget?.onSubmitKey(["text": view.text ?? ""]) }
    }
    class_addMethod(field, submit, imp_implementationWithBlock(submitBlock), "v@:@")
    let keyCommands = #selector(getter: UIResponder.keyCommands)
    if let method = ownMethod(field, keyCommands) {
      let original = unsafeBitCast(method_getImplementation(method), to: KeyCommandsFunction.self)
      let replacement: @convention(block) (UITextView) -> NSArray? = { view in
        let commands = original(view, keyCommands)
        let added: [UIKeyCommand]? = MainActor.assumeIsolated {
          view.composerPasteTarget == nil ? nil : submitCommands()
        }
        guard let added else { return commands }
        return ((commands as? [UIKeyCommand]) ?? []) + added as NSArray
      }
      method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
    let canPerform = #selector(UIResponder.canPerformAction(_:withSender:))
    if let method = ownMethod(field, canPerform) {
      let original = unsafeBitCast(method_getImplementation(method), to: CanPerformFunction.self)
      let replacement: @convention(block) (UITextView, Selector, Any?) -> Bool = { view, action, sender in
        if action == submit {
          return MainActor.assumeIsolated {
            view.isEditable && view.composerPasteTarget != nil && view.markedTextRange == nil
          }
        }
        if original(view, canPerform, action, sender) { return true }
        guard action == paste else { return false }
        return MainActor.assumeIsolated { view.isEditable && view.composerPasteTarget != nil }
          && PastedItem.pasteboardHasFile()
      }
      method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
  }()

  private static let submit = NSSelectorFromString("openBotComposerSubmit:")

  @MainActor
  private static func submitCommands() -> [UIKeyCommand] {
    [UIKeyModifierFlags(), .command].map { modifiers in
      let command = UIKeyCommand(input: "\r", modifierFlags: modifiers, action: submit)
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
  }

  private static func ownMethod(_ cls: AnyClass, _ selector: Selector) -> Method? {
    guard let inherited = class_getInstanceMethod(cls, selector) else { return nil }
    class_addMethod(cls, selector, method_getImplementation(inherited), method_getTypeEncoding(inherited))
    return class_getInstanceMethod(cls, selector)
  }
}

public class ComposerPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotComposerPaste")

    Constant("chatDrop") { true }

    OnCreate {
      _ = ComposerPaste.installed
    }

    View(ComposerPasteView.self) {
      Events("onPasteFiles", "onSubmitKey")

      Prop("extensions") { (view: ComposerPasteView, extensions: [String]) in
        view.extensions = Set(extensions.map { $0.lowercased() })
      }
    }

    View(ChatDropView.self) {
      ViewName("ChatDrop")
      Events("onDropFiles")

      Prop("extensions") { (view: ChatDropView, extensions: [String]) in
        view.extensions = Set(extensions.map { $0.lowercased() })
      }

      Prop("enabled") { (view: ChatDropView, enabled: Bool) in
        view.enabled = enabled
      }
    }
  }
}
