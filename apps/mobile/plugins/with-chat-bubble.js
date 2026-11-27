const { withAndroidManifest } = require("expo/config-plugins");

const ACTIVITY = "run.openbot.mobile.chatbubble.ChatBubbleActivity";

/**
 * The activity of a chat bubble. Android shows a bubble only for an activity that is embedded and
 * resizeable, and it needs `documentLaunchMode` to open one bubble per agent on Android 10 and
 * lower. The activity is not exported: only the bubble notification of this app opens it.
 *
 * @param {import('expo/config-plugins').AndroidManifest} manifest
 */
function addBubbleActivity(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) return manifest;
  const activities = application.activity ?? [];
  const others = activities.filter((activity) => activity.$["android:name"] !== ACTIVITY);
  application.activity = [
    ...others,
    {
      $: {
        "android:name": ACTIVITY,
        "android:exported": "false",
        "android:theme": "@style/AppTheme",
        "android:allowEmbedded": "true",
        "android:resizeableActivity": "true",
        "android:documentLaunchMode": "always",
        "android:showWhenLocked": "true",
        "android:configChanges":
          "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths",
        "android:windowSoftInputMode": "adjustResize",
      },
    },
  ];
  return manifest;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = addBubbleActivity(mod.modResults);
    return mod;
  });
