import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Reads what another app shared into the payloads of expo-sharing (`ShareProtocol.swift`). The files
/// are copied into the App Group, so the app can take the same payloads when the extension cannot send.
/// This is expo-sharing's `ShareIntoViewController.swift`, with one change: an item is read as an
/// image before it is read as a web link. An image from a web page also carries its address, so
/// Safari's "Share" on an image sent only the address.
enum ShareInput {
  static func payloads(_ items: [NSExtensionItem], appGroupId: String) async -> [SharePayload] {
    var results: [SharePayload] = []
    for item in items {
      for provider in item.attachments ?? [] {
        if let payload = await parse(provider, appGroupId: appGroupId) { results.append(payload) }
      }
    }
    return results
  }

  private static func parse(_ provider: NSItemProvider, appGroupId: String) async -> SharePayload? {
    // The image goes first, as Messages sends it. The address stays the fallback when the image does not load.
    if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
      let image = await file(provider, type: .image, utType: .image, appGroupId: appGroupId)
    {
      return image
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
      && !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
    {
      return await webURL(provider)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.audio.identifier) {
      return await file(provider, type: .audio, utType: .audio, appGroupId: appGroupId)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
      return await file(provider, type: .video, utType: .movie, appGroupId: appGroupId)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
      || provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
    {
      return await file(provider, type: .file, utType: .data, appGroupId: appGroupId)
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
      return await text(provider)
    }
    return nil
  }

  private static func text(_ provider: NSItemProvider) async -> SharePayload? {
    await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, _ in
        guard let text = item as? String else { return continuation.resume(returning: nil) }
        continuation.resume(returning: SharePayload(type: .text, value: text, mimeType: "text/plain", metadata: nil))
      }
    }
  }

  private static func webURL(_ provider: NSItemProvider) async -> SharePayload? {
    await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
        guard let url = item as? URL else { return continuation.resume(returning: nil) }
        continuation.resume(
          returning: SharePayload(type: .url, value: url.absoluteString, mimeType: "text/html", metadata: nil)
        )
      }
    }
  }

  private static func file(
    _ provider: NSItemProvider,
    type: ShareType,
    utType: UTType,
    appGroupId: String
  ) async -> SharePayload? {
    await withCheckedContinuation { continuation in
      let identifier =
        provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: utType) ?? false } ?? utType.identifier
      provider.loadItem(forTypeIdentifier: identifier, options: nil) { item, _ in
        if let url = item as? URL {
          return continuation.resume(returning: copy(url, type: type, appGroupId: appGroupId))
        }
        if let data = item as? Data {
          let ext = UTType(identifier)?.preferredFilenameExtension.map { ".\($0)" } ?? ""
          let mimeType = UTType(identifier)?.preferredMIMEType
          return continuation.resume(
            returning: save(data, name: UUID().uuidString + ext, type: type, mimeType: mimeType, appGroupId: appGroupId)
          )
        }
        if type == .image, let image = item as? UIImage, let data = image.pngData() {
          return continuation.resume(
            returning: save(data, name: UUID().uuidString + ".png", type: .image, mimeType: "image/png", appGroupId: appGroupId)
          )
        }
        continuation.resume(returning: nil)
      }
    }
  }

  /// The folder of the shared copies. A shared file keeps its name, so it must not go in the App Group
  /// root, where it could take the place of the app's own data, such as `share-extension.json`.
  private static func itemFolder(appGroupId: String) -> URL? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
      return nil
    }
    let folder = container.appendingPathComponent("share-items", isDirectory: true)
    guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else {
      return nil
    }
    return folder
  }

  private static func copy(_ url: URL, type: ShareType, appGroupId: String) -> SharePayload? {
    guard let folder = itemFolder(appGroupId: appGroupId) else { return nil }
    let name = url.lastPathComponent.isEmpty ? UUID().uuidString : url.lastPathComponent
    let destination = folder.appendingPathComponent(name)
    do {
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.copyItem(at: url, to: destination)
    } catch {
      return nil
    }
    let size = try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int
    let mimeType = UTType(filenameExtension: destination.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    return SharePayload(
      type: type,
      value: destination.absoluteString,
      mimeType: mimeType,
      metadata: ShareMetadata(originalName: name, size: size)
    )
  }

  private static func save(_ data: Data, name: String, type: ShareType, mimeType: String?, appGroupId: String)
    -> SharePayload?
  {
    guard let folder = itemFolder(appGroupId: appGroupId) else { return nil }
    let destination = folder.appendingPathComponent(name)
    do {
      try data.write(to: destination)
    } catch {
      return nil
    }
    return SharePayload(
      type: type,
      value: destination.absoluteString,
      mimeType: mimeType ?? "application/octet-stream",
      metadata: ShareMetadata(originalName: name, size: data.count)
    )
  }
}

/// The share as the extension sends it, with the limits of the app (`share-screen.tsx`, `incoming-share.ts`).
struct ShareContent {
  /// The limits of one message (`packages/contracts/src/input-limits.ts`, `MOBILE_ATTACHMENT_BYTES`).
  static let maxFiles = 10
  static let maxFileBytes = 10 * 1024 * 1024
  static let maxTextLength = 100_000

  let text: String
  let files: [ShareSender.File]
  /// The JPEG copies of HEIC photos. The payloads keep the originals for the app.
  let madeFiles: [URL]

  /// Nil when the app must take the share: a file it cannot read, or more than one message can hold.
  /// The app tells the user what is wrong.
  static func prepare(_ payloads: [SharePayload]) -> ShareContent? {
    var seen = Set<String>()
    let lines = payloads
      .filter { $0.type == .text || $0.type == .url }
      .map { $0.value.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
    let text = lines.joined(separator: "\n")
    let sources = payloads.filter { $0.type != .text && $0.type != .url }
    guard text.count <= maxTextLength, sources.count <= maxFiles else { return nil }
    var files: [ShareSender.File] = []
    var madeFiles: [URL] = []
    func failed() -> ShareContent? {
      removeFiles(madeFiles)
      return nil
    }
    for payload in sources {
      guard let url = URL(string: payload.value), url.isFileURL else { return failed() }
      var name = (payload.metadata?.originalName ?? url.lastPathComponent)
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "\\", with: "_")
      if name.isEmpty { name = "shared-file" }
      var fileURL = url
      // HEIC is not an attachment type. As the app does, the share sends a JPEG copy.
      if ["heic", "heif"].contains(url.pathExtension.lowercased()) {
        // ImageIO writes the JPEG from the file without a second bitmap; the extension has little memory.
        let copy = url.deletingPathExtension().appendingPathExtension("share.jpg")
        guard
          let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let destination = CGImageDestinationCreateWithURL(copy as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
        else { return failed() }
        madeFiles.append(copy)
        let options = [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary
        CGImageDestinationAddImageFromSource(destination, source, 0, options)
        guard CGImageDestinationFinalize(destination) else { return failed() }
        fileURL = copy
        name = (name as NSString).deletingPathExtension + ".jpg"
      }
      guard
        let size = try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int,
        size <= maxFileBytes
      else { return failed() }
      let mimeType = UTType(filenameExtension: (name as NSString).pathExtension)?.preferredMIMEType
        ?? "application/octet-stream"
      files.append(ShareSender.File(url: fileURL, name: name, mimeType: mimeType))
    }
    guard !text.isEmpty || !files.isEmpty else { return nil }
    return ShareContent(text: text, files: files, madeFiles: madeFiles)
  }

  static func removeFiles(_ urls: [URL]) {
    for url in urls { try? FileManager.default.removeItem(at: url) }
  }

  /// The App Group copies of the payloads. The app removes them itself when it takes the share.
  static func payloadFiles(_ payloads: [SharePayload]) -> [URL] {
    payloads.compactMap { payload in
      guard payload.type != .text && payload.type != .url, let url = URL(string: payload.value), url.isFileURL else {
        return nil
      }
      return url
    }
  }
}
