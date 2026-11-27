const { AndroidConfig, withAndroidManifest, withExpoPlist } = require("expo/config-plugins");

// Writes the update channel of the build into the app. The update server (`apps/mobile-updates`)
// gives a phone only the updates of its channel, which the `expo-updates` client sends in the
// `expo-channel-name` header of each request.
//
// The EAS build step writes this header only for an app whose `updates.url` is on Expo's server, so a
// build for our own server would have no channel and would get no update. `updates.requestHeaders`
// in the app config would also write it, but the app config is in the fingerprint, and the three
// build profiles of one commit must keep one runtime version.
//
// The channel is `EXPO_PUBLIC_APP_ENV`, which each build profile of `eas.json` sets to its own name.
// A local build with no profile is a development build.

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
