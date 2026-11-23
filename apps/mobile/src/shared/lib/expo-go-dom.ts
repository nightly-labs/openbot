import { expoGoOnAndroid } from "@/shared/lib/expo-go";

const useExpoDOMWebView = !expoGoOnAndroid();
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
export const expoGoDomOptions = useExpoDOMWebView
  ? { useExpoDOMWebView }
  : { useExpoDOMWebView, injectedJavaScriptBeforeContentLoaded: restoreDomHostValues };
