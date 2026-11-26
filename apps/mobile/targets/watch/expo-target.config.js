module.exports = () => ({
  type: "watch",
  name: "OpenBotWatch",
  displayName: "OpenBot",
  bundleIdentifier: ".watchkitapp",
  deploymentTarget: "10.0",
  icon: "../../assets/icons/app-icon.png",
  frameworks: ["WatchConnectivity", "WidgetKit", "AVFoundation"],
  entitlements: {
    "com.apple.security.application-groups": ["group.run.openbot.mobile"],
  },
  colors: {
    $accent: "#FFFFFF",
  },
});
