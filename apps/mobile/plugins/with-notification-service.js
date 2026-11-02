const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

// Adds the Notification Service Extension that opens a sealed OpenBot notification before iOS shows
// it (`notification-service/NotificationService.swift`). It reads the keys that the app writes into
// the App Group, so it has the App Group entitlement and nothing else. It also makes an agent
// notification a communication notification with the agent picture, so the app has the Communication
// Notifications entitlement and declares `INSendMessageIntent`.

const SOURCE = "NotificationService.swift";
const SEND_MESSAGE_INTENT = "INSendMessageIntent";

/**
 * @typedef {{ targetName: string; bundleIdentifier: string; groupIdentifier: string }} NotificationServiceProps
 */

/** @param {NotificationServiceProps} props */
function infoPlist({ targetName, groupIdentifier }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${targetName}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>IntentsSupported</key>
      <array>
        <string>${SEND_MESSAGE_INTENT}</string>
      </array>
    </dict>
  </dict>
  <key>OpenBotAppGroup</key>
  <string>${groupIdentifier}</string>
</dict>
</plist>
`;
}

/** @param {string} groupIdentifier */
function entitlements(groupIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${groupIdentifier}</string>
  </array>
</dict>
</plist>
`;
}

/** @type {import('expo/config-plugins').ConfigPlugin<NotificationServiceProps>} */
const withNotificationServiceFiles = (config, props) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const directory = path.join(mod.modRequest.platformProjectRoot, props.targetName);
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(path.join(__dirname, "notification-service", SOURCE), path.join(directory, SOURCE));
      fs.writeFileSync(path.join(directory, `${props.targetName}-Info.plist`), infoPlist(props));
      fs.writeFileSync(path.join(directory, `${props.targetName}.entitlements`), entitlements(props.groupIdentifier));
      return mod;
    },
  ]);

/** @type {import('expo/config-plugins').ConfigPlugin<NotificationServiceProps>} */
const withNotificationServiceTarget = (config, { targetName, bundleIdentifier }) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    // `addTarget` writes the name in quotes, and a project read again keeps them. Without both forms,
    // each `prebuild --no-clean` adds one more target, and `pod install` fails on the shared source.
    if (project.pbxTargetByName(targetName) || project.pbxTargetByName(`"${targetName}"`)) return mod;
    // `addTarget` adds a dependency, and the `xcode` package fails when these sections are missing.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};

    const group = project.addPbxGroup(
      [SOURCE, `${targetName}-Info.plist`, `${targetName}.entitlements`],
      targetName,
      targetName,
    );
    for (const [key, value] of Object.entries(objects.PBXGroup)) {
      if (typeof value === "object" && value.name === undefined && value.path === undefined) {
        project.addToPbxGroup(group.uuid, key);
      }
    }

    // An app extension target is embedded into the app by a copy phase of the app target.
    const target = project.addTarget(targetName, "app_extension", targetName, bundleIdentifier);
    project.addBuildPhase([SOURCE], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const configurations = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    const sections = project.pbxXCBuildConfigurationSection();
    for (const { value } of configurations.buildConfigurations) {
      Object.assign(sections[value].buildSettings, {
        CODE_SIGN_ENTITLEMENTS: `"${targetName}/${targetName}.entitlements"`,
        // The app and its extensions carry the same version, as App Store Connect requires.
        CURRENT_PROJECT_VERSION: `"${config.ios?.buildNumber ?? "1"}"`,
        MARKETING_VERSION: `"${config.ios?.version ?? config.version ?? "1.0"}"`,
        IPHONEOS_DEPLOYMENT_TARGET: `"${config.ios?.deploymentTarget ?? "16.4"}"`,
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: `"1,2"`,
        APPLICATION_EXTENSION_API_ONLY: "YES",
        ...(config.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {}),
      });
    }
    return mod;
  });

/**
 * EAS makes the signing profile of each extension that `appExtensions` names. The profile needs the
 * App Group, so EAS turns the capability on for the new bundle identifier.
 *
 * @type {import('expo/config-plugins').ConfigPlugin<NotificationServiceProps>}
 */
const withNotificationServiceSigning = (config, { targetName, bundleIdentifier, groupIdentifier }) => {
  const extensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  if (extensions.some((extension) => extension.targetName === targetName)) return config;
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions: [
              ...extensions,
              {
                targetName,
                bundleIdentifier,
                entitlements: { "com.apple.security.application-groups": [groupIdentifier] },
              },
            ],
          },
        },
      },
    },
  };
  return config;
};

/**
 * iOS shows the sender picture only for an app with the Communication Notifications entitlement that
 * declares the intent. Without them, `updating(from:)` fails and the notification shows as before.
 * EAS turns the capability on for the app from its entitlements.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withCommunicationNotifications = (config) =>
  withInfoPlist(
    withEntitlementsPlist(config, (mod) => {
      mod.modResults["com.apple.developer.usernotifications.communication"] = true;
      return mod;
    }),
    (mod) => {
      const types = mod.modResults.NSUserActivityTypes ?? [];
      if (!types.includes(SEND_MESSAGE_INTENT)) types.push(SEND_MESSAGE_INTENT);
      mod.modResults.NSUserActivityTypes = types;
      return mod;
    },
  );

/** @type {import('expo/config-plugins').ConfigPlugin<NotificationServiceProps>} */
module.exports = (config, props) =>
  withNotificationServiceTarget(
    withNotificationServiceFiles(withNotificationServiceSigning(withCommunicationNotifications(config), props), props),
    props,
  );
