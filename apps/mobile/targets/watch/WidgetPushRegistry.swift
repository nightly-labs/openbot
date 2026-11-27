import Foundation

enum WidgetPushRegistry {
  static let renewal: TimeInterval = 15 * 60

  private static let tokenKey = "openbot.watch.widget.push.token"
  private static let environmentKey = "openbot.watch.widget.push.environment"
  private static let answeredKey = "openbot.watch.widget.push.registered"
  private static let profileEnvironment = Data("<key>aps-environment</key>".utf8)
  private static let development = Data("<string>development</string>".utf8)

  private struct Answer: Codable {
    var token: String
    var at: Double
  }

  private static var defaults: UserDefaults? { UserDefaults(suiteName: watchAppGroup) }

  static func save(token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    guard !hex.isEmpty else { return }
    defaults?.set(hex, forKey: tokenKey)
    defaults?.set(bundleEnvironment(), forKey: environmentKey)
  }

  static func register(credentials: WatchDirectCredentials, direct: WatchDirect) async {
    guard let token = defaults?.string(forKey: tokenKey),
      let environment = defaults?.string(forKey: environmentKey)
    else { return }
    let now = Date().timeIntervalSince1970
    let answered = answers()
    let due = credentials.servers.filter { server in
      guard let answer = answered[server.serverId], answer.token == token else { return true }
      return now - answer.at >= renewal
    }
    guard !due.isEmpty else { return }
    var updated = answered
    for server in due {
      guard await accepted(server, token: token, environment: environment, credentials: credentials, direct: direct)
      else { continue }
      updated[server.serverId] = Answer(token: token, at: now)
    }
    let known = Set(credentials.servers.map(\.serverId))
    save(answers: updated.filter { known.contains($0.key) })
  }

  static func confirmEnvironment() {
    guard defaults?.string(forKey: tokenKey) != nil else { return }
    let environment = bundleEnvironment()
    guard defaults?.string(forKey: environmentKey) != environment else { return }
    defaults?.set(environment, forKey: environmentKey)
    forget()
  }

  private static func accepted(
    _ server: WatchDirectServer, token: String, environment: String, credentials: WatchDirectCredentials,
    direct: WatchDirect
  ) async -> Bool {
    do {
      let result = try await direct.run(
        .widgetPush(token: token, environment: environment), server: server, credentials: credentials)
      return result.ok
    } catch WatchDirectFailure.status(let status) {
      return status == 400
    } catch {
      return false
    }
  }

  static func forget() {
    defaults?.removeObject(forKey: answeredKey)
  }

  private static func answers() -> [String: Answer] {
    guard let data = defaults?.data(forKey: answeredKey),
      let answers = try? JSONDecoder().decode([String: Answer].self, from: data)
    else { return [:] }
    return answers
  }

  private static func save(answers: [String: Answer]) {
    guard let data = try? JSONEncoder().encode(answers) else { return }
    defaults?.set(data, forKey: answeredKey)
  }

  private static func bundleEnvironment() -> String {
    #if targetEnvironment(simulator)
      return "development"
    #else
      return signedEnvironment()
    #endif
  }

  private static func signedEnvironment() -> String {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let profile = try? Data(contentsOf: url),
      let key = profile.range(of: profileEnvironment),
      profile.range(of: development, in: key.upperBound..<min(profile.endIndex, key.upperBound + 64)) != nil
    else { return "production" }
    return "development"
  }
}
