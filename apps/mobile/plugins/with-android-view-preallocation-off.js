const { withMainApplication } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const FLAGS = "com.facebook.react.internal.featureflags";

const forceViewPreallocationOff = `    ${FLAGS}.ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : ${FLAGS}.ReactNativeNewArchitectureFeatureFlagsDefaults() {
        override fun disableViewPreallocationAndroid(): Boolean = true
      }
    )`;

/** @param {string} contents */
function addViewPreallocationOff(contents) {
  return mergeContents({
    src: contents,
    newSrc: forceViewPreallocationOff,
    tag: "openbot-view-preallocation-off",
    anchor: /^\s*loadReactNative\(this\)\s*$/,
    offset: 1,
    comment: "//",
  }).contents;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("The view preallocation override requires a Kotlin MainApplication.");
    }
    mod.modResults.contents = addViewPreallocationOff(mod.modResults.contents);
    return mod;
  });

module.exports.addViewPreallocationOff = addViewPreallocationOff;
