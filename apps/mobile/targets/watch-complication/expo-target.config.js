module.exports = () => ({
  type: "watch-widget",
  name: "OpenBotWatchComplication",
  displayName: "OpenBot",
  bundleIdentifier: ".watchkitapp.widgets",
  deploymentTarget: "10.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.run.openbot.mobile"],
  },
  colors: {
    $accent: "#007CF7",
    $widgetBackground: "#000000",
  },
});
