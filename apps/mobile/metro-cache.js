const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CACHE_FORMAT = "1";
const UNUSED_NAMESPACE_MS = 14 * 24 * 60 * 60 * 1000;

function mobileBuildCacheRoot(projectRoot) {
  const setting = process.env.OPENBOT_MOBILE_BUILD_CACHE;
  if (setting === "off") return undefined;
  if (setting) return path.resolve(projectRoot, "../..", setting);
  const gitDirectory = runGit(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return gitDirectory && path.join(gitDirectory, "openbot-mobile-cache.noindex");
}

function runGit(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (error) {
    if (error.code === "ENOENT" || typeof error.status === "number") return undefined;
    throw error;
  }
}

function dependencyNamespace(repositoryRoot, projectRoot) {
  const hash = crypto.createHash("sha256").update(CACHE_FORMAT);
  const lockText = fs.readFileSync(path.join(repositoryRoot, "bun.lock"), "utf8");
  const lock = parseBunLock(lockText);
  if (!lock) {
    hash.update(lockText);
    for (const patch of fs.readdirSync(path.join(repositoryRoot, "patches")).sort()) {
      hash.update(patch).update(fs.readFileSync(path.join(repositoryRoot, "patches", patch)));
    }
    return hash.digest("hex").slice(0, 16);
  }
  const appWorkspace = path.relative(repositoryRoot, projectRoot).split(path.sep).join("/");
  const app = reachablePackages(lock, [[appWorkspace, false]]);
  const otherWorkspaces = Object.keys(lock.workspaces).filter((workspace) => workspace !== appWorkspace);
  const others = reachablePackages(lock, [
    [appWorkspace, true],
    ...otherWorkspaces.map((workspace) => [workspace, true]),
  ]);
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (others.has(key) && !app.has(key)) continue;
    hash.update(`${key}\0${JSON.stringify(entry)}\n`);
    const patch = lock.patchedDependencies?.[entry[0]];
    if (patch) hash.update(fs.readFileSync(path.join(repositoryRoot, patch)));
  }
  return hash.digest("hex").slice(0, 16);
}

function parseBunLock(text) {
  try {
    const lock = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
    return lock.workspaces && lock.packages ? lock : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function reachablePackages(lock, roots) {
  const seen = new Set();
  const dependencyNames = (info, dev) =>
    Object.keys({
      ...info?.dependencies,
      ...info?.optionalDependencies,
      ...info?.peerDependencies,
      ...(dev ? info?.devDependencies : {}),
    });
  const resolve = (parent, name) => {
    for (let base = parent; ; ) {
      const key = base ? `${base}/${name}` : name;
      if (lock.packages[key]) return visitPackage(key);
      if (!base) return;
      const parts = base.split("/");
      const nameParts = parts.length > 1 && parts.at(-2).startsWith("@") ? 2 : 1;
      base = parts.slice(0, -nameParts).join("/");
    }
  };
  const visitWorkspace = (directory, dev) => {
    const workspace = lock.workspaces[directory];
    if (!workspace || seen.has(`workspace:${directory}:${dev}`)) return;
    seen.add(`workspace:${directory}:${dev}`);
    for (const name of dependencyNames(workspace, dev)) resolve(workspace.name ?? "", name);
  };
  const visitPackage = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const [spec, , info] = lock.packages[key];
    const workspace = /@workspace:(.+)$/.exec(spec);
    if (workspace) return visitWorkspace(workspace[1], false);
    for (const name of dependencyNames(info, false)) resolve(key, name);
  };
  for (const [directory, dev] of roots) visitWorkspace(directory, dev);
  return seen;
}

function installIsCurrent(repositoryRoot) {
  const modifiedAt = (file) => fs.statSync(path.join(repositoryRoot, file)).mtimeMs;
  const stamp = path.join(repositoryRoot, "node_modules/.openbot-install-stamp");
  if (!fs.existsSync(stamp)) return false;
  const patches = fs.existsSync(path.join(repositoryRoot, "patches"))
    ? fs.readdirSync(path.join(repositoryRoot, "patches")).map((patch) => path.join("patches", patch))
    : [];
  const installedAt = fs.statSync(stamp).mtimeMs;
  return ["bun.lock", ...patches].every((file) => modifiedAt(file) <= installedAt);
}

function expoFileStore() {
  try {
    const { FileStore } = require(
      require.resolve("@expo/metro-config/build/binary-file-store", {
        paths: [path.dirname(require.resolve("expo/package.json"))],
      }),
    );
    return typeof FileStore === "function" ? FileStore : undefined;
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

function removeUnusedNamespaces(namespacesRoot, current, now) {
  for (const name of fs.readdirSync(namespacesRoot)) {
    const directory = path.join(namespacesRoot, name);
    if (directory === current) continue;
    let usedAt;
    try {
      usedAt = fs.statSync(directory).mtimeMs;
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (now - usedAt < UNUSED_NAMESPACE_MS) continue;
    fs.promises.rm(directory, { recursive: true, force: true }).catch((error) => {
      console.warn(`Could not remove the unused Metro cache ${directory}: ${error.message}`);
    });
  }
}

function mentions(value, text) {
  if (typeof value === "string") return value.includes(text);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).includes(text);
  if (value !== null && typeof value === "object") return Object.values(value).some((item) => mentions(item, text));
  return false;
}

class WorktreeTransformStore {
  #shared;
  #local;
  #checkoutPaths;

  constructor({ shared, local, checkoutPaths }) {
    this.#shared = shared;
    this.#local = local;
    this.#checkoutPaths = checkoutPaths;
  }

  async get(key) {
    return (await this.#shared.get(key)) ?? this.#local.get(key);
  }

  set(key, value) {
    const store = this.#checkoutPaths.some((checkout) => mentions(value, checkout)) ? this.#local : this.#shared;
    return store.set(key, value);
  }

  clear() {
    if (process.env.OPENBOT_KEEP_METRO_CACHE) return;
    this.#shared.clear();
    this.#local.clear();
  }
}

function createTransformCacheStore(projectRoot) {
  if (process.env.EAS_BUILD || process.env.EAS_BUILD_RUNNER) return undefined;
  const cacheRoot = mobileBuildCacheRoot(projectRoot);
  if (!cacheRoot) return undefined;
  const repositoryRoot = path.resolve(projectRoot, "../..");
  if (!installIsCurrent(repositoryRoot)) {
    console.warn(
      "Metro does not use the shared transform cache: bun.lock or a patch is newer than node_modules. Run `bun install --frozen-lockfile`.",
    );
    return undefined;
  }
  const FileStore = expoFileStore();
  if (!FileStore) {
    console.warn("Metro does not use the shared transform cache: Expo moved its file store.");
    return undefined;
  }
  const namespacesRoot = path.join(cacheRoot, "metro");
  const namespace = path.join(namespacesRoot, dependencyNamespace(repositoryRoot, projectRoot));
  try {
    fs.mkdirSync(namespace, { recursive: true });
    const now = new Date();
    fs.utimesSync(namespace, now, now);
    removeUnusedNamespaces(namespacesRoot, namespace, now.getTime());
  } catch (error) {
    if (typeof error.code !== "string") throw error;
    console.warn(`Metro does not use the shared transform cache in ${namespacesRoot}: ${error.message}`);
    return undefined;
  }
  const checkouts = [...new Set([repositoryRoot, fs.realpathSync(repositoryRoot)])];
  return new WorktreeTransformStore({
    shared: new FileStore({ root: namespace }),
    local: new FileStore({ root: path.join(projectRoot, ".expo/metro-cache") }),
    checkoutPaths: [...new Set([...checkouts, ...checkouts.map((checkout) => pathToFileURL(checkout).href)])],
  });
}

module.exports = { createTransformCacheStore, mobileBuildCacheRoot };
