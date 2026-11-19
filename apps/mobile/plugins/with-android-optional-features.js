const { withAndroidManifest } = require("expo/config-plugins");

const OPTIONAL_FEATURES = ["android.hardware.screen.portrait", "android.hardware.wifi"];

/** @param {import('expo/config-plugins').AndroidManifest} manifest */
function markFeaturesOptional(manifest) {
  const declared = manifest.manifest["uses-feature"] ?? [];
  const others = declared.filter((feature) => !OPTIONAL_FEATURES.includes(feature.$["android:name"]));
  manifest.manifest["uses-feature"] = [
    ...others,
    ...OPTIONAL_FEATURES.map((name) => ({ $: { "android:name": name, "android:required": "false" } })),
  ];
  return manifest;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = markFeaturesOptional(mod.modResults);
    return mod;
  });
