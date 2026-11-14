const { withXcodeProject } = require("expo/config-plugins");

// Removes two warnings that Xcode gives at each build of the generated project. The build result
// does not change.
//
// - `expo-dev-launcher` adds the script phase below with no output files, so Xcode cannot tell when
//   to run it and warns. The script must run at each build, so say that.
// - The Expo template sets `COPY_PHASE_STRIP` for Release. The app copies its extensions after their
//   signature, and Xcode does not strip a signed binary: it warns for each one instead. In an archive
//   build, each target strips its own binary before the signature.

const DEV_LAUNCHER_PHASE = "[Expo Dev Launcher] Strip Local Network Keys for Release";

/** The values of a project section. The section also has a comment string for each object. */
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
