import Foundation

enum WatchAvatarFiles {
  static var folder: URL? {
    let base =
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: watchAppGroup)
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    return base?.appendingPathComponent("watch-avatars", isDirectory: true)
  }

  static func url(_ name: String) -> URL? {
    guard !name.isEmpty, name.count <= 200, !name.contains("/"), !name.hasPrefix(".") else { return nil }
    return Self.folder?.appendingPathComponent(name, isDirectory: false)
  }

  static func has(_ name: String) -> Bool {
    guard let url = Self.url(name) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  static func remove(keeping names: Set<String>) {
    guard let folder = Self.folder,
      let files = try? FileManager.default.contentsOfDirectory(atPath: folder.path)
    else { return }
    for file in files where !names.contains(file) {
      try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
    }
  }
}
