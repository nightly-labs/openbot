const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const plist = require("@expo/plist").default;
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withPlugins,
  withXcodeProject,
} = require("expo/config-plugins");

const TARGET_NAME = "expo-sharing-extension";
const SOURCE_DIRECTORY = path.join(__dirname, "share-extension");
const CONTROLLER = "ShareIntoViewController.swift";
const ADDED_SOURCES = ["ShareExtensionData.swift", "ShareInput.swift", "ShareSender.swift", "ShareView.swift"];
const PAGE = "share-sender.html";
const PAGE_BUILD = path.resolve(__dirname, "../../../scripts/mobile-share-sender.ts");
const SEND_MESSAGE_INTENT = "INSendMessageIntent";

/** @param {string} bundleIdentifier */
function sharedKeychainGroup(bundleIdentifier) {
  return `$(AppIdentifierPrefix)${bundleIdentifier}.share`;
}

/** @param {string} file @param {(value: Record<string, any>) => void} change */
function changePlist(file, change) {
  const value = plist.parse(fs.readFileSync(file, "utf8"));
  change(value);
  fs.writeFileSync(file, plist.build(value));
}

let builtPage = "";

/**
 * Writes the page to `output`. The share extension and the shortcuts of the app (`with-shortcuts.js`)
 * use the same page, so one prebuild builds it once.
 *
 * @param {string} output
 */
function buildPage(output) {
  if (builtPage && fs.existsSync(builtPage)) {
    if (builtPage !== output) fs.copyFileSync(builtPage, output);
    return;
  }
  const result = spawnSync("bun", [PAGE_BUILD, output], { stdio: "inherit" });
  if (result.error) throw new Error(`The share extension page needs Bun: ${result.error.message}`);
  if (result.status !== 0) throw new Error("The share extension page did not build.");
  builtPage = output;
}

/** @type {import('expo/config-plugins').ConfigPlugin<string>} */
const withExtensionFiles = (config, keychainGroup) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const directory = path.join(mod.modRequest.platformProjectRoot, TARGET_NAME);
      for (const file of [CONTROLLER, ...ADDED_SOURCES]) {
        fs.copyFileSync(path.join(SOURCE_DIRECTORY, file), path.join(directory, file));
      }
      buildPage(path.join(directory, PAGE));
      changePlist(path.join(directory, "Info.plist"), (info) => {
        info.CFBundleDisplayName = mod.name;
        info.OpenBotShareKeychainGroup = keychainGroup;
        info.NSExtension.NSExtensionAttributes.IntentsSupported = [SEND_MESSAGE_INTENT];
      });
      changePlist(path.join(directory, `${TARGET_NAME}.entitlements`), (entitlements) => {
        entitlements["keychain-access-groups"] = [keychainGroup];
      });
      return mod;
    },
  ]);

/** @param {unknown} value */
function unquoted(value) {
  return typeof value === "string" ? value.replace(/^"(.*)"$/u, "$1") : value;
}

/**
 * Adds the files to the extension target: the Swift files to its sources, the page to its resources.
 * A project that has a file already keeps it, so `prebuild --no-clean` adds nothing twice.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withExtensionProject = (config) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const target = project.pbxTargetByName(TARGET_NAME) ?? project.pbxTargetByName(`"${TARGET_NAME}"`);
    if (!target) throw new Error(`The Xcode project has no ${TARGET_NAME} target.`);
    const groupKey = Object.keys(objects.PBXGroup).find((key) => {
      const group = objects.PBXGroup[key];
      return typeof group === "object" && unquoted(group.path) === TARGET_NAME;
    });
    if (!groupKey) throw new Error(`The Xcode project has no ${TARGET_NAME} group.`);
    const group = objects.PBXGroup[groupKey];
    for (const child of group.children) {
      if (unquoted(objects.PBXFileReference[child.value]?.path) !== "Info.plist") continue;
      const shared = Object.keys(objects.PBXGroup).some(
        (key) =>
          key !== groupKey &&
          typeof objects.PBXGroup[key] === "object" &&
          objects.PBXGroup[key].children?.some((/** @type {{ value: string }} */ other) => other.value === child.value),
      );
      if (!shared) continue;
      const fileRef = project.generateUuid();
      objects.PBXFileReference[fileRef] = { ...objects.PBXFileReference[child.value] };
      objects.PBXFileReference[`${fileRef}_comment`] = "Info.plist";
      child.value = fileRef;
    }
    /** @param {string} section @param {string} name */
    const phaseOf = (section, name) => {
      const phase = target.buildPhases.find(
        (/** @type {{ value: string }} */ entry) => objects[section]?.[entry.value],
      );
      if (!phase) throw new Error(`The ${TARGET_NAME} target has no ${section}.`);
      return { phase: objects[section][phase.value], name };
    };
    const sources = phaseOf("PBXSourcesBuildPhase", "Sources");
    const resources = phaseOf("PBXResourcesBuildPhase", "Resources");
    const files = [
      ...ADDED_SOURCES.map((file) => ({ file, type: "sourcecode.swift", into: sources })),
      { file: PAGE, type: "text.html", into: resources },
    ];
    for (const { file, type, into } of files) {
      const present = group.children.some(
        (/** @type {{ value: string }} */ child) => unquoted(objects.PBXFileReference[child.value]?.path) === file,
      );
      if (present) continue;
      const fileRef = project.generateUuid();
      const buildFile = project.generateUuid();
      objects.PBXFileReference[fileRef] = {
        isa: "PBXFileReference",
        lastKnownFileType: type,
        path: `"${file}"`,
        sourceTree: '"<group>"',
      };
      objects.PBXFileReference[`${fileRef}_comment`] = file;
      objects.PBXBuildFile[buildFile] = { isa: "PBXBuildFile", fileRef, fileRef_comment: file };
      objects.PBXBuildFile[`${buildFile}_comment`] = `${file} in ${into.name}`;
      group.children.push({ value: fileRef, comment: file });
      into.phase.files.push({ value: buildFile, comment: `${file} in ${into.name}` });
    }
    if (mod.ios?.appleTeamId) {
      const sections = project.pbxXCBuildConfigurationSection();
      const configurations = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations;
      for (const { value } of configurations) sections[value].buildSettings.DEVELOPMENT_TEAM = mod.ios.appleTeamId;
    }
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin<string>} */
const withAppKeychainGroup = (config, keychainGroup) =>
  withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults["keychain-access-groups"] ?? [
      `$(AppIdentifierPrefix)${config.ios?.bundleIdentifier}`,
    ];
    if (!groups.includes(keychainGroup)) groups.push(keychainGroup);
    mod.modResults["keychain-access-groups"] = groups;
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin<string>} */
const withAppInfo = (config, keychainGroup) =>
  withInfoPlist(config, (mod) => {
    mod.modResults.OpenBotShareKeychainGroup = keychainGroup;
    const types = mod.modResults.NSUserActivityTypes ?? [];
    if (!types.includes(SEND_MESSAGE_INTENT)) types.push(SEND_MESSAGE_INTENT);
    mod.modResults.NSUserActivityTypes = types;
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin<{ ios?: { enabled?: boolean } } | undefined>} */
const withShareTarget = (config, props) => {
  if (!props?.ios?.enabled) return withPlugins(config, [["expo-sharing", props]]);
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) throw new Error("The share extension needs ios.bundleIdentifier.");
  const keychainGroup = sharedKeychainGroup(bundleIdentifier);
  const withExtension = withExtensionProject(withExtensionFiles(config, keychainGroup));
  const withApp = withAppInfo(withAppKeychainGroup(withExtension, keychainGroup), keychainGroup);
  return withPlugins(withApp, [["expo-sharing", props]]);
};

module.exports = withShareTarget;
module.exports.buildPage = buildPage;
