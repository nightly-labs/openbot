const fs = require("node:fs");
const path = require("node:path");
const {
  IOSConfig,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const SOURCE = path.join(__dirname, "carplay", "CarPlaySceneDelegate.swift");
const SOURCE_NAME = path.basename(SOURCE);
const SCENE_ROLE = "CPTemplateApplicationSceneSessionRoleApplication";
const SCENE = {
  UISceneConfigurationName: "CarPlay",
  UISceneClassName: "CPTemplateApplicationScene",
  UISceneDelegateClassName: "CarPlaySceneDelegate",
};
const ENTITLEMENT = "com.apple.developer.carplay-voice-based-conversation";
const ENTITLEMENT_VARIABLE = "OPENBOT_CARPLAY_ENTITLEMENT";
const PHONE_SCENE_DELEGATE = "SceneDelegate.swift";
const PHONE_SCENE_CLASS = /^(@objc\(SceneDelegate\)\r?\nclass SceneDelegate: ExpoAppSceneDelegate \{\r?\n)/m;
const PLUGIN_PLACEHOLDER = /^[ \t]*\/\/ Extension point for config plugins\.\r?\n/m;
const ATTACH_CALL = "ParkedReactView.attach(";
const UIKIT_IMPORT = /^import UIKit$/m;
const ATTACH = `  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    if ParkedReactView.attach(scene, to: self, options: connectionOptions) { return }
    super.scene(scene, willConnectTo: session, options: connectionOptions)
  }
`;

function projectFolder(mod) {
  const projectName = mod.modRequest.projectName;
  if (!projectName) throw new Error("CarPlay needs the name of the Xcode project.");
  return path.join(mod.modRequest.platformProjectRoot, projectName);
}

function withPhoneSceneAttach(contents) {
  if (contents.includes(ATTACH_CALL)) return contents;
  const withoutPlaceholder = contents.replace(PLUGIN_PLACEHOLDER, "");
  if (!PHONE_SCENE_CLASS.test(withoutPlaceholder)) {
    throw new Error(`CarPlay cannot find the SceneDelegate class in ${PHONE_SCENE_DELEGATE}.`);
  }
  const attached = withoutPlaceholder.replace(PHONE_SCENE_CLASS, `$1${ATTACH}`);
  return UIKIT_IMPORT.test(attached) ? attached : `import UIKit\n${attached}`;
}

const withCarPlayFiles = (config) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const folder = projectFolder(mod);
      fs.copyFileSync(SOURCE, path.join(folder, SOURCE_NAME));
      const phoneScene = path.join(folder, PHONE_SCENE_DELEGATE);
      fs.writeFileSync(phoneScene, withPhoneSceneAttach(fs.readFileSync(phoneScene, "utf8")));
      return mod;
    },
  ]);

const withCarPlayProject = (config) =>
  withXcodeProject(config, (mod) => {
    const projectName = mod.modRequest.projectName;
    if (!projectName) throw new Error("CarPlay needs the name of the Xcode project.");
    const filepath = `${projectName}/${SOURCE_NAME}`;
    if (!mod.modResults.hasFile(filepath)) {
      mod.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: mod.modResults,
      });
    }
    return mod;
  });

const withCarPlayScene = (config) =>
  withInfoPlist(config, (mod) => {
    const configurations = mod.modResults.UIApplicationSceneManifest?.UISceneConfigurations;
    if (!configurations) return mod;
    const scenes = (configurations[SCENE_ROLE] ?? []).filter(
      (scene) => scene.UISceneDelegateClassName !== SCENE.UISceneDelegateClassName,
    );
    configurations[SCENE_ROLE] = [...scenes, SCENE];
    return mod;
  });

const withCarPlayEntitlement = (config, entitled) =>
  withEntitlementsPlist(config, (mod) => {
    if (entitled) mod.modResults[ENTITLEMENT] = true;
    else delete mod.modResults[ENTITLEMENT];
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin<{ entitled?: boolean } | undefined>} */
module.exports = (config, props) => {
  const entitled = props?.entitled === true || process.env[ENTITLEMENT_VARIABLE] === "1";
  return withCarPlayEntitlement(withCarPlayScene(withCarPlayProject(withCarPlayFiles(config))), entitled);
};
