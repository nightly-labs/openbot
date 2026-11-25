const ReactNative = require("openbot-original-react-native");
const { Text, TextInput } = require("./scaled-text");

module.exports = new Proxy(
  { Text, TextInput },
  {
    get: (scaled, name) => (name in scaled ? scaled[name] : ReactNative[name]),
    has: (scaled, name) => name in scaled || name in ReactNative,
  },
);
