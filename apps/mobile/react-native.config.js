// Only Expo Go on Android uses react-native-webview, and Expo Go has its own native copy.
// Builds keep @expo/dom-webview, so they do not link this native code.
module.exports = {
  dependencies: {
    "react-native-webview": { platforms: { android: null, ios: null } },
  },
};
