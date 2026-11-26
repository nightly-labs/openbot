const { withMainApplication } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const createMainHandlerOnMainThread = "    com.facebook.react.bridge.UiThreadUtil.getUiThreadHandler()";

/** @param {string} contents */
function addMainHandlerFirst(contents) {
  return mergeContents({
    src: contents,
    newSrc: createMainHandlerOnMainThread,
    tag: "openbot-main-handler-first",
    anchor: /^\s*loadReactNative\(this\)\s*$/,
    offset: 0,
    comment: "//",
  }).contents;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("The main handler plugin requires a Kotlin MainApplication.");
    }
    mod.modResults.contents = addMainHandlerFirst(mod.modResults.contents);
    return mod;
  });
