const { copyFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { basename, join, parse, resolve } = require("node:path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const { setNotificationSounds } = require("expo-notifications/plugin/build/withNotificationsIOS");

// Adds the notification sounds to the app. The `expo-notifications` plugin would also copy its
// `sounds` into the Android resources, which reject the `-` in the names. The names stay on iOS,
// because the account service sends them to released iPhone builds (`NOTIFICATION_SOUND_FILES`), so
// Android gets copies with `_` in place of `-`. `OpenBotMessagingService.kt` and the notification
// channels (`android-notification-channels.ts`) use those names.

/** @type {import('expo/config-plugins').ConfigPlugin<{ sounds: string[] }>} */
module.exports = (config, { sounds }) => {
  config = withXcodeProject(config, (config) => {
    config.modResults = setNotificationSounds(config.modRequest.projectRoot, {
      sounds,
      project: config.modResults,
      projectName: config.modRequest.projectName,
    });
    return config;
  });
  return withDangerousMod(config, [
    "android",
    (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const raw = join(platformProjectRoot, "app", "src", "main", "res", "raw");
      mkdirSync(raw, { recursive: true });
      const resources = [];
      for (const sound of sounds) {
        const { name, ext } = parse(basename(sound));
        const resource = name.replaceAll("-", "_");
        copyFileSync(resolve(projectRoot, sound), join(raw, `${resource}${ext}`));
        resources.push(`@raw/${resource}`);
      }
      // `expo-notifications` finds a sound by its name only, so the resource shrinker of a release
      // build removed the files, and each channel got the Android notification sound.
      writeFileSync(
        join(raw, "keep_openbot_notification_sounds.xml"),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${resources.join(",")}" />\n`,
      );
      return config;
    },
  ]);
};
