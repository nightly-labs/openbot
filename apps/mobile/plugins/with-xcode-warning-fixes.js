const { withXcodeProject } = require("expo/config-plugins");

const DEV_LAUNCHER_PHASE = "[Expo Dev Launcher] Strip Local Network Keys for Release";

function objects(section) {
  return Object.values(section ?? {}).filter((value) => typeof value === "object");
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    for (const phase of objects(project.hash.project.objects.PBXShellScriptBuildPhase)) {
      if (phase.name === `"${DEV_LAUNCHER_PHASE}"`) phase.alwaysOutOfDate = 1;
    }
    for (const { buildSettings } of objects(project.pbxXCBuildConfigurationSection())) {
      if (buildSettings?.COPY_PHASE_STRIP === "YES") buildSettings.COPY_PHASE_STRIP = "NO";
    }
    return config;
  });
