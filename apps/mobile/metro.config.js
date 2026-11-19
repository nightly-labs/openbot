const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const { withUniwindConfig } = require("uniwind/metro");

process.env.EXPO_METRO_CACHE_OUTPUT_DIR ??= path.join(__dirname, ".expo/metro-cache");

const config = getDefaultConfig(__dirname);
config.fileMapCacheDirectory = path.join(__dirname, ".expo/metro-file-map");
fs.mkdirSync(config.fileMapCacheDirectory, { recursive: true });
config.cacheVersion = [config.cacheVersion, __dirname].filter(Boolean).join(":");
const nativeModuleShims = new Map([
  ["@solidjs/web", path.resolve(__dirname, "src/shims/solidjs-web.ts")],
  ["solid-js", path.resolve(__dirname, "src/shims/solid-js.ts")],
]);

const BLOUB_ASSETS = "@norbert_bodziony/bloub/assets/";
const bloubAssetFolder = path.join(path.dirname(require.resolve("@norbert_bodziony/bloub")), "assets");

const TOPIC_SUBSCRIPTION_SHIM = path.resolve(__dirname, "src/shims/expo-notifications-topic-subscription.ts");
const EXPO_NOTIFICATIONS_BUILD = path.join("node_modules", "expo-notifications", "build");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = nativeModuleShims.get(moduleName);
  if (shim) return { filePath: shim, type: "sourceFile" };
  if (
    platform === "android" &&
    moduleName === "./TopicSubscriptionModule" &&
    path.dirname(context.originModulePath).endsWith(EXPO_NOTIFICATIONS_BUILD)
  ) {
    return { filePath: TOPIC_SUBSCRIPTION_SHIM, type: "sourceFile" };
  }
  if (moduleName.startsWith(BLOUB_ASSETS)) {
    return context.resolveRequest(
      context,
      path.join(bloubAssetFolder, path.basename(moduleName.slice(BLOUB_ASSETS.length))),
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

const uniwindConfig = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});

const SHIMS = path.resolve(__dirname, "src/shims");
const UNIWIND_REACT_NATIVE = path.join(SHIMS, "uniwind-react-native.js");
const ORIGINAL_REACT_NATIVE = "openbot-original-react-native";
const UNIWIND_WRAPPERS = path.join("node_modules", "uniwind", "src", "components", "native");
const uniwindResolveRequest = uniwindConfig.resolver.resolveRequest;
uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === ORIGINAL_REACT_NATIVE && path.dirname(context.originModulePath) === SHIMS) {
    return context.resolveRequest(context, "react-native", platform);
  }
  if (
    moduleName === "react-native" &&
    platform !== "web" &&
    path.dirname(context.originModulePath).endsWith(UNIWIND_WRAPPERS)
  ) {
    return { filePath: UNIWIND_REACT_NATIVE, type: "sourceFile" };
  }
  return uniwindResolveRequest(context, moduleName, platform);
};

module.exports = uniwindConfig;
