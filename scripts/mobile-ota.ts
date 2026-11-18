// Over-the-air updates of the mobile app: a JavaScript bundle that phones with a store binary get
// from the update server (`apps/mobile-updates`) with no store review.
// See apps/mobile/README.md#over-the-air-updates.
//
//   bun scripts/mobile-ota.ts check [--platform ios|android|all]
//       shows the runtime version of this checkout and the store builds that can get it; read-only
//   bun scripts/mobile-ota.ts status [--channel production]
//       shows what the update server gives the phones of each recorded store build; read-only
//   bun scripts/mobile-ota.ts dispatch publish --platform <p> --message <text> [--rollout 1-100] [--dry-run]
//   bun scripts/mobile-ota.ts dispatch rollout --platform <p> --rollout 1-100 [--runtime <version>]
//   bun scripts/mobile-ota.ts dispatch rollback --platform <p> [--to-embedded] [--runtime <version>]
//       starts the `Mobile OTA update` workflow for the current branch. A rollout change and a
//       rollback find the update of the recorded store builds, so the branch can have another runtime
//       version. `--runtime`, with one platform, names a binary that has no tag or one of two updates.
//
// The workflow runs these. They need the signing key and the bucket credentials:
//   bun scripts/mobile-ota.ts publish --platform <p> --message <text> [--channel <c>] [--rollout 1-100] [--dry-run]
//   bun scripts/mobile-ota.ts rollout --platform <p> --rollout 1-100 [--channel <c>] [--runtime <version>]
//   bun scripts/mobile-ota.ts rollback --platform <p> [--to-embedded] [--channel <c>] [--runtime <version>]
//   bun scripts/mobile-ota.ts runtime-version --platform <p>
//       prints the runtime version of this checkout, and gives it to the next workflow steps
//   bun scripts/mobile-ota.ts verify-build --platform <p> --artifact <.ipa or .aab> --runtime <version>
//       [--channel <c>] stops when a store build has not the update server, channel and certificate of
//       this checkout, or not the runtime version that `runtime-version` gave before the build (the
//       release workflows)
//   bun scripts/mobile-ota.ts record-build --platform <p> --build <number> --runtime <version>
//       tags the commit of a store build with its runtime version (the release workflows)
//   bun scripts/mobile-ota.ts compare-runtime --base-dir <checkout>
//       says if this checkout has another runtime version than the base checkout (CI, on a pull request)
//
// Environment of publish, rollout and rollback: MOBILE_OTA_PRIVATE_KEY (PEM text),
// MOBILE_OTA_R2_ACCESS_KEY_ID, MOBILE_OTA_R2_SECRET_ACCESS_KEY, and MOBILE_OTA_R2_ENDPOINT or
// CLOUDFLARE_ACCOUNT_ID. MOBILE_OTA_R2_BUCKET replaces the bucket `openbot-mobile-updates`.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { S3Client } from "bun";
import {
  CHANNEL_PATTERN,
  RUNTIME_VERSION_PATTERN,
  UPDATE_PLATFORMS,
  type UpdatePlatform,
} from "../apps/mobile-updates/src/protocol";
import {
  changeRollout,
  fingerprint,
  liveUpdateScopes,
  parseStoreBuilds,
  probeManifest,
  publishUpdate,
  readExport,
  readPointer,
  rollBack,
  type SigningKeys,
  type StoreBuild,
  scopeName,
  storeBuildTag,
  type UpdateScope,
  type UpdateStore,
} from "./mobile-ota-lib";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const MOBILE = join(ROOT, "apps", "mobile");
const BIN = join(ROOT, "node_modules", ".bin");
const WORKFLOW = "mobile-ota.yml";
const DEFAULT_BUCKET = "openbot-mobile-updates";
/** The publish waits this long for the server to give the new update. The pointer cache is 30 s. */
const PROBE_TIMEOUT_MS = 120_000;
const PROBE_INTERVAL_MS = 5_000;
/** The paths that can change the runtime version, for the message of a refused publish. */
const RUNTIME_INPUTS = [
  "apps/mobile/app.json",
  "apps/mobile/app.config.js",
  "apps/mobile/eas.json",
  "apps/mobile/package.json",
  "apps/mobile/fingerprint.config.js",
  "apps/mobile/modules",
  "apps/mobile/plugins",
  "apps/mobile/certs",
  "apps/mobile/assets",
  "patches",
  "bun.lock",
];
/** The public values that a production bundle must have. Without them the app sends no analytics. */
const PRODUCTION_PUBLIC_ENV = ["EXPO_PUBLIC_OPENPANEL_CLIENT_ID", "EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET"];

class UsageError extends Error {}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

interface Options {
  values: Map<string, string>;
  flags: Set<string>;
}

const VALUE_OPTIONS = new Set([
  "platform",
  "message",
  "channel",
  "rollout",
  "runtime",
  "build",
  "base-dir",
  "artifact",
]);
const FLAG_OPTIONS = new Set(["dry-run", "to-embedded", "allow-unknown-runtime"]);

function parseOptions(args: string[]): Options {
  const options: Options = { values: new Map(), flags: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    // `bun run <script> -- --flag` can pass the separator too.
    if (args[index] === "--") continue;
    const name = args[index]?.replace(/^--/u, "") ?? "";
    if (FLAG_OPTIONS.has(name)) options.flags.add(name);
    else if (VALUE_OPTIONS.has(name)) {
      const value = args[index + 1];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
      options.values.set(name, value);
      index += 1;
    } else throw new UsageError(`Unknown option ${args[index]}.`);
  }
  return options;
}

function platformsOf(options: Options, fallback?: "all"): UpdatePlatform[] {
  const value = options.values.get("platform") ?? fallback;
  if (value === "all") return [...UPDATE_PLATFORMS];
  if (value === "ios" || value === "android") return [value];
  throw new UsageError("Give --platform ios, android or all.");
}

function channelOf(options: Options): string {
  const channel = options.values.get("channel") ?? "production";
  if (!CHANNEL_PATTERN.test(channel)) throw new UsageError(`The channel ${channel} is not valid.`);
  return channel;
}

function rolloutOf(options: Options, fallback?: number): number {
  const value = options.values.get("rollout");
  if (value === undefined && fallback !== undefined) return fallback;
  const rollout = Number(value);
  if (!Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
    throw new UsageError("Give --rollout as a whole number from 1 to 100.");
  }
  return rollout;
}

interface AppConfig {
  version: string;
  /** `updates.url`, such as `https://updates.openbot.run/manifest`. */
  updatesUrl: string;
  /** The origin of `updates.url`. */
  serverUrl: string;
  certificatePath: string | null;
}

function appConfig(mobileDir = MOBILE): AppConfig {
  const expo = JSON.parse(readFileSync(join(mobileDir, "app.json"), "utf8")).expo;
  const certificate = expo.updates?.codeSigningCertificate;
  const updatesUrl = String(expo.updates?.url);
  return {
    version: String(expo.version),
    updatesUrl,
    serverUrl: new URL(updatesUrl).origin,
    certificatePath: typeof certificate === "string" ? join(mobileDir, certificate) : null,
  };
}

async function git(...args: string[]): Promise<string> {
  return (await run("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}

async function storeBuilds(): Promise<StoreBuild[]> {
  // MOBILE_OTA_REMOTE replaces the remote, for the E2E script.
  const remote = process.env.MOBILE_OTA_REMOTE ?? "origin";
  return parseStoreBuilds(await git("ls-remote", "--tags", remote, "refs/tags/mobile-build/*"));
}

function buildName(build: StoreBuild): string {
  return `${build.platform} ${build.version} (${build.build})`;
}

interface RuntimeCheck {
  platform: UpdatePlatform;
  runtimeVersion: string;
  /** The store builds whose phones can run a bundle of this checkout. */
  builds: StoreBuild[];
  /** The newest store build of the platform, when no build has this runtime version. */
  newest: StoreBuild | null;
  /** The runtime inputs that changed after `newest`. Empty when its commit is not in this clone. */
  changed: string[];
}

async function checkRuntime(platform: UpdatePlatform, all: StoreBuild[]): Promise<RuntimeCheck> {
  const runtimeVersion = await fingerprint(platform, MOBILE);
  const ofPlatform = all.filter((build) => build.platform === platform);
  const builds = ofPlatform.filter((build) => build.runtimeVersion === runtimeVersion);
  const newest = builds.length === 0 ? (ofPlatform[0] ?? null) : null;
  let changed: string[] = [];
  if (newest) {
    changed = await git("diff", "--name-only", `${newest.commit}..HEAD`, "--", ...RUNTIME_INPUTS).then(
      (text) => text.split("\n").filter(Boolean),
      () => [],
    );
  }
  return { platform, runtimeVersion, builds, newest, changed };
}

function describeCheck(check: RuntimeCheck): string[] {
  const lines = [`${check.platform}: runtime version ${check.runtimeVersion}`];
  if (check.builds.length > 0) {
    lines.push(`  Phones with these store builds can get this checkout: ${check.builds.map(buildName).join(", ")}.`);
    return lines;
  }
  lines.push("  No store build has this runtime version. This checkout needs a store build.");
  if (!check.newest) lines.push("  No store build is recorded for this platform yet.");
  else {
    lines.push(`  The newest store build is ${buildName(check.newest)} at commit ${check.newest.commit.slice(0, 9)}.`);
    if (check.changed.length > 0) {
      lines.push("  Native inputs changed after that commit:", ...check.changed.map((path) => `    ${path}`));
    }
    lines.push(
      `  For a fix with no native change: git switch -c mobile-hotfix/${check.newest.version} ${check.newest.commit.slice(0, 9)}, cherry-pick the fix, and publish that branch.`,
    );
  }
  return lines;
}

async function commandCheck(options: Options) {
  const builds = await storeBuilds();
  let compatible = true;
  for (const platform of platformsOf(options, "all")) {
    const check = await checkRuntime(platform, builds);
    compatible &&= check.builds.length > 0;
    out(describeCheck(check).join("\n"));
  }
  return compatible ? 0 : 1;
}

function s3Store(): UpdateStore {
  const accessKeyId = process.env.MOBILE_OTA_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MOBILE_OTA_R2_SECRET_ACCESS_KEY;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const endpoint = process.env.MOBILE_OTA_R2_ENDPOINT ?? (account ? `https://${account}.r2.cloudflarestorage.com` : "");
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new UsageError(
      "Set MOBILE_OTA_R2_ACCESS_KEY_ID, MOBILE_OTA_R2_SECRET_ACCESS_KEY, and MOBILE_OTA_R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  const client = new S3Client({
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket: process.env.MOBILE_OTA_R2_BUCKET ?? DEFAULT_BUCKET,
    region: "auto",
  });
  return {
    read: async (key) => ((await client.exists(key)) ? await client.file(key).text() : null),
    exists: (key) => client.exists(key),
    write: async (key, body, contentType) => {
      await client.write(key, body, { type: contentType });
    },
  };
}

function signingKeys(config: AppConfig): SigningKeys {
  const privateKeyPem = process.env.MOBILE_OTA_PRIVATE_KEY;
  if (!privateKeyPem) throw new UsageError("Set MOBILE_OTA_PRIVATE_KEY to the PEM text of the update signing key.");
  if (!config.certificatePath || !existsSync(config.certificatePath)) {
    throw new UsageError("apps/mobile/app.json has no updates.codeSigningCertificate file.");
  }
  return { privateKeyPem, certificatePem: readFileSync(config.certificatePath, "utf8") };
}

/** The names in `names` that neither the environment nor an env file of the app gives a value. */
function missingPublicEnv(names: string[]): string[] {
  const files = [".env.production.local", ".env.local", ".env.production", ".env"]
    .map((name) => join(MOBILE, name))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
  return names.filter((name) => {
    if (process.env[name]) return false;
    return !files.some((text) => new RegExp(`^${name}=.+$`, "mu").test(text));
  });
}

async function publicConfig(): Promise<object> {
  const { stdout } = await run(join(BIN, "expo"), ["config", "--type", "public", "--json"], {
    cwd: MOBILE,
    maxBuffer: 64 * 1024 * 1024,
  });
  const config = JSON.parse(stdout.slice(stdout.indexOf("{")));
  if (typeof config !== "object" || config === null) throw new Error("expo config gave no app config.");
  return config;
}

async function exportBundle(platform: UpdatePlatform, channel: string, directory: string): Promise<void> {
  await run(join(BIN, "expo"), ["export", "--platform", platform, "--output-dir", directory], {
    cwd: MOBILE,
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      // The build profiles of eas.json set the same value, and the app reads it to turn analytics on.
      EXPO_PUBLIC_APP_ENV: channel,
      NODE_ENV: "production",
      // Expo CLI 58 renames each file of a DOM component to its MD5 after it bundles them. With split
      // bundles the files still name the shared chunk by its first name, and the export stops with
      // "Asset not found: _expo/static/js/web/__common-<hash>.js". One file for each component has no
      // shared chunk. Remove this when `expo export` passes without it.
      EXPO_NO_BUNDLE_SPLITTING: "1",
    },
  });
}

function summarize(lines: string[]): void {
  out(lines.join("\n"));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join("\n")}\n`);
}

/** Waits until the update server gives the phones of `scope` the update `id`. */
async function waitForServer(serverUrl: string, scope: UpdateScope, id: string): Promise<boolean> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  for (;;) {
    const served = await probeManifest(serverUrl, scope).catch(() => null);
    if (served?.kind === "update" && served.id === id) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((done) => setTimeout(done, PROBE_INTERVAL_MS));
  }
}

async function commandPublish(options: Options) {
  const message = options.values.get("message")?.trim();
  if (!message) throw new UsageError("Give --message with a short description of the update.");
  const channel = channelOf(options);
  const rollout = rolloutOf(options, 100);
  const dryRun = options.flags.has("dry-run");
  const config = appConfig();
  const builds = await storeBuilds();

  // All platforms pass the guard before one of them changes.
  const checks: RuntimeCheck[] = [];
  for (const platform of platformsOf(options)) checks.push(await checkRuntime(platform, builds));
  const refused = checks.filter((check) => check.builds.length === 0);
  for (const check of checks) out(describeCheck(check).join("\n"));
  // Only production binaries are store builds with a tag. An internal build of another channel has
  // none, and an update for a runtime version that no binary has reaches no phone.
  if (refused.length > 0 && channel === "production" && !options.flags.has("allow-unknown-runtime")) {
    summarize([
      "## Mobile OTA update refused",
      `No store build has the runtime version of this commit for: ${refused.map((check) => check.platform).join(", ")}.`,
      "The commit has native changes, so it needs a store build. Nothing was published.",
    ]);
    return 1;
  }
  if (channel === "production") {
    const missing = missingPublicEnv(PRODUCTION_PUBLIC_ENV);
    if (missing.length > 0) {
      throw new UsageError(`A production bundle needs ${missing.join(" and ")}. Nothing was published.`);
    }
  }
  if (dryRun) {
    summarize(["## Mobile OTA update: dry run", "The guard passed. Nothing was exported or published."]);
    return 0;
  }

  const keys = signingKeys(config);
  const store = s3Store();
  const commit = await git("rev-parse", "HEAD");
  const expoClient = await publicConfig();
  const lines = ["## Mobile OTA update published", `Commit: ${commit}`, `Message: ${message}`, ""];
  let served = true;
  for (const check of checks) {
    const scope: UpdateScope = { channel, platform: check.platform, runtimeVersion: check.runtimeVersion };
    const directory = await mkdtemp(join(tmpdir(), `openbot-ota-${check.platform}-`));
    try {
      out(`Exporting the ${check.platform} bundle...`);
      await exportBundle(check.platform, channel, directory);
      const result = await publishUpdate(store, {
        scope,
        update: await readExport(directory, check.platform),
        assetBaseUrl: `${config.serverUrl}/assets`,
        expoClient,
        commit,
        message,
        rollout,
        keys,
      });
      lines.push(
        `- ${scopeName(scope)}: update \`${result.update.id}\` for ${rollout}% of ${check.builds.map(buildName).join(", ") || "an unrecorded build"}; ${result.uploaded} new files.`,
      );
      // With a part rollout, the probe has no install ID and gets the base update.
      if (rollout === 100 && !(await waitForServer(config.serverUrl, scope, result.update.id))) {
        served = false;
        lines.push(`  The server does not give this update yet. Run \`bun run mobile:ota:status\`.`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  summarize(lines);
  return served ? 0 : 1;
}

/**
 * The binaries of a rollout change or a rollback. All of them are found before one of them changes,
 * so an error for one platform leaves the other platform as it was.
 */
async function liveScopes(options: Options, store: UpdateStore) {
  const runtime = options.values.get("runtime") ?? null;
  if (runtime !== null && !RUNTIME_VERSION_PATTERN.test(runtime)) {
    throw new UsageError(`The runtime version ${runtime} is not valid.`);
  }
  return liveUpdateScopes(store, {
    channel: channelOf(options),
    platforms: platformsOf(options),
    runtime,
    // With --runtime, the tags are not necessary.
    builds: runtime === null ? await storeBuilds() : [],
  });
}

function skippedLines(skipped: UpdatePlatform[]): string[] {
  return skipped.map((platform) => `- ${platform}: no store build has an update. Nothing changed.`);
}

async function commandRollout(options: Options) {
  const rollout = rolloutOf(options);
  const store = s3Store();
  const { scopes, skipped } = await liveScopes(options, store);
  const lines = ["## Mobile OTA rollout changed"];
  for (const scope of scopes) {
    const pointer = await changeRollout(store, scope, rollout);
    const id = pointer.target.kind === "update" ? pointer.target.id : "";
    lines.push(`- ${scopeName(scope)}: update \`${id}\` now goes to ${rollout}% of the phones.`);
  }
  summarize([...lines, ...skippedLines(skipped)]);
  return 0;
}

async function commandRollback(options: Options) {
  const keys = signingKeys(appConfig());
  const store = s3Store();
  const { scopes, skipped } = await liveScopes(options, store);
  const lines = ["## Mobile OTA update taken back"];
  for (const scope of scopes) {
    const before = await readPointer(store, scope);
    const result = await rollBack(store, { scope, toEmbedded: options.flags.has("to-embedded"), keys });
    const from = before?.target.kind === "update" ? before.target.id : "";
    lines.push(
      result.republished
        ? `- ${scopeName(scope)}: \`${from}\` is replaced by \`${result.republished.id}\`, a new publish of \`${result.republished.republishOf}\`.`
        : `- ${scopeName(scope)}: \`${from}\` is taken back. Phones return to the bundle in their binary.`,
    );
  }
  summarize([...lines, ...skippedLines(skipped)]);
  return 0;
}

async function commandStatus(options: Options) {
  const channel = channelOf(options);
  const config = appConfig();
  const builds = await storeBuilds();
  if (builds.length === 0)
    out("No store build is recorded. A release workflow records each build as a mobile-build/ tag.");
  const seen = new Set<string>();
  for (const build of builds) {
    const scope: UpdateScope = { channel, platform: build.platform, runtimeVersion: build.runtimeVersion };
    if (seen.has(scopeName(scope))) continue;
    seen.add(scopeName(scope));
    const served = await probeManifest(config.serverUrl, scope);
    const text =
      served.kind === "update"
        ? `update ${served.id}${served.commit ? ` of commit ${served.commit.slice(0, 9)}` : ""}`
        : served.kind === "embedded"
          ? "the bundle in the binary (an update was taken back)"
          : "no update";
    out(`${buildName(build)}, runtime ${build.runtimeVersion}: ${text}`);
  }
  return 0;
}

/** One file of a zip archive, such as an IPA or an AAB. */
async function zipEntry(archive: string, pattern: RegExp): Promise<Buffer> {
  const names = (await run("unzip", ["-Z1", archive], { maxBuffer: 256 * 1024 * 1024 })).stdout.split("\n");
  const name = names.find((candidate) => pattern.test(candidate));
  if (!name) throw new Error(`${archive} has no file that matches ${pattern}.`);
  const { stdout } = await run("unzip", ["-p", archive, name], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/** The base64 text of a PEM certificate, with no line ends: the native config keeps other line ends. */
function certificateBody(pem: string): string {
  return pem.replace(/-----[A-Z ]+-----/gu, "").replace(/\s+/gu, "");
}

interface BinarySettings {
  url: boolean;
  channel: boolean;
  certificate: boolean;
  runtimeVersion: string;
  build: string | null;
}

async function iosSettings(archive: string, config: AppConfig, channel: string, certificate: string) {
  const directory = await mkdtemp(join(tmpdir(), "openbot-ipa-"));
  try {
    const read = async (pattern: RegExp, name: string) => {
      const path = join(directory, name);
      await writeFile(path, await zipEntry(archive, pattern));
      // A built app has binary property lists. `plutil` is on each macOS runner.
      return JSON.parse((await run("plutil", ["-convert", "json", "-o", "-", path])).stdout);
    };
    const expo = await read(/^Payload\/[^/]+\.app\/Expo\.plist$/u, "Expo.plist");
    const info = await read(/^Payload\/[^/]+\.app\/Info\.plist$/u, "Info.plist");
    const settings: BinarySettings = {
      url: expo.EXUpdatesURL === config.updatesUrl,
      channel: expo.EXUpdatesRequestHeaders?.["expo-channel-name"] === channel,
      certificate: certificateBody(String(expo.EXUpdatesCodeSigningCertificate ?? "")) === certificate,
      runtimeVersion: (await zipEntry(archive, /^Payload\/[^/]+\.app\/EXUpdates\.bundle\/fingerprint$/u))
        .toString("utf8")
        .trim(),
      build: typeof info.CFBundleVersion === "string" ? info.CFBundleVersion : null,
    };
    return settings;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The `versionCode` attribute: its name, then field 3 (byte 0x1a), a length, and the text of its value. */
function manifestVersionCode(manifest: string): string | null {
  const name = "versionCode";
  for (let at = manifest.indexOf(name); at >= 0; at = manifest.indexOf(name, at + 1)) {
    const tag = at + name.length;
    if (manifest.charCodeAt(tag) !== 0x1a) continue;
    const value = manifest.slice(tag + 2, tag + 2 + manifest.charCodeAt(tag + 1));
    if (/^\d{1,10}$/u.test(value)) return value;
  }
  return null;
}

async function androidSettings(archive: string, config: AppConfig, channel: string, certificate: string) {
  // The manifest of a bundle is a protocol buffer. Its text values are there as plain text.
  const manifest = (await zipEntry(archive, /^base\/manifest\/AndroidManifest\.xml$/u)).toString("latin1");
  const settings: BinarySettings = {
    url: manifest.includes(config.updatesUrl),
    channel: manifest.includes(JSON.stringify({ "expo-channel-name": channel })),
    // The first line of the certificate. The line ends of the other lines can have another form.
    certificate: manifest.includes(certificate.slice(0, 64)),
    runtimeVersion: (await zipEntry(archive, /^base\/assets\/fingerprint$/u)).toString("utf8").trim(),
    build: manifestVersionCode(manifest),
  };
  return settings;
}

/**
 * Stops a release when the binary could not get an over-the-air update: a build with another update
 * server, no channel or another certificate is correct only after the next store build.
 */
async function commandVerifyBuild(options: Options) {
  const platforms = platformsOf(options);
  const [platform] = platforms;
  const artifact = options.values.get("artifact");
  if (!platform || platforms.length !== 1) throw new UsageError("Give --platform ios or android.");
  if (!artifact || !existsSync(artifact)) throw new UsageError("Give --artifact with the .ipa or .aab file.");
  const channel = channelOf(options);
  const config = appConfig();
  if (!config.certificatePath) throw new UsageError("apps/mobile/app.json has no updates.codeSigningCertificate.");
  const certificate = certificateBody(readFileSync(config.certificatePath, "utf8"));
  const settings =
    platform === "ios"
      ? await iosSettings(artifact, config, channel, certificate)
      : await androidSettings(artifact, config, channel, certificate);
  // The native build on a Linux runner changes the result of a fingerprint of the same checkout:
  // run 42826070568 gave another value after the build than a clean checkout and the binary have.
  // So this command does not compute the value. `runtime-version` gives it before the build.
  const expected = options.values.get("runtime");
  if (expected === undefined || !RUNTIME_VERSION_PATTERN.test(expected)) {
    throw new UsageError(
      "Give --runtime with the value of `mobile-ota.ts runtime-version`, from a step before the native build.",
    );
  }
  const problems = [
    ...(settings.url ? [] : [`The binary does not use the update server ${config.updatesUrl}.`]),
    ...(settings.channel ? [] : [`The binary does not send the channel ${channel}.`]),
    ...(settings.certificate ? [] : ["The binary does not have the update signing certificate of apps/mobile/certs."]),
    ...(settings.runtimeVersion === expected
      ? []
      : [`The binary has runtime version ${settings.runtimeVersion}, but this checkout gives ${expected}.`]),
  ];
  if (problems.length > 0) {
    summarize(["## The store build cannot get over-the-air updates", ...problems.map((problem) => `- ${problem}`)]);
    return 1;
  }
  if (!settings.build) throw new Error("The binary has no build number.");
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `runtime=${settings.runtimeVersion}\nbuild=${settings.build}\n`);
  summarize([
    `Over-the-air updates: build ${settings.build}, server ${config.updatesUrl}, channel ${channel}, runtime version \`${settings.runtimeVersion}\`.`,
  ]);
  return 0;
}

async function commandRecordBuild(options: Options) {
  const [platform] = platformsOf(options);
  const build = options.values.get("build") ?? "";
  if (!platform || platformsOf(options).length !== 1) throw new UsageError("Give --platform ios or android.");
  if (!/^\d+$/u.test(build)) throw new UsageError("Give --build with the build number of the store build.");
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new UsageError("Set GH_TOKEN and GITHUB_REPOSITORY.");
  const runtimeVersion = options.values.get("runtime") ?? (await fingerprint(platform, MOBILE));
  const tag = storeBuildTag({ platform, version: appConfig().version, build, runtimeVersion });
  const sha = process.env.GITHUB_SHA ?? (await git("rev-parse", "HEAD"));
  const response = await fetch(`https://api.github.com/repos/${repository}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
  // 422: the tag exists, such as after a second run of the same build.
  if (!response.ok && response.status !== 422) {
    throw new Error(`GitHub answered ${response.status} for the tag ${tag}.`);
  }
  summarize([`Store build tag: \`${tag}\``, `Runtime version: \`${runtimeVersion}\``]);
  return 0;
}

/** The runtime version of a clean checkout, for a workflow step that runs before the native build. */
async function commandRuntimeVersion(options: Options) {
  const platforms = platformsOf(options);
  const [platform] = platforms;
  if (!platform || platforms.length !== 1) throw new UsageError("Give --platform ios or android.");
  const runtimeVersion = await fingerprint(platform, MOBILE);
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `runtime=${runtimeVersion}\n`);
  out(runtimeVersion);
  return 0;
}

async function commandCompareRuntime(options: Options) {
  const baseDir = options.values.get("base-dir");
  if (!baseDir) throw new UsageError("Give --base-dir with a checkout of the base commit that has its dependencies.");
  const changed: UpdatePlatform[] = [];
  for (const platform of UPDATE_PLATFORMS) {
    const [base, head] = [
      await fingerprint(platform, join(resolve(baseDir), "apps", "mobile")),
      await fingerprint(platform, MOBILE),
    ];
    out(`${platform}: base ${base}, this change ${head}`);
    if (base !== head) changed.push(platform);
  }
  if (changed.length === 0) {
    summarize(["Mobile runtime: no change. This change can go to phones as an over-the-air update."]);
    return 0;
  }
  const text = `This change makes a new mobile runtime version for ${changed.join(" and ")}. It reaches phones only with a store build, and later changes on main cannot go over the air to the current store build.`;
  if (process.env.GITHUB_ACTIONS) out(`::notice title=Mobile runtime changed::${text}`);
  summarize([`Mobile runtime: ${text}`]);
  return 0;
}

async function commandDispatch(action: string | undefined, options: Options) {
  if (action !== "publish" && action !== "rollout" && action !== "rollback") {
    throw new UsageError("Give dispatch publish, dispatch rollout or dispatch rollback.");
  }
  const platform = options.values.get("platform");
  if (platform !== "ios" && platform !== "android" && platform !== "all") {
    throw new UsageError("Give --platform ios, android or all.");
  }
  // A publish sends the code of the branch, so the remote branch must be this commit. A rollout
  // change and a rollback use no code of a branch: they find the update from the store build tags.
  // They always run on `main`, also from another branch or from a checkout that is not up to date.
  let branch = "main";
  if (action === "publish") {
    branch = await git("branch", "--show-current");
    if (branch !== "main" && !branch.startsWith("mobile-hotfix/")) {
      throw new UsageError("Publish an update from main or from a mobile-hotfix/ branch.");
    }
    const remote = (await git("ls-remote", "origin", `refs/heads/${branch}`)).split("\t")[0];
    if (remote !== (await git("rev-parse", "HEAD"))) {
      throw new UsageError(`origin/${branch} is not at this commit. Push first: the workflow runs the remote branch.`);
    }
  }
  const fields = [`action=${action}`, `platform=${platform}`, `channel=${channelOf(options)}`];
  if (action === "publish") {
    const message = options.values.get("message")?.trim();
    if (!message) throw new UsageError("Give --message with a short description of the update.");
    fields.push(`message=${message}`, `rollout=${rolloutOf(options, 100)}`, `dry_run=${options.flags.has("dry-run")}`);
  }
  if (action === "rollout") fields.push(`rollout=${rolloutOf(options)}`);
  if (action === "rollback") fields.push(`to_embedded=${options.flags.has("to-embedded")}`);
  const runtime = options.values.get("runtime");
  if (runtime !== undefined && action !== "publish") fields.push(`runtime=${runtime}`);
  await run("gh", ["workflow", "run", WORKFLOW, "--ref", branch, ...fields.flatMap((field) => ["-f", field])], {
    cwd: ROOT,
  });
  out(
    `Started the Mobile OTA update workflow (${action}) on ${branch}. Follow it with: gh run list --workflow ${WORKFLOW}`,
  );
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "check":
      return commandCheck(parseOptions(rest));
    case "status":
      return commandStatus(parseOptions(rest));
    case "publish":
      return commandPublish(parseOptions(rest));
    case "rollout":
      return commandRollout(parseOptions(rest));
    case "rollback":
      return commandRollback(parseOptions(rest));
    case "verify-build":
      return commandVerifyBuild(parseOptions(rest));
    case "record-build":
      return commandRecordBuild(parseOptions(rest));
    case "runtime-version":
      return commandRuntimeVersion(parseOptions(rest));
    case "compare-runtime":
      return commandCompareRuntime(parseOptions(rest));
    case "dispatch":
      return commandDispatch(rest[0], parseOptions(rest.slice(1)));
    default:
      throw new UsageError(
        "Give a command: check, status, dispatch, publish, rollout, rollback, runtime-version, verify-build, record-build or compare-runtime.",
      );
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
