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
