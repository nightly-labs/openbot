import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const NAME = "hosted-update-durability-e2e";
const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, ".openbot-build", NAME);
const HOSTED_UPDATE = join(ROOT, "scripts", "hosting", "openbot-hosted-update");
const OLD_VERSION = "9.9.8";
const NEW_VERSION = "9.9.9";
const MEBIBYTE = 1024 * 1024;
const logger = createOpenBotLogger(NAME);

const HARNESS = `
source "$1"
INSTALL=$2
EVENTS=$3
SNAPSHOTS=$4
RESTORE=$5/restore
recover() { :; }
systemctl() { echo 0; }
install_hosting() { echo install_hosting >>"$EVENTS"; }
sync() {
  local snapshot
  [ -n "$SNAPSHOTS" ] || return 0
  snapshot="$SNAPSHOTS/$(find "$SNAPSHOTS" -mindepth 1 -maxdepth 1 | wc -l)"
  cp -a "$INSTALL" "$snapshot"
  echo "sync $* -> \${snapshot##*/}" >>"$EVENTS"
}
case $6 in
  apply) apply ;;
  boot) boot ;;
  stage) stage_release "$7" ;;
esac
`;

interface CrashRecovery {
  snapshot: string;
  markers: string[];
  recovered: boolean;
}

function writeRelease(directory: string, version: string): void {
  mkdirSync(join(directory, "resources"), { recursive: true });
  writeFileSync(join(directory, "openbot.desktop"), `[Desktop Entry]\nX-AppImage-Version=${version}\n`);
  writeFileSync(join(directory, "openbot"), Buffer.alloc(MEBIBYTE, version));
  writeFileSync(join(directory, "resources", "app.asar"), Buffer.alloc(MEBIBYTE, `asar-${version}`));
}

function runStep(
  step: "apply" | "boot" | "stage",
  install: string,
  work: string,
  snapshots: string,
  source = "",
): string[] {
  const events = join(work, `${step}-events`);
  writeFileSync(events, "");
  const result = spawnSync(
    "bash",
    ["-c", HARNESS, NAME, HOSTED_UPDATE, install, events, snapshots, work, step, source],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    },
  );
  assert.equal(result.status, 0, `The ${step} step failed: ${result.stderr}`);
  return readFileSync(events, "utf8").split("\n").filter(Boolean);
}

function sameTree(expected: string, actual: string): boolean {
  return spawnSync("diff", ["-rq", expected, actual]).status === 0;
}

function markersIn(install: string): string[] {
  return [".applying", "staged", "staged.ready"].filter((name) => existsSync(join(install, name)));
}

function recoverFromEachSnapshot(snapshots: string, expected: string, work: string): CrashRecovery[] {
  return readdirSync(snapshots)
    .sort((left, right) => Number(left) - Number(right))
    .map((snapshot) => {
      const install = join(snapshots, snapshot);
      const markers = markersIn(install);
      runStep("boot", install, work, "");
      return { snapshot, markers, recovered: sameTree(expected, join(install, "app")) };
    });
}

function applyScenario(directory: string) {
  const work = join(directory, "apply");
  const install = join(work, "install");
  const expected = join(work, "expected");
  const snapshots = join(work, "snapshots");
  mkdirSync(snapshots, { recursive: true });
  writeRelease(join(install, "app"), OLD_VERSION);
  writeRelease(join(install, "staged"), NEW_VERSION);
  writeFileSync(join(install, "staged.ready"), `${NEW_VERSION}\n`);
  writeRelease(expected, NEW_VERSION);

  const events = runStep("apply", install, work, snapshots);
  assert.deepEqual(
    events.map((event) => event.replace(/ -> \d+$/u, "").replaceAll(install, "$INSTALL")),
    ["sync -f $INSTALL", "sync -f $INSTALL/app", "install_hosting", "sync -f $INSTALL /etc", "sync -f $INSTALL"],
    "The update must write the marker, the new release and the hosting files to disk before it removes its markers, and the removal of the markers before it removes the staged release.",
  );
  assert.deepEqual(markersIn(install), [], "The update left a marker or the staged release.");
  assert.ok(sameTree(expected, join(install, "app")), "The new release is not complete.");

  const recoveries = recoverFromEachSnapshot(snapshots, expected, work);
  for (const recovery of recoveries) {
    assert.ok(
      recovery.recovered,
      `A stop after the write to disk ${recovery.snapshot} (markers: ${recovery.markers.join(", ") || "none"}) did not give the complete new release at the next start.`,
    );
  }
  assert.deepEqual(
    recoveries.at(-1)?.markers,
    ["staged"],
    "The removal of the markers was not on disk before the staged release was removed.",
  );
  return { events, recoveries };
}

function stageScenario(directory: string) {
  const work = join(directory, "stage");
  const install = join(work, "install");
  const source = join(work, "source");
  const snapshots = join(work, "snapshots");
  mkdirSync(install, { recursive: true });
  mkdirSync(snapshots, { recursive: true });
  writeRelease(source, NEW_VERSION);

  const events = runStep("stage", install, work, snapshots, source);
  assert.equal(events.length, 1, "Staging must write the staged release to disk once.");
  const durable = join(snapshots, "0");
  assert.ok(
    sameTree(source, join(durable, "staged")),
    "The staged release was not complete when it was written to disk.",
  );
  assert.ok(!existsSync(join(durable, "staged.ready")), "staged.ready existed before the staged release was on disk.");
  assert.equal(readFileSync(join(install, "staged.ready"), "utf8").trim(), NEW_VERSION);
  return { events };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), `${NAME}-`));
try {
  const apply = applyScenario(directory);
  const stage = stageScenario(directory);
  const report = { ok: true, checkedAt: new Date().toISOString(), apply, stage };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Passed. Report: ${join(OUT, "report.json")}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
