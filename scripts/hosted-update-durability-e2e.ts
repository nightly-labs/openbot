import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NAME = "hosted-update-durability-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const HOSTED_UPDATE = join(ROOT, "scripts", "hosting", "openbot-hosted-update");
const CURRENT_VERSION = "9.9.8";
const NEW_VERSION = "9.9.9";
const MEBIBYTE = 1024 * 1024;

const HARNESS = [
  'source "$1"',
  'INSTALL="$2"',
  'EVENTS="$3"',
  'SOURCE="$4"',
  'MODE="$5"',
  'flag() { [ -e "$1" ] && echo 1 || echo 0; }',
  "copy_state() {",
  '  if [ "$MODE" = apply ]; then diff -rq "$INSTALL/staged" "$INSTALL/app" >/dev/null 2>&1',
  '  else diff -rq "$SOURCE" "$INSTALL/staged" >/dev/null 2>&1',
  "  fi && echo complete || echo partial",
  "}",
  "recover() { :; }",
  'install_hosting() { echo install_hosting >>"$EVENTS"; }',
  'sync() { echo "sync applying=$(flag "$INSTALL/.applying") ready=$(flag "$INSTALL/staged.ready") copy=$(copy_state)" >>"$EVENTS"; }',
  'if [ "$MODE" = apply ]; then apply; else stage_release "$SOURCE"; fi',
].join("\n");

function writeRelease(directory: string, version: string): void {
  mkdirSync(join(directory, "resources"), { recursive: true });
  writeFileSync(join(directory, "openbot.desktop"), `[Desktop Entry]\nX-AppImage-Version=${version}\n`);
  writeFileSync(join(directory, "openbot"), Buffer.alloc(MEBIBYTE, version));
  writeFileSync(join(directory, "resources", "app.asar"), Buffer.alloc(MEBIBYTE, `asar-${version}`));
}

function run(mode: "apply" | "stage", install: string, source: string, events: string): string[] {
  const result = spawnSync("bash", ["-c", HARNESS, NAME, HOSTED_UPDATE, install, events, source, mode], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(result.status, 0, `The ${mode} step failed: ${result.stderr}`);
  return readFileSync(events, "utf8").split("\n").filter(Boolean);
}

function applyScenario(directory: string): string[] {
  const install = join(directory, "apply", "install");
  const events = join(directory, "apply", "events");
  const expected = join(directory, "apply", "expected");
  writeRelease(join(install, "app"), CURRENT_VERSION);
  writeRelease(join(install, "staged"), NEW_VERSION);
  writeFileSync(join(install, "staged.ready"), `${NEW_VERSION}\n`);
  cpSync(join(install, "staged"), expected, { recursive: true });
  writeFileSync(events, "");
  const log = run("apply", install, "", events);
  const copyDone = "applying=1 ready=1 copy=complete";
  assert.deepEqual(
    log,
    [`sync ${copyDone}`, "install_hosting", `sync ${copyDone}`],
    "The update must write the new release to disk twice: after the copy, and after the hosting files, both before it removes the staged release.",
  );
  for (const leftover of [".applying", "staged", "staged.ready"]) {
    assert.ok(!existsSync(join(install, leftover)), `${leftover} stayed after the update.`);
  }
  assert.equal(
    spawnSync("diff", ["-rq", expected, join(install, "app")]).status,
    0,
    "The new release is not complete.",
  );
  return log;
}

function stageScenario(directory: string): string[] {
  const install = join(directory, "stage", "install");
  const source = join(directory, "stage", "source");
  const events = join(directory, "stage", "events");
  mkdirSync(install, { recursive: true });
  writeRelease(source, NEW_VERSION);
  writeFileSync(events, "");
  const log = run("stage", install, source, events);
  assert.deepEqual(
    log,
    ["sync applying=0 ready=0 copy=complete"],
    "The staged release must be on disk before staged.ready exists.",
  );
  assert.equal(readFileSync(join(install, "staged.ready"), "utf8").trim(), NEW_VERSION);
  return log;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), `${NAME}-`));
try {
  const apply = applyScenario(directory);
  const stage = stageScenario(directory);
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), apply, stage }, null, 2)}\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
