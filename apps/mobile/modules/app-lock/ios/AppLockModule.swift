import CommonCrypto
import ExpoModulesCore
import UIKit

struct AwayState: Record {
  /// The time since the app went to the background, or nil when it did not go there.
  @Field var awayMs: Double? = nil
  /// True when iOS locked the protected data of the phone since the last read.
  @Field var phoneLocked: Bool = false
}

/// Measures the time that the app is away, with a clock that counts while the phone sleeps and that a
/// change of the phone's time does not move. All calls run on the main queue.
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
    var state = AwayState()
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
      // iOS posts this when it locks the protected data, about 10 seconds after the phone locks, and
      // only when the phone has a passcode.
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
    // On Darwin, CLOCK_MONOTONIC continues while the phone sleeps.
    if awaySince == nil { awaySince = clock_gettime_nsec_np(CLOCK_MONOTONIC) }
    guard watchPhoneLock, task == .invalid else { return }
    // iOS stops the app soon after it goes to the background, and the protected data closes later.
    // The short background time that iOS gives lets the app hear the lock that put it there.
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

final class PinHashException: Exception {
  override var reason: String {
    "The PIN hash could not be made"
  }
}

/// PBKDF2-HMAC-SHA256 with a 32-byte result, as lowercase hex. JavaScript takes seconds for the same work.
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

    /// Starts or stops the signals. The phone lock signal keeps the app awake for a short time after it leaves.
    AsyncFunction("configure") { (enabled: Bool, watchPhoneLock: Bool) in
      AppLockMonitor.shared.configure(enabled: enabled, watchPhoneLock: watchPhoneLock)
    }
    .runOnQueue(.main)

    /// Returns the time away and the phone lock since the last read, and clears them.
    AsyncFunction("takeAway") { () -> AwayState in
      AppLockMonitor.shared.takeAway()
    }
    .runOnQueue(.main)

    /// Runs on the module's background queue, so the hash does not stop the interface.
    AsyncFunction("derivePin") { (pin: String, saltHex: String, iterations: Int) throws -> String in
      try derivePin(pin, saltHex: saltHex, iterations: iterations)
    }
  }
}
