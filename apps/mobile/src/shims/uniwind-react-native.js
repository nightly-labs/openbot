// The `react-native` that the Uniwind component wrappers import (see `metro.config.js`): the real
// module, with the scaled `Text` and `TextInput` of `scaled-text.tsx`. Each other export loads only
// when a wrapper reads it. The proxy lists only its own two exports: Fast Refresh walks the exports
// of each module with `for…in`, and a walk of all `react-native` exports loads modules that need a
// native module that Expo Go does not have.
const ReactNative = require("openbot-original-react-native");
const { Text, TextInput } = require("./scaled-text");

module.exports = new Proxy(
  { Text, TextInput },
  {
    get: (scaled, name) => (name in scaled ? scaled[name] : ReactNative[name]),
    has: (scaled, name) => name in scaled || name in ReactNative,
  },
);
