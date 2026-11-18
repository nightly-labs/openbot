// Drives `mobile-ota-release-notes.ts`, `check-release-notes.ts --ota` and `prepare-release.ts --mobile`
// as processes, in a temporary git repository that has the files they read. Then it reads the
// changelog that they wrote with the parser of the account Worker, as `/changelog` and
// `/v1/mobile/changelog` do. Writes .openbot-build/mobile-ota-release-notes-e2e.json.
//
//   bun scripts/mobile-ota-release-notes-e2e.ts

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../apps/auth-api/src/lib/changelog";
import { isNewerMobileVersion } from "../packages/contracts/src/mobile-features";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(root, ".openbot-build", "mobile-ota-release-notes-e2e.json");
const CHANGELOG = "apps/mobile/CHANGELOG.md";
const NOTES = "apps/mobile/changelog.d";
/** The files that an OTA update must not change. */
const VERSION_FILES = [
  "apps/mobile/app.json",
  "apps/mobile/package.json",
  "bun.lock",
  "apps/mobile/release-announcement.json",
];

const work = mkdtempSync(join(tmpdir(), "openbot-mobile-ota-notes-e2e-"));
const read = (path: string) => readFileSync(join(work, path), "utf8");
function write(path: string, text: string): void {
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), text);
}
// Each commit is one minute after the one before it: the release orders the notes by commit time.
let clock = Date.parse("2026-11-10T00:00:00Z");
function git(...args: string[]): string {
  const date = new Date(clock).toISOString();
  return execFileSync("git", args, {
    cwd: work,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}
function commit(message: string): void {
  clock += 60_000;
  git("add", "-A");
  git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "--quiet", "--no-verify", "-m", message);
}
function cli(script: string, args: readonly string[]): { status: number; output: string } {
  const child = Bun.spawnSync(["bun", join(root, "scripts", script), ...args], {
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { status: child.exitCode, output: `${child.stdout.toString()}${child.stderr.toString()}` };
}
const ota = (...args: string[]) => cli("mobile-ota-release-notes.ts", ["--base", "store-1.4.8", ...args]);
const headings = () =>
  read(CHANGELOG)
    .split("\n")
    .filter((line) => line.startsWith("## ["));
const versionFiles = () => VERSION_FILES.map((path) => read(path)).join("\n---\n");

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, passed: boolean, detail: unknown): void {
  checks.push({ name, passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
}

try {
  // The store build: 1.4.8 is on Android, and iOS still reviews it. One note waits for 1.4.9.
  git("init", "--quiet", "--initial-branch=main");
  write("apps/mobile/app.json", `${JSON.stringify({ expo: { version: "1.4.8" } }, null, 2)}\n`);
  write("apps/mobile/package.json", `${JSON.stringify({ name: "@openbot/mobile", version: "1.4.8" }, null, 2)}\n`);
  write(
    "bun.lock",
    `{\n  "workspaces": {\n    "apps/mobile": {\n      "name": "@openbot/mobile",\n      "version": "1.4.8",\n    },\n  },\n}\n`,
  );
  write("apps/mobile/release-announcement.json", JSON.stringify({ version: "1.4.8", highlights: ["One."] }));
  write(
    CHANGELOG,
    [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [1.4.8] - 2026-11-10 (Android)",
      "",
      "### Added",
      "",
      "- The store version.",
      "",
      "## [1.4.7] - 2026-11-06",
      "",
      "### Fixed",
      "",
      "- An older fix.",
      "",
    ].join("\n"),
  );
  write(`${NOTES}/README.md`, "# Unreleased mobile notes\n");
  write(`${NOTES}/native-camera.md`, "### Added\n\n- A camera feature that needs new native code.\n");
  commit("Store build 1.4.8");
  git("tag", "store-1.4.8");
  const storeFiles = versionFiles();
  const storeChangelog = read(CHANGELOG);

  // No note is new since the store build.
  let result = ota("--platform", "android");
  check(
    "stops with no new note",
    result.status === 1 && result.output.includes("has no release notes") && read(CHANGELOG) === storeChangelog,
    result.output,
  );
  result = ota("--platform", "android", "--allow-empty");
  check(
    "--allow-empty changes nothing",
    result.status === 0 && read(CHANGELOG) === storeChangelog && git("status", "--porcelain") === "",
    result.output,
  );

  // Two fixes after the store build, in two commits. The older one is first in its group.
  write(`${NOTES}/fix-scroll.md`, "### Fixed\n\n- The chat scrolls to the newest message again.\n");
  commit("Fix scroll");
  write(`${NOTES}/add-shortcut.md`, "### Added\n\n- A shortcut to the last chat.\n\n### Fixed\n\n- A second fix.\n");
  commit("Add shortcut");

  result = ota("--platform", "android", "--date", "2026-11-12", "--dry-run");
  check(
    "--dry-run prints the section and changes nothing",
    result.status === 0 &&
      result.output.includes("## [1.4.8.1] - 2026-11-12 (Android)") &&
      result.output.includes("- A shortcut to the last chat.") &&
      read(CHANGELOG) === storeChangelog &&
      git("status", "--porcelain") === "",
    result.output,
  );

  // iOS does not have 1.4.8, so its users cannot get an update of it.
  result = ota("--platform", "all", "--date", "2026-11-12");
  check(
    "refuses a platform that does not have the store version",
    result.status !== 0 &&
      result.output.includes("1.4.8 is not available on iOS") &&
      read(CHANGELOG) === storeChangelog &&
      git("status", "--porcelain") === "",
    result.output,
  );

  result = ota("--platform", "android", "--date", "2026-11-12");
  const first = read(CHANGELOG);
  check(
    "writes the first OTA section above its store version",
    result.status === 0 &&
      JSON.stringify(headings()) ===
        JSON.stringify([
          "## [Unreleased]",
          "## [1.4.8.1] - 2026-11-12 (Android)",
          "## [1.4.8] - 2026-11-10 (Android)",
          "## [1.4.7] - 2026-11-06",
        ]) &&
      first.includes(
        "## [1.4.8.1] - 2026-11-12 (Android)\n\n### Added\n\n- A shortcut to the last chat.\n\n### Fixed\n\n" +
          "- The chat scrolls to the newest message again.\n- A second fix.\n\n## [1.4.8] - 2026-11-10 (Android)\n",
      ),
    { output: result.output, changelog: first },
  );
  check(
    "moves only the notes that are new since the store build",
    !existsSync(join(work, NOTES, "fix-scroll.md")) &&
      !existsSync(join(work, NOTES, "add-shortcut.md")) &&
      existsSync(join(work, NOTES, "native-camera.md")) &&
      existsSync(join(work, NOTES, "README.md")),
    git("status", "--porcelain"),
  );
  check("keeps the version files and the Discord highlights", versionFiles() === storeFiles, versionFiles());
  result = cli("check-release-notes.ts", ["--ota"]);
  check("the changelog check accepts the section", result.status === 0, result.output);
  commit("OTA 1.4.8.1");

  // The account Worker reads the same file for /changelog and /v1/mobile/changelog.
  const releases = parseChangelog(first, { anchorPrefix: "mobile-", stores: true });
  const [otaRelease, storeRelease] = releases;
  check(
    "the Worker parser reads the OTA section as a release of its platforms",
    otaRelease?.version === "1.4.8.1" &&
      otaRelease.date === "2026-11-12" &&
      JSON.stringify(otaRelease.stores) ===
        JSON.stringify([{ store: "android", date: "2026-11-12", skipped: false }]) &&
      otaRelease.groups.map((group) => `${group.type}:${group.items.length}`).join(",") === "added:1,fixed:2" &&
      otaRelease.anchor === "mobile-v1-4-8-1" &&
      storeRelease?.version === "1.4.8" &&
      storeRelease.stores.length === 2,
    releases.slice(0, 2),
  );
  check(
    "after= lists the OTA version for 1.4.8 and older, and not for 1.4.9",
    isNewerMobileVersion("1.4.8.1", "1.4.8") &&
      isNewerMobileVersion("1.4.8.1", "1.4.7") &&
      !isNewerMobileVersion("1.4.8.1", "1.4.8.1") &&
      !isNewerMobileVersion("1.4.8.1", "1.4.9") &&
      isNewerMobileVersion("1.4.9", "1.4.8.1"),
    "isNewerMobileVersion",
  );

  // The second update of the same store build gets the next number.
  write(`${NOTES}/fix-crash.md`, "### Fixed\n\n- The app does not stop when a file opens.\n");
  commit("Fix crash");
  result = ota("--platform", "android", "--date", "2026-11-13");
  check(
    "writes the second OTA section above the first one",
    result.status === 0 &&
      JSON.stringify(headings().slice(0, 4)) ===
        JSON.stringify([
          "## [Unreleased]",
          "## [1.4.8.2] - 2026-11-13 (Android)",
          "## [1.4.8.1] - 2026-11-12 (Android)",
          "## [1.4.8] - 2026-11-10 (Android)",
        ]) &&
      read(CHANGELOG).includes("## [1.4.8.2] - 2026-11-13 (Android)\n\n### Fixed\n\n- The app does not stop") &&
      !existsSync(join(work, NOTES, "fix-crash.md")) &&
      existsSync(join(work, NOTES, "native-camera.md")) &&
      versionFiles() === storeFiles,
    { output: result.output, headings: headings() },
  );
  commit("OTA 1.4.8.2");
  const withOta = read(CHANGELOG);

  // A malformed OTA section stops the check, on disk and in the index.
  const secondStart = withOta.indexOf("## [1.4.8.2]");
  const firstStart = withOta.indexOf("## [1.4.8.1]");
  const olderStart = withOta.indexOf("## [1.4.7]");
  const secondSection = withOta.slice(secondStart, firstStart);
  const malformed: Record<string, string> = {
    "in review": withOta.replace("## [1.4.8.2] - 2026-11-13 (Android)", "## [1.4.8.2] - In review"),
    "an impossible date": withOta.replace("## [1.4.8.2] - 2026-11-13 (Android)", "## [1.4.8.2] - 2026-13-45 (Android)"),
    "a store without the store version": withOta.replace(
      "## [1.4.8.2] - 2026-11-13 (Android)",
      "## [1.4.8.2] - 2026-11-13",
    ),
    "a skipped number": withOta.replace("## [1.4.8.2]", "## [1.4.8.3]"),
    "no items": withOta.replace("### Fixed\n\n- The app does not stop when a file opens.\n", ""),
    "below its store version": `${withOta.slice(0, secondStart)}${withOta.slice(firstStart, olderStart)}${secondSection}${withOta.slice(olderStart)}`,
  };
  for (const [name, text] of Object.entries(malformed)) {
    write(CHANGELOG, text);
    result = cli("check-release-notes.ts", ["--ota"]);
    check(
      `the changelog check rejects ${name}`,
      result.status === 1 && result.output.includes("1.4.8."),
      result.output,
    );
  }
  git("add", CHANGELOG);
  write(CHANGELOG, withOta);
  result = cli("check-release-notes.ts", ["--staged", "--ota"]);
  check("the staged check reads the index", result.status === 1, result.output);
  git("reset", "--quiet", "--hard");

  // The next store version comes from app.json, not from the newest heading.
  result = cli("prepare-release.ts", ["patch", "--mobile"]);
  check(
    "the next store version after 1.4.8.2 is 1.4.9",
    result.status === 0 &&
      JSON.stringify(headings().slice(0, 4)) ===
        JSON.stringify([
          "## [Unreleased]",
          "## [1.4.9] - In review",
          "## [1.4.8.2] - 2026-11-13 (Android)",
          "## [1.4.8.1] - 2026-11-12 (Android)",
        ]) &&
      read(CHANGELOG).includes("- A camera feature that needs new native code.") &&
      read("apps/mobile/app.json").includes('"version": "1.4.9"') &&
      read("bun.lock").includes('"version": "1.4.9"') &&
      !existsSync(join(work, NOTES, "native-camera.md")),
    { output: result.output, headings: headings() },
  );
  result = cli("check-release-notes.ts", ["--ota"]);
  check("the changelog check accepts OTA sections below a store version in review", result.status === 0, result.output);
  commit("Prepare 1.4.9");

  // The 1.4.8 build cannot get an update from a tree that is 1.4.9.
  write(`${NOTES}/fix-late.md`, "### Fixed\n\n- A late fix.\n");
  commit("Late fix");
  const prepared = read(CHANGELOG);
  result = ota("--platform", "android");
  check(
    "refuses a base of another store version",
    result.status !== 0 &&
      result.output.includes("store-1.4.8 is the mobile version 1.4.8") &&
      read(CHANGELOG) === prepared &&
      existsSync(join(work, NOTES, "fix-late.md")),
    result.output,
  );

  // A hotfix branch from the store build: the update of 1.4.8 goes below the 1.4.9 that is in review.
  git("switch", "--quiet", "-c", "hotfix", "store-1.4.8");
  git("checkout", "--quiet", "main", "--", CHANGELOG);
  write(`${NOTES}/fix-hot.md`, "### Fixed\n\n- A hot fix.\n");
  commit("Hot fix");
  result = ota("--platform", "android", "--date", "2026-11-14");
  check(
    "a hotfix branch writes below a later store version",
    result.status === 0 &&
      JSON.stringify(headings().slice(0, 5)) ===
        JSON.stringify([
          "## [Unreleased]",
          "## [1.4.9] - In review",
          "## [1.4.8.3] - 2026-11-14 (Android)",
          "## [1.4.8.2] - 2026-11-13 (Android)",
          "## [1.4.8.1] - 2026-11-12 (Android)",
        ]) &&
      existsSync(join(work, NOTES, "native-camera.md")) &&
      versionFiles() === storeFiles,
    { output: result.output, headings: headings() },
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

mkdirSync(dirname(REPORT), { recursive: true });
const passed = checks.every((entry) => entry.passed);
writeFileSync(REPORT, `${JSON.stringify({ passed, checks }, null, 2)}\n`);
for (const entry of checks) process.stdout.write(`${entry.passed ? "pass" : "FAIL"}  ${entry.name}\n`);
for (const entry of checks.filter((candidate) => !candidate.passed))
  process.stdout.write(`\n${entry.name}:\n${entry.detail}\n`);
process.stdout.write(`\nReport: ${REPORT}\n`);
process.exit(passed ? 0 : 1);
