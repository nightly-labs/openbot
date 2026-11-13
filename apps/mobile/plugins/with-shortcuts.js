const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const { buildPage } = require("./with-share-target");

// Adds the shortcuts of the app (List Agents and Send Message) to the iOS app target. The Swift
// files in `shortcuts/` hold the App Intents, their snippets and the `AppShortcutsProvider`. They
// are in the app target, not in the pod of `modules/shortcuts`: Xcode reads the shortcuts of an app
// from the app target when it builds.
//
// Send Message sends without the JavaScript of the app, as the share extension does. So the app
// target also gets the sender of that extension (`share-extension/ShareSender.swift`) and its page
// `share-sender.html`, from `with-share-target.js`. One source file serves both targets, so both
// check the page's requests in the same way.
//
// The intents read the file that the app writes to the App Group
// (`src/features/shortcuts/model/shortcut-directory.ts`), and the servers, the agent pictures and
// the session of the share extension. `expo-widgets` and `with-share-target.js` add both entitlements, so this plugin adds none.

const SOURCE_DIRECTORY = path.join(__dirname, "shortcuts");
const SOURCES = ["ShortcutData.swift", "ShortcutIntents.swift", "ShortcutSend.swift", "ShortcutSnippets.swift"];
const SENDER = path.join(__dirname, "share-extension", "ShareSender.swift");
const PAGE = "share-sender.html";

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withShortcutFiles = (config) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const directory = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName ?? "");
      for (const file of SOURCES) fs.copyFileSync(path.join(SOURCE_DIRECTORY, file), path.join(directory, file));
      fs.copyFileSync(SENDER, path.join(directory, path.basename(SENDER)));
      buildPage(path.join(directory, PAGE));
      return mod;
    },
  ]);

/**
 * Adds the Swift files to the sources of the app target and the page to its resources. A project
 * that has a file already keeps it, so `prebuild --no-clean` adds nothing twice.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withShortcutProject = (config) =>
  withXcodeProject(config, (mod) => {
    const projectName = mod.modRequest.projectName;
    if (!projectName) throw new Error("The shortcuts need the name of the Xcode project.");
    for (const file of [...SOURCES, path.basename(SENDER)]) {
      const filepath = `${projectName}/${file}`;
      if (mod.modResults.hasFile(filepath)) continue;
      mod.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: mod.modResults,
      });
    }
    const page = `${projectName}/${PAGE}`;
    if (!mod.modResults.hasFile(page)) {
      mod.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: page,
        groupName: projectName,
        project: mod.modResults,
        isBuildFile: true,
      });
    }
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => withShortcutProject(withShortcutFiles(config));
