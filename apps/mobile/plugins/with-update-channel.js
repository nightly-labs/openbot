const { AndroidConfig, withAndroidManifest, withExpoPlist } = require("expo/config-plugins");

const HEADER = "expo-channel-name";
const CHANNELS = ["development", "preview", "production"];
const ANDROID_KEY = "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY";

function updateChannel() {
  const channel = process.env.EXPO_PUBLIC_APP_ENV || "development";
  if (!CHANNELS.includes(channel)) {
    throw new Error(`EXPO_PUBLIC_APP_ENV is "${channel}". Use one of: ${CHANNELS.join(", ")}.`);
  }
  return channel;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => {
  config = withExpoPlist(config, (config) => {
    config.modResults.EXUpdatesRequestHeaders = {
      ...config.modResults.EXUpdatesRequestHeaders,
      [HEADER]: updateChannel(),
    };
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      ANDROID_KEY,
      JSON.stringify({ [HEADER]: updateChannel() }),
    );
    return config;
  });
};
