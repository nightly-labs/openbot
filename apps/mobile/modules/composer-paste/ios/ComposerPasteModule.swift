import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

private typealias PasteFunction = @convention(c) (AnyObject, Selector, Any?) -> Void
private typealias CanPerformFunction = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool

/// Wraps the chat composer field. The React Native field pastes text only, so a paste of photos,
/// videos or other files in it is copied to temporary files and sent to JavaScript.
final class ComposerPasteView: ExpoView {
  let onPasteFiles = EventDispatcher()
  /// The file extensions that the app attaches. An item in more than one format is copied in one of these.
  var extensions: Set<String> = []

  /// Copies the files on the pasteboard and sends them. Returns false when there is no file, so the field pastes the text.
  func pasteFiles() -> Bool {
    let providers = UIPasteboard.general.itemProviders.filter { PastedItem.isFile($0.registeredTypeIdentifiers) }
    guard !providers.isEmpty else { return false }
    let total = providers.count
    let copies = PastedCopies(count: total)
    let group = DispatchGroup()
    for (index, provider) in providers.enumerated() {
      guard let type = PastedItem.representation(provider.registeredTypeIdentifiers, extensions) else { continue }
      let name = PastedItem.name(provider.suggestedName, type)
      group.enter()
      _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        // iOS deletes this file when the handler returns, so the copy is made here.
        copies.set(index, url.flatMap { PastedItem.copy($0, name: name) })
        group.leave()
      }
    }
    group.notify(queue: .main) { [weak self] in
      let files = copies.files
      MainActor.assumeIsolated {
        self?.onPasteFiles(["files": files, "failed": total - files.count])
      }
    }
    return true
  }
}

/// The copies of one paste, in pasteboard order. The item handlers run on other threads.
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
  /// Photos, videos and documents are files. Text stays text, also in a rich format, and a link alone stays a link.
  static func isFile(_ identifiers: [String]) -> Bool {
    let types = identifiers.compactMap { UTType($0) }
    if types.contains(where: { $0.conforms(to: .image) || $0.conforms(to: .audiovisualContent) }) { return true }
    return !types.contains { $0.conforms(to: .text) } && types.contains(where: isContent)
  }

  static func isContent(_ type: UTType) -> Bool {
    type.conforms(to: .data) && !type.conforms(to: .url)
  }

  /// The formats of an item come best first, and Photos gives HEIC before JPEG. So the first format
  /// that the app attaches is taken, and a text format only when the item has no other.
  static func representation(_ identifiers: [String], _ extensions: Set<String>) -> UTType? {
    let types = identifiers.compactMap { UTType($0) }.filter(isContent)
    let ordered = types.filter { !$0.conforms(to: .text) } + types.filter { $0.conforms(to: .text) }
    let attachable = ordered.first { type in
      type.preferredFilenameExtension.map { extensions.contains($0.lowercased()) } ?? false
    }
    return attachable ?? ordered.first
  }

  /// The name of the copied item, with the extension of the format that is copied.
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

  /// Reads only the formats of the items. iOS does not show a paste notice for this.
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

/// Changes the multiline React Native field class one time. A field outside a `ComposerPasteView`
/// keeps its behavior.
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
    let canPerform = #selector(UIResponder.canPerformAction(_:withSender:))
    if let method = ownMethod(field, canPerform) {
      let original = unsafeBitCast(method_getImplementation(method), to: CanPerformFunction.self)
      // The field shows Paste only for text. Paste also shows when the pasteboard has a file.
      let replacement: @convention(block) (UITextView, Selector, Any?) -> Bool = { view, action, sender in
        if original(view, canPerform, action, sender) { return true }
        guard action == paste else { return false }
        return MainActor.assumeIsolated { view.isEditable && view.composerPasteTarget != nil }
          && PastedItem.pasteboardHasFile()
      }
      method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
  }()

  /// The method of the class itself. The inherited method is added first, so UITextView does not change.
  private static func ownMethod(_ cls: AnyClass, _ selector: Selector) -> Method? {
    guard let inherited = class_getInstanceMethod(cls, selector) else { return nil }
    class_addMethod(cls, selector, method_getImplementation(inherited), method_getTypeEncoding(inherited))
    return class_getInstanceMethod(cls, selector)
  }
}

public class ComposerPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotComposerPaste")

    OnCreate {
      _ = ComposerPaste.installed
    }

    View(ComposerPasteView.self) {
      Events("onPasteFiles")

      Prop("extensions") { (view: ComposerPasteView, extensions: [String]) in
        view.extensions = Set(extensions.map { $0.lowercased() })
      }
    }
  }
}
