import CommonCrypto
import ExpoModulesCore
import UIKit

struct AwayState: Record {
  @Field var awayMs: Double? = nil
  @Field var phoneLocked: Bool = false
}

final class AppLockMonitor {
  static let shared = AppLockMonitor()
  private var watchPhoneLock = false
  private var awaySince: UInt64?
  private var phoneLocked = false
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var observers: [NSObjectProtocol] = []

  func configure(enabled: Bool, watchPhoneLock: Bool) {
    self.watchPhoneLock = enabled && watchPhoneLock
    if enabled, observers.isEmpty { observe() }
    if !enabled {
      for observer in observers { NotificationCenter.default.removeObserver(observer) }
      observers = []
      awaySince = nil
      phoneLocked = false
    }
    if !self.watchPhoneLock { endTask() }
  }

  func takeAway() -> AwayState {
    let state = AwayState()
    if let awaySince {
      state.awayMs = Double(clock_gettime_nsec_np(CLOCK_MONOTONIC) &- awaySince) / 1_000_000
    }
    state.phoneLocked = phoneLocked
    awaySince = nil
    phoneLocked = false
    return state
  }

  private func observe() {
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
        [weak self] _ in self?.enterBackground()
      },
      center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) {
        [weak self] _ in self?.endTask()
      },
      center.addObserver(
        forName: UIApplication.protectedDataWillBecomeUnavailableNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.phoneLocked = true
        self?.endTask()
      }
    ]
  }

  private func enterBackground() {
    if awaySince == nil { awaySince = clock_gettime_nsec_np(CLOCK_MONOTONIC) }
    guard watchPhoneLock, task == .invalid else { return }
    task = UIApplication.shared.beginBackgroundTask(withName: "OpenBotAppLock") { [weak self] in
      self?.endTask()
    }
  }

  private func endTask() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

final class PinHashException: Exception, @unchecked Sendable {
  override var reason: String {
    "The PIN hash could not be made"
  }
}

private func derivePin(_ pin: String, saltHex: String, iterations: Int) throws -> String {
  guard !pin.isEmpty, iterations > 0, iterations <= Int(UInt32.max), let salt = bytes(hex: saltHex) else {
    throw PinHashException()
  }
  var key = [UInt8](repeating: 0, count: 32)
  let status = pin.withCString { password in
    CCKeyDerivationPBKDF(
      CCPBKDFAlgorithm(kCCPBKDF2),
      password,
      pin.utf8.count,
      salt,
      salt.count,
      CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
      UInt32(iterations),
      &key,
      key.count
    )
  }
  guard status == Int32(kCCSuccess) else { throw PinHashException() }
  return key.map { String(format: "%02x", $0) }.joined()
}

private func bytes(hex: String) -> [UInt8]? {
  let digits = Array(hex.utf8)
  guard !digits.isEmpty, digits.count % 2 == 0 else { return nil }
  var result: [UInt8] = []
  result.reserveCapacity(digits.count / 2)
  for index in stride(from: 0, to: digits.count, by: 2) {
    guard let byte = UInt8(String(decoding: digits[index..<index + 2], as: UTF8.self), radix: 16) else { return nil }
    result.append(byte)
  }
  return result
}

public class AppLockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotAppLock")

    AsyncFunction("configure") { (enabled: Bool, watchPhoneLock: Bool) in
      AppLockMonitor.shared.configure(enabled: enabled, watchPhoneLock: watchPhoneLock)
    }
    .runOnQueue(.main)

    AsyncFunction("takeAway") { () -> AwayState in
      AppLockMonitor.shared.takeAway()
    }
    .runOnQueue(.main)

    AsyncFunction("derivePin") { (pin: String, saltHex: String, iterations: Int) throws -> String in
      try derivePin(pin, saltHex: saltHex, iterations: iterations)
    }
  }
}
