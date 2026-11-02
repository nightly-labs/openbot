const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const { withUniwindConfig } = require("uniwind/metro");

// Metro keeps its transform and file map caches in the system temporary directory. The cache key
// includes this directory (see `cacheVersion` below), so worktrees cannot share entries and the
// entries of removed worktrees stay behind. Keep both caches in the ignored `.expo` directory of this
// worktree. EAS sets the output directory for its build cache; keep its value.
process.env.EXPO_METRO_CACHE_OUTPUT_DIR ??= path.join(__dirname, ".expo/metro-cache");

const config = getDefaultConfig(__dirname);
config.fileMapCacheDirectory = path.join(__dirname, ".expo/metro-file-map");
// Metro writes the file map cache but does not create its directory.
fs.mkdirSync(config.fileMapCacheDirectory, { recursive: true });
// Metro keys a cached file by its project-relative path and contents. The `use dom` transform
// embeds the absolute path, so a sibling worktree's cached output would point DOM components at
// files outside this project.
config.cacheVersion = [config.cacheVersion, __dirname].filter(Boolean).join(":");
const nativeModuleShims = new Map([
  ["@solidjs/web", path.resolve(__dirname, "src/shims/solidjs-web.ts")],
  ["solid-js", path.resolve(__dirname, "src/shims/solid-js.ts")],
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = nativeModuleShims.get(moduleName);
  if (shim) return { filePath: shim, type: "sourceFile" };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
