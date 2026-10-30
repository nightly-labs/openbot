const { existsSync, readFileSync, realpathSync } = require("node:fs");
const { dirname, join, relative } = require("node:path");
const { withAppBuildGradle } = require("expo/config-plugins");

// The React Native Gradle task that makes the release JS bundle only checks the sources under
// `apps/mobile`. When only a workspace package such as `@openbot/team-client` changes, Gradle marks
// the task `UP-TO-DATE` and puts the old bundle in the APK. This adds the sources of each workspace
// package that the app uses, directly or through another workspace package, as task inputs.

const MARKER = "// @generated with-workspace-bundle-inputs";

/** The real directory of the installed package `name`, from the closest `node_modules` link. */
function packageDirectory(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(candidate)) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`Cannot find workspace package ${name} from ${from}`);
  }
}

/** @param {string} packageDir */
function workspaceDependencies(packageDir) {
  const { dependencies = {} } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return Object.entries(dependencies)
    .filter(([, version]) => String(version).startsWith("workspace:"))
    .map(([name]) => packageDirectory(name, packageDir));
}

/** @param {string} projectRoot */
function workspaceSources(projectRoot) {
  const found = new Set();
  const pending = workspaceDependencies(projectRoot);
  while (pending.length > 0) {
    const dir = pending.pop();
    if (found.has(dir)) continue;
    found.add(dir);
    pending.push(...workspaceDependencies(dir));
  }
  return [...found].map((dir) => join(dir, "src")).sort();
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(MARKER)) return config;
    const { projectRoot, platformProjectRoot } = config.modRequest;
    const dirs = workspaceSources(projectRoot)
      .map((dir) => `    "${relative(platformProjectRoot, dir)}",`)
      .join("\n");
    config.modResults.contents += `
${MARKER}
def workspaceBundleSources = [
${dirs}
].collect { path ->
    fileTree(new File(rootDir, path)) { tree ->
        tree.include("**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.json")
    }
}
tasks.matching { it.name.startsWith("createBundle") && it.name.endsWith("JsAndAssets") }.configureEach { task ->
    task.inputs.files(workspaceBundleSources).withPropertyName("workspaceBundleSources")
}
`;
    return config;
  });
