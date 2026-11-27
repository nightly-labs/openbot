const path = require("node:path");
const withWidget = require("@bacons/apple-targets/build/with-widget").default;
const { withPodTargetExtension } = require("@bacons/apple-targets/build/with-pod-target-extension");
const { withXcodeProjectBetaBaseMod } = require("@bacons/apple-targets/build/with-bacons-xcode");

const TARGETS = ["watch-complication", "watch"];

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => {
  const projectRoot = config._internal?.projectRoot;
  if (!projectRoot) throw new Error("The watch targets need the project root.");
  const appleTeamId = config.ios?.appleTeamId;
  for (const folder of TARGETS) {
    const configPath = path.join(projectRoot, "targets", folder, "expo-target.config.js");
    const loaded = require(configPath);
    const target = typeof loaded === "function" ? loaded(config) : loaded;
    if (!target?.type) throw new Error(`${configPath} has no target type.`);
    config = withWidget(config, {
      appleTeamId,
      ...target,
      directory: path.relative(projectRoot, path.dirname(configPath)),
      configPath,
    });
  }
  withPodTargetExtension(config);
  withXcodeProjectBetaBaseMod(config);
  return config;
};
