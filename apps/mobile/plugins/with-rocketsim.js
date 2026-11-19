const { withAppDelegate } = require("expo/config-plugins");
const { mergeContents, removeContents } = require("@expo/config-plugins/build/utils/generateCode");

// Expo CLI launches without Xcode's LLDB hook. Load Connect before React Native starts.
/**
 * @param {string} contents
 * @param {string | undefined} frameworkPath
 */
function addRocketSim(contents, frameworkPath) {
  if (!frameworkPath) return removeContents({ src: contents, tag: "openbot-rocketsim" }).contents;
  // JSON string escapes are also valid Swift escapes for local paths, except control characters.
  if (Array.from(frameworkPath).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("RocketSim path contains control characters.");
  }
  const connect = `    #if DEBUG && targetEnvironment(simulator)
    if Bundle(path: ${JSON.stringify(frameworkPath)})?.load() != true {
      NSLog("RocketSim Connect could not load. Check the RocketSim installation and restart the app.")
    }
    #endif`;
  return mergeContents({
    src: contents,
    newSrc: connect,
    tag: "openbot-rocketsim",
    anchor: /\) -> Bool \{/,
    offset: 1,
    comment: "//",
  }).contents;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("RocketSim Connect requires a Swift AppDelegate.");
    }
    mod.modResults.contents = addRocketSim(mod.modResults.contents, process.env.OPENBOT_ROCKETSIM_FRAMEWORK);
    return mod;
  });

module.exports.addRocketSim = addRocketSim;
