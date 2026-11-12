// The Android app as an APK on GitHub, for a phone with no Google Play. openbot.run links to it
// (`apps/auth-api/src/lib/android-apk.ts`). See apps/mobile/README.md#android-apk.
//
//   bun scripts/android-apk-release.ts stage --apk <file> --version-code <number> [--replace] [--dry-run]
//   bun scripts/android-apk-release.ts publish [--dry-run]
//
// `stage` runs after a store build (the `Stage the Android APK` workflow). Fastlane downloaded the
// universal APK that Google Play makes from the store bundle `--version-code`. The command reads the
// package, the version and the build number in the file, and the certificate that signed it. It
// stops when the file is not that build of the app or when its signature is not valid. Then it puts
// the file on the draft GitHub release `android-v<version>` as `OpenBot-<version>.apk`. A draft is
// not public: only people who can write to the repository see it. A second build of a version
// replaces the file of the first. A release that is public already stays as it is, unless
// `--replace` is given.
//
// `publish` runs when a version is marked as available (the `Publish the Android APK` workflow, on a
// change of `apps/auth-api/src/server/mobile-features-config.ts` on main). It makes the draft of the
// version that the site offers public. It does nothing while the site offers no APK or when the
// release is public already, and it stops when that version has no release.
//
// The release is a GitHub prerelease, as the remote desktop runtime releases are. A prerelease
// cannot become the "latest" release, which is the desktop app and which the desktop updater reads,
// and the notes of the next desktop release do not start from it. `--dry-run` checks and changes
// nothing.
//
// Environment: for `stage`, ANDROID_HOME (aapt2 and apksigner of the build tools). To change a
// release: GH_TOKEN with write access (a draft is not visible without it), GITHUB_REPOSITORY, and
// for `stage` GITHUB_SHA.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { androidApkRelease, androidApkVersion } from "../apps/auth-api/src/lib/android-apk";
import { parseStoreBuilds } from "./mobile-ota-lib";

const run = promisify(execFile);
const PACKAGE = "run.openbot.mobile";
const INSTALL_PAGE = "https://openbot.run/download/android";

class UsageError extends Error {}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function summarize(lines: string[]): void {
  out(lines.join("\n"));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join("\n")}\n`);
}

/** A tool of the newest Android build tools. */
function buildTool(name: string): string {
  const home = process.env.ANDROID_HOME;
  const directory = home ? join(home, "build-tools") : undefined;
  if (!directory || !existsSync(directory))
    throw new UsageError("Set ANDROID_HOME to an Android SDK with build tools.");
  const newest = readdirSync(directory)
    .filter((version) => existsSync(join(directory, version, name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  if (!newest) throw new UsageError(`The build tools in ${directory} have no ${name}.`);
  return join(directory, newest, name);
}

interface ApkIdentity {
  packageName: string;
  versionCode: string;
  versionName: string;
}

/** The first line of `aapt2 dump badging`: package: name='…' versionCode='…' versionName='…'. */
async function apkIdentity(apk: string): Promise<ApkIdentity> {
  const { stdout } = await run(buildTool("aapt2"), ["dump", "badging", apk], { maxBuffer: 64 * 1024 * 1024 });
  const line = stdout.split("\n").find((candidate) => candidate.startsWith("package:")) ?? "";
  const value = (name: string) => new RegExp(` ${name}='([^']*)'`, "u").exec(line)?.[1];
  const [packageName, versionCode, versionName] = [value("name"), value("versionCode"), value("versionName")];
  if (!packageName || !versionCode || !versionName) throw new Error("aapt2 gave no package, build number or version.");
  return { packageName, versionCode, versionName };
}

/**
 * The SHA-256 of the certificate that signed the APK. `apksigner verify` stops when the signature
 * is not valid. Google Play also adds a source stamp, which is not the app signing key.
 */
async function signingCertificate(apk: string): Promise<string> {
  const { stdout } = await run(buildTool("apksigner"), ["verify", "--print-certs", apk]);
  const digests = stdout.split("\n").flatMap((line) => {
    const digest = /^(?!Source Stamp).*certificate SHA-256 digest: ([0-9a-f]{64})\s*$/u.exec(line)?.[1];
    return digest ? [digest] : [];
  });
  const [digest] = digests;
  if (!digest || digests.length !== 1) throw new Error("The APK must have one signing certificate.");
  return digest;
}

function fileSha256(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });
}

/**
 * The commit of the store build, from the tag that the release workflow records. Undefined while
 * that tag is not there: the record job runs at the same time as this one.
 */
async function storeBuildCommit(version: string, build: string): Promise<string | undefined> {
  const { stdout } = await run("git", ["ls-remote", "--tags", "origin", `refs/tags/mobile-build/android/${version}/*`]);
  return parseStoreBuilds(stdout).find((candidate) => candidate.version === version && candidate.build === build)
    ?.commit;
}

function option(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

function repositoryOf(): string {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!process.env.GH_TOKEN || !repository) throw new UsageError("Set GH_TOKEN and GITHUB_REPOSITORY.");
  return repository;
}

interface ReleaseState {
  draft: boolean;
  assets: string[];
}

/** The release of `tag`, or undefined when there is none. `gh` also finds a draft, which has no git tag. */
async function releaseState(repository: string, tag: string): Promise<ReleaseState | undefined> {
  // One line with the draft state, then one line for each file name.
  const query = "(.isDraft | tostring), .assets[].name";
  try {
    const { stdout } = await run("gh", [
      "release",
      "view",
      tag,
      "--repo",
      repository,
      "--json",
      "isDraft,assets",
      "--jq",
      query,
    ]);
    const [draft, ...assets] = stdout.split("\n").filter((line) => line !== "");
    if (draft !== "true" && draft !== "false") throw new Error(`gh gave no state for the release ${tag}.`);
    return { draft: draft === "true", assets };
  } catch (error) {
    if (error instanceof Error && /release not found/iu.test(error.message)) return undefined;
    throw error;
  }
}

/** The tag of the "latest" release: the desktop app. Empty when GitHub gives none. */
async function latestRelease(repository: string): Promise<string> {
  const { stdout } = await run("gh", ["api", `repos/${repository}/releases/latest`, "--jq", ".tag_name"]).catch(() => ({
    stdout: "",
  }));
  return stdout.trim();
}

async function commandStage(args: readonly string[]) {
  const apk = option(args, "apk");
  const versionCode = option(args, "version-code");
  const dryRun = args.includes("--dry-run");
  if (!apk || !existsSync(apk)) throw new UsageError("Give --apk with the APK file.");
  if (!versionCode || !/^\d+$/u.test(versionCode)) {
    throw new UsageError("Give --version-code with the build number of the Google Play bundle.");
  }

  const identity = await apkIdentity(apk);
  if (identity.packageName !== PACKAGE) throw new Error(`The APK is ${identity.packageName}, not ${PACKAGE}.`);
  if (identity.versionCode !== versionCode) {
    throw new Error(`The APK is build ${identity.versionCode}, not build ${versionCode}.`);
  }
  const version = identity.versionName;
  const release = androidApkRelease(version);
  const certificate = await signingCertificate(apk);
  const sha256 = await fileSha256(apk);
  const lines = [
    `## Android APK ${version} (build ${versionCode})`,
    `Release: \`${release.tag}\`, file \`${release.asset}\``,
    `SHA-256 of the file: \`${sha256}\``,
    `SHA-256 of the signing certificate: \`${certificate}\``,
  ];
  if (dryRun) {
    summarize([...lines, "Dry run: nothing is changed."]);
    return 0;
  }

  const repository = repositoryOf();
  const state = await releaseState(repository, release.tag);
  // A public file is the one that openbot.run gives. A new build must not replace it by accident.
  if (state && !state.draft && !args.includes("--replace")) {
    throw new Error(
      `The release ${release.tag} is public. To replace its APK with build ${versionCode}, start the workflow again with "replace" set.`,
    );
  }
  const commit = (await storeBuildCommit(version, versionCode)) ?? process.env.GITHUB_SHA;
  if (!commit) throw new UsageError("Set GITHUB_SHA: the store build has no tag yet.");
  const notes = [
    `OpenBot for Android ${version} (build ${versionCode}) as an APK, for a phone with no Google Play. It is the universal APK that Google Play makes from the store bundle, so it has the signature of the app on Google Play. Install steps: ${INSTALL_PAGE}`,
    "This release is not an update of the desktop app. It is a GitHub prerelease only so that it never becomes the latest release: the build is the one on Google Play.",
    `- Commit: ${commit}\n- SHA-256 of the file: \`${sha256}\`\n- SHA-256 of the signing certificate: \`${certificate}\``,
  ].join("\n\n");

  // `gh` names an asset after its file.
  const directory = await mkdtemp(join(tmpdir(), "openbot-apk-"));
  try {
    const asset = join(directory, release.asset);
    await copyFile(apk, asset);
    const gh = (...ghArgs: string[]) => run("gh", [...ghArgs, "--repo", repository]);
    if (state) {
      await gh("release", "upload", release.tag, asset, "--clobber");
      // A draft has no git tag yet. Its tag goes to the commit of this build when it becomes public.
      const target = state.draft ? ["--target", commit] : [];
      await gh("release", "edit", release.tag, "--notes", notes, "--prerelease", "--latest=false", ...target);
    } else {
      const title = `OpenBot for Android ${version}`;
      await gh(
        "release",
        "create",
        release.tag,
        asset,
        "--draft",
        "--prerelease",
        "--target",
        commit,
        "--title",
        title,
        "--notes",
        notes,
        "--latest=false",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  summarize([
    ...lines,
    state && !state.draft
      ? `Replaced the public file: ${release.url}`
      : "Saved as a draft release. It is not public until the version is marked as available.",
  ]);
  return 0;
}

async function commandPublish(args: readonly string[]) {
  const dryRun = args.includes("--dry-run");
  const version = androidApkVersion();
  if (version === undefined) {
    summarize(["Android APK: the site offers no APK, so there is nothing to make public."]);
    return 0;
  }
  const release = androidApkRelease(version);
  const repository = repositoryOf();
  const state = await releaseState(repository, release.tag);
  if (!state?.assets.includes(release.asset)) {
    summarize([
      `## The Android APK ${version} is missing`,
      `openbot.run offers the APK of ${version}, but the release \`${release.tag}\` ${state ? `has no \`${release.asset}\`` : "is not on GitHub"}. The download link on the site does not work.`,
      "Start `Stage the Android APK` with the build number of that version, then run this workflow again.",
    ]);
    return 1;
  }
  if (!state.draft) {
    summarize([`Android APK ${version}: the release \`${release.tag}\` is public already.`]);
    return 0;
  }
  if (dryRun) {
    summarize([`Android APK ${version}: dry run. The draft \`${release.tag}\` would become public.`]);
    return 0;
  }
  // A release that becomes public with no `--prerelease` and `--latest=false` can become the
  // "latest" release, and then the desktop downloads and the desktop updater find no installer.
  const before = await latestRelease(repository);
  await run("gh", [
    "release",
    "edit",
    release.tag,
    "--repo",
    repository,
    "--draft=false",
    "--prerelease",
    "--latest=false",
  ]);
  const after = await latestRelease(repository);
  // An empty value is a failed read, not a change.
  if (before !== "" && after !== "" && after !== before) {
    summarize([
      `## The "latest" release changed from \`${before}\` to \`${after}\``,
      `Desktop downloads and updates read the "latest" release. Mark \`${before}\` as latest again: \`gh release edit ${before} --latest\`.`,
    ]);
    return 1;
  }
  summarize([`## Android APK ${version} is public`, release.url]);
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "stage") return commandStage(args);
  if (command === "publish") return commandPublish(args);
  throw new UsageError("Give a command: stage or publish.");
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
