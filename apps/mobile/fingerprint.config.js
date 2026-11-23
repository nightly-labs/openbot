// Expo SDK 58 changed the default fingerprint preset to `balanced`, which hashes a native package in
// node_modules by its name and version only. `strict` hashes its native files, as SDK 57 did, so a
// patch in the root `patches/` folder that changes native code also changes `runtimeVersion`.
//
// The iOS share extension carries its own copy of the share sender, which `plugins/with-share-target.js`
// builds at prebuild. An update cannot change it, so its sources change `runtimeVersion` too. A change in
// `@openbot/team-client` reaches the extension with the next build.
//
// A config plugin copies the Notification Service Extension source (`plugins/notification-service`),
// the App Intents of the shortcuts (`plugins/shortcuts`)
// and the notification sounds (`assets/sounds`) into the native project, and the build puts the update
// signing certificate (`certs`) into the binary. The fingerprint hashes the plugin files and the app
// config, but not the files that they name, so these folders are listed here. Without them, a change
// to one of them would keep `runtimeVersion`, and an over-the-air update could go to a binary that
// has the old native file.
//
// `plugins/with-app-icons.js` builds the app icons from the desktop logo colors, so their file changes
// `runtimeVersion` too.
//
// `pod install` downloads sherpa-onnx into `modules/speech/ios/vendor/`, after EAS has already hashed the
// project, so the build would hash a different tree. The podspec pins the archive's SHA-256 and is hashed.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  preset: "strict",
  ignorePaths: ["modules/speech/ios/vendor/**/*"],
  extraSources: [
    { type: "dir", filePath: "plugins/share-extension", reasons: ["shareExtension"] },
    { type: "dir", filePath: "plugins/notification-service", reasons: ["notificationService"] },
    { type: "dir", filePath: "plugins/shortcuts", reasons: ["shortcuts"] },
    { type: "dir", filePath: "assets/sounds", reasons: ["notificationSounds"] },
    { type: "dir", filePath: "certs", reasons: ["updateSigningCertificate"] },
    { type: "file", filePath: "../../packages/contracts/src/app-logo-color.ts", reasons: ["appIcons"] },
    { type: "file", filePath: "src/features/share/extension/share-sender.ts", reasons: ["shareExtension"] },
    { type: "file", filePath: "../../scripts/mobile-share-sender.ts", reasons: ["shareExtension"] },
  ],
};
