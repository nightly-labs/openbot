internal import Expo
import CarPlay
internal import OpenBotCarPlay
import React
import UIKit

@objc(CarPlaySceneDelegate)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    ParkedReactView.startIfNeeded()
    CarPlayHub.shared.connect(interfaceController)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    CarPlayHub.shared.disconnect()
    ParkedReactView.pauseLayout()
  }
}

@MainActor
enum ParkedReactView {
  private static var window: UIWindow?
  private static var layoutTimer: Timer?
  private static var insetsObserver: NSObjectProtocol?
  private static var laidOut = false
  private static let insetsReady = Notification.Name("RNCSafeAreaDidChange")
  private static let parkedFrame = CGRect(x: 0, y: 0, width: 390, height: 844)
  private static let layoutInterval: TimeInterval = 0.25

  static func startIfNeeded() {
    if let parked = window {
      if !laidOut { keepLaidOut(parked) }
      return
    }
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      provider.window == nil,
      let factory = provider.reactNativeFactory
    else { return }
    let parked = UIWindow(frame: parkedFrame)
    window = parked
    provider.window = parked
    factory.startReactNative(
      withModuleName: provider.reactNativeFactoryModuleName,
      in: parked,
      launchOptions: nil
    )
    keepLaidOut(parked)
  }

  static func pauseLayout() {
    layoutTimer?.invalidate()
    layoutTimer = nil
    if let insetsObserver { NotificationCenter.default.removeObserver(insetsObserver) }
    insetsObserver = nil
  }

  private static func keepLaidOut(_ parked: UIWindow) {
    pauseLayout()
    layoutTimer = Timer.scheduledTimer(withTimeInterval: layoutInterval, repeats: true) { _ in
      MainActor.assumeIsolated { parked.layoutIfNeeded() }
    }
    insetsObserver = NotificationCenter.default.addObserver(forName: insetsReady, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated {
        laidOut = true
        pauseLayout()
      }
    }
  }

  static func attach(
    _ scene: UIScene,
    to sceneDelegate: ExpoAppSceneDelegate,
    options: UIScene.ConnectionOptions
  ) -> Bool {
    guard let parked = window,
      let windowScene = scene as? UIWindowScene,
      let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider
    else { return false }
    window = nil
    pauseLayout()
    parked.windowScene = windowScene
    parked.frame = windowScene.coordinateSpace.bounds
    sceneDelegate.window = parked
    provider.window = parked
    parked.makeKeyAndVisible()
    if !options.urlContexts.isEmpty { sceneDelegate.scene(scene, openURLContexts: options.urlContexts) }
    for activity in options.userActivities { sceneDelegate.scene(scene, continue: activity) }
    if let item = options.shortcutItem {
      sceneDelegate.windowScene(windowScene, performActionFor: item) { _ in }
    }
    return true
  }
}
