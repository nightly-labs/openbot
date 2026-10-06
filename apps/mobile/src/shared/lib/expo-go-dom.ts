import { isAndroid } from "@/shared/lib/platform";

/** Expo Go on Android. The constants load only on Android, so iOS and tests do not load them here. */
function expoGoOnAndroid(): boolean {
  if (!isAndroid) return false;
  const constants: typeof import("expo-constants") = require("expo-constants");
  return constants.default.executionEnvironment === constants.ExecutionEnvironment.StoreClient;
}

// Expo Go on Android does not include @expo/dom-webview. It includes react-native-webview.
const useExpoDOMWebView = !expoGoOnAndroid();
// Expo's DOM page reads the host values from react-native-webview in an inline script. On Android the
// values arrive in onPageStarted, after that script and before the DOM bundle. This script runs there and
// gives the bundle the values. The props come again when the DOM side reports that it is ready.
// react-native-webview puts the values in a template literal, which changes the escapes of the JSON.
// Props with text that has a quote or a line break then cannot be read, and the first render gets no
// props. Each DOM component therefore has defaults for the props that it reads at once.
const restoreDomHostValues = `(function () {
  function injected() {
    try {
      return JSON.parse(window.ReactNativeWebView.injectedObjectJson()) || {};
    } catch (error) {
      return {};
    }
  }
  function keep(name, read) {
    var value = window[name];
    Object.defineProperty(window, name, {
      configurable: true,
      get: function () { return value === undefined ? read() : value; },
      set: function (next) { if (next !== undefined) value = next; },
    });
  }
  keep("$$EXPO_DOM_HOST_OS", function () { return injected().EXPO_DOM_HOST_OS || "android"; });
  keep("$$EXPO_INITIAL_PROPS", function () { return injected().initialProps || { names: [], props: {} }; });
})();
true;`;
/** Spread into the `dom` prop of every DOM component. */
export const expoGoDomOptions = useExpoDOMWebView
  ? { useExpoDOMWebView }
  : { useExpoDOMWebView, injectedJavaScriptBeforeContentLoaded: restoreDomHostValues };
