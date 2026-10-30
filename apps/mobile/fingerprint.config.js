// Expo SDK 58 changed the default fingerprint preset to `balanced`, which hashes a native package in
// node_modules by its name and version only. `strict` hashes its native files, as SDK 57 did, so a
// patch in the root `patches/` folder that changes native code also changes `runtimeVersion`.
//
// The iOS share extension carries its own copy of the share sender, which `plugins/with-share-target.js`
// builds at prebuild. An update cannot change it, so its sources change `runtimeVersion` too. A change in
// `@openbot/team-client` reaches the extension with the next build.
//
// `pod install` downloads sherpa-onnx into `modules/speech/ios/vendor/`, after EAS has already hashed the
// project, so the build would hash a different tree. The podspec pins the archive's SHA-256 and is hashed.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  preset: "strict",
  ignorePaths: ["modules/speech/ios/vendor/**/*"],
  extraSources: [
    { type: "dir", filePath: "plugins/share-extension", reasons: ["shareExtension"] },
    { type: "file", filePath: "src/features/share/extension/share-sender.ts", reasons: ["shareExtension"] },
    { type: "file", filePath: "../../scripts/mobile-share-sender.ts", reasons: ["shareExtension"] },
  ],
};
