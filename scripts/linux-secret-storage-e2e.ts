// Runs the real Electron with the secret storage of `src/main/secret-storage-cipher.ts` and checks
// that a secret lives through a restart when the Linux keyring loses its key:
// 1. With no keyring, OpenBot makes its own 0600 key file, and the secret opens after a restart.
// 2. With a keyring that keeps its key, `safeStorage` keeps the secret and no key file is made.
// 3. When the next start has a new keyring (one that keeps its items only in memory, or a locked
//    one that Chromium replaces), the old secret does not open. OpenBot then makes the key file, and
//    a secret that it writes after that opens after the next restart with yet another keyring.
// 4. A hosted server (boat): an older release kept the secret in an unlocked login keyring, as
//    `scripts/hosting/openbot-hosted-server` starts it. The upgrade keeps the keyring and makes no key
//    file. One start without the keyring (a direct launch) makes the key file; after it, the secret of
//    the keyring still opens, and new secrets use the key file.
// No start makes the key file before `ready`, when `safeStorage` has no key yet.
// Cases 2, 3 and 4 need `dbus-run-session` and `gnome-keyring-daemon`; without them the report marks
// them as skipped.
//
// Run on Linux with a display (xvfb-run): bun scripts/linux-secret-storage-e2e.ts
// `ELECTRON_OVERRIDE_DIST_PATH`, as the `electron` package reads it, names another Electron folder.
// It writes .openbot-build/linux-secret-storage-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "linux-secret-storage-e2e");
const READY_TIMEOUT_MS = 30_000;
const electronPath = process.env.ELECTRON_OVERRIDE_DIST_PATH
  ? join(process.env.ELECTRON_OVERRIDE_DIST_PATH, "electron")
  : join(
      ROOT,
      "node_modules",
      "electron",
      "dist",
      readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
    );
// A login keyring that the daemon unlocks with no person, as `scripts/hosting/openbot-hosted-server`
// makes it. `$1` is the keyring folder; the rest is the Electron command.
const KEYRING_SESSION = [
  'export XDG_DATA_HOME="$1"; shift',
  'mkdir -p "$XDG_DATA_HOME/keyrings"',
  'printf login >"$XDG_DATA_HOME/keyrings/default"',
  // The `--unlock` output names the control folder; without it, `--start` starts a second daemon
  // that asks for a password.
  'eval "$(printf e2e-keyring | gnome-keyring-daemon --unlock --components=secrets)"',
  // The daemon writes a new login keyring in the background. A `--start` before the write ends can
  // start a second daemon, and that one asks for a password.
  'tries=0; while [ ! -e "$XDG_DATA_HOME/keyrings/login.keyring" ] && [ "$tries" -lt 200 ]; do sleep 0.05; tries=$((tries + 1)); done',
  'eval "$(gnome-keyring-daemon --start --components=secrets)"',
  "unset XDG_DATA_HOME",
  "export GNOME_KEYRING_CONTROL",
  'exec "$@"',
].join("\n");

if (process.platform !== "linux") {
  process.stdout.write("SKIP: Linux only\n");
  process.exit(0);
}

interface Step {
  name: string;
  step: "write" | "read" | "legacy-write";
  value?: string;
  /** The keyring folder of this start. None: no session bus, so no keyring. */
  keyring?: string;
  /** Electron switches, such as the `--password-store` of a hosted server. */
  switches?: string[];
}

interface StepResult extends Step {
  backend?: string;
  keyringAvailable?: boolean;
  canPersistBeforeReady?: boolean;
  keyFileBeforeReady?: boolean;
  canPersist?: boolean;
  format?: string;
  readValue?: string;
  error?: string;
  madeKeyFile?: boolean;
  keyFileMode?: string | null;
}

const hasKeyring =
  spawnSync("sh", ["-c", "command -v dbus-run-session && command -v gnome-keyring-daemon"]).status === 0;

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-linux-secret-storage-"));
const bundle = join(root, "linux-secret-storage-electron.mjs");
const results: Record<string, StepResult[]> = {};
const skipped: string[] = [];
let passed = false;
let error: string | undefined;
let launches = 0;

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "linux-secret-storage-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  // 1. No keyring.
  {
    const steps = await runCase("no keyring", [
      { name: "first start writes", step: "write", value: "secret-without-keyring" },
      { name: "restart reads", step: "read" },
    ]);
    const [write, read] = steps;
    assert.equal(write?.keyringAvailable, false, "no keyring: safeStorage has no key");
    assert.equal(write?.canPersistBeforeReady, false, "before ready: nothing can encrypt yet");
    assert.equal(write?.keyFileBeforeReady, false, "before ready: no key file is made");
    assert.equal(write?.canPersist, true, "no keyring: the secret can be kept");
    assert.equal(write?.format, "obk1", "no keyring: the key file encrypts");
    assert.equal(write?.keyFileMode, "600", "no keyring: only the user reads the key file");
    assert.equal(read?.readValue, "secret-without-keyring", "no keyring: the secret opens after a restart");
    assert.equal(read?.madeKeyFile, false, "no keyring: a restart uses the same key file");
  }

  if (hasKeyring) {
    // 2 and 3. One userData folder; the keyring is the same, then new at each start.
    const steps = await runCase("keyring, then a new keyring at each start", [
      { name: "first start writes", step: "write", value: "secret-in-keyring", keyring: "keyring-1" },
      { name: "restart with the same keyring reads", step: "read", keyring: "keyring-1" },
      { name: "restart with a new keyring reads", step: "read", keyring: "keyring-2" },
      { name: "sign in again writes", step: "write", value: "secret-after-reset", keyring: "keyring-2" },
      { name: "restart with another new keyring reads", step: "read", keyring: "keyring-3" },
    ]);
    const [write, sameKeyring, newKeyring, rewrite, anotherKeyring] = steps;
    assert.equal(write?.keyringAvailable, true, "keyring: safeStorage has a key");
    assert.equal(write?.format, "v11", "keyring: safeStorage encrypts");
    assert.equal(write?.keyFileMode, null, "keyring: no key file");
    assert.equal(sameKeyring?.readValue, "secret-in-keyring", "keyring: the secret opens after a restart");
    assert.equal(sameKeyring?.keyFileMode, null, "keyring: still no key file");
    assert.equal(newKeyring?.readValue, undefined, "new keyring: the old secret does not open");
    assert.ok(newKeyring?.error, "new keyring: the read fails");
    assert.equal(newKeyring?.madeKeyFile, true, "new keyring: the key file is made");
    assert.equal(newKeyring?.keyFileMode, "600", "new keyring: only the user reads the key file");
    assert.equal(rewrite?.format, "obk1", "after the reset: the key file encrypts");
    assert.equal(anotherKeyring?.readValue, "secret-after-reset", "after the reset: the secret opens after a restart");
    // The sign-in screen tells of a keyring change only on the start that made the key file.
    assert.equal(anotherKeyring?.madeKeyFile, false, "after the reset: the key file is not made again");

    // 4. A hosted server: its keyring stays from start to start.
    const hosted = { keyring: "hosted-keyring", switches: ["--password-store=gnome-libsecret"] };
    const server = await runCase("hosted server: upgrade, then one start without the keyring", [
      { name: "an older release writes", step: "legacy-write", value: "hosted-session", ...hosted },
      { name: "the upgrade reads", step: "read", ...hosted },
      { name: "the next restart reads", step: "read", ...hosted },
      { name: "a direct launch with no keyring reads", step: "read", switches: hosted.switches },
      { name: "the service start after it reads", step: "read", ...hosted },
      { name: "the service writes", step: "write", value: "hosted-new-secret", ...hosted },
      { name: "the next restart reads the new secret", step: "read", ...hosted },
    ]);
    const [legacy, upgrade, restart, direct, service, serviceWrite, serviceRead] = server;
    assert.equal(legacy?.format, "v11", "hosted: the older release used the keyring");
    assert.equal(legacy?.keyFileBeforeReady, false, "hosted: no key file before ready");
    assert.equal(upgrade?.readValue, "hosted-session", "hosted: the upgrade opens the secret");
    assert.equal(upgrade?.keyFileMode, null, "hosted: the upgrade makes no key file");
    assert.equal(restart?.readValue, "hosted-session", "hosted: the secret opens after a restart");
    assert.equal(restart?.keyFileMode, null, "hosted: still no key file");
    assert.ok(direct?.error, "hosted: a start with no keyring cannot open the secret");
    assert.equal(direct?.madeKeyFile, true, "hosted: a start with no keyring makes the key file");
    assert.equal(service?.readValue, "hosted-session", "hosted: the keyring secret still opens after it");
    assert.equal(service?.madeKeyFile, false, "hosted: the service start makes no key file");
    assert.equal(serviceWrite?.format, "obk1", "hosted: new secrets use the key file");
    assert.equal(serviceRead?.readValue, "hosted-new-secret", "hosted: the new secret opens after a restart");
  } else {
    skipped.push("keyring cases: dbus-run-session or gnome-keyring-daemon is missing");
  }
  passed = true;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, error, skipped, results }, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(passed ? `PASS: report in ${join(OUT, "report.json")}\n` : `FAIL: ${error}\n`);
process.exit(passed ? 0 : 1);

async function runCase(name: string, steps: Step[]): Promise<StepResult[]> {
  const userData = join(root, `user-data-${Object.keys(results).length}`);
  const blob = join(root, `blob-${Object.keys(results).length}.bin`);
  const done: StepResult[] = [];
  results[name] = done;
  for (const step of steps) done.push(await launch(step, userData, blob));
  return done;
}

async function launch(step: Step, userData: string, blob: string): Promise<StepResult> {
  const index = launches++;
  const base = withoutElectronRuntimeFlags(process.env);
  // No session bus unless the step has a keyring: the test must not reach a keyring of the computer
  // that runs it. An unset address is not enough, because GLib then finds $XDG_RUNTIME_DIR/bus.
  base.DBUS_SESSION_BUS_ADDRESS = "unix:path=/nonexistent/openbot-e2e-bus";
  delete base.GNOME_KEYRING_CONTROL;
  base.XDG_CURRENT_DESKTOP = "XFCE";
  const readyFile = join(root, `ready-${index}.json`);
  const electronArguments = [
    bundle,
    `--user-data=${userData}`,
    `--ready-file=${readyFile}`,
    `--blob=${blob}`,
    `--step=${step.step}`,
    ...(step.switches ?? []),
    ...(step.value ? [`--value=${step.value}`] : []),
  ];
  const log = openSync(join(OUT, `electron-${index}.log`), "w");
  const child = step.keyring
    ? spawn(
        "dbus-run-session",
        [
          "--",
          "sh",
          "-c",
          KEYRING_SESSION,
          "keyring-session",
          join(root, step.keyring),
          electronPath,
          ...electronArguments,
        ],
        { env: { ...base, DBUS_SESSION_BUS_ADDRESS: "" }, stdio: ["ignore", log, log] },
      )
    : spawn(electronPath, electronArguments, { env: base, stdio: ["ignore", log, log] });
  closeSync(log);
  // The step writes the ready file and then quits, so the exit is the signal.
  const exited = new Promise<void>((done, fail) => {
    child.once("error", fail);
    child.once("exit", () => done());
  });
  const timeout = new AbortController();
  const timedOut = sleep(READY_TIMEOUT_MS, "timeout", { signal: timeout.signal }).catch(() => "aborted");
  try {
    if ((await Promise.race([exited, timedOut])) === "timeout") {
      child.kill("SIGKILL");
      throw new Error(`${step.name}: Electron did not stop`);
    }
  } finally {
    timeout.abort();
  }
  if (!existsSync(readyFile)) throw new Error(`${step.name}: Electron stopped with no ready file`);
  const ready = JSON.parse(readFileSync(readyFile, "utf8"));
  if (!isDynamicRecord(ready) || typeof ready.backend !== "string" || typeof ready.madeKeyFile !== "boolean")
    throw new Error(`${step.name}: the ready file is not valid`);
  return {
    ...step,
    backend: ready.backend,
    keyringAvailable: ready.keyringAvailable === true,
    canPersistBeforeReady: ready.canPersistBeforeReady === true,
    keyFileBeforeReady: ready.keyFileBeforeReady === true,
    ...(typeof ready.canPersist === "boolean" ? { canPersist: ready.canPersist } : {}),
    ...(typeof ready.format === "string" ? { format: ready.format } : {}),
    ...(typeof ready.value === "string" ? { readValue: ready.value } : {}),
    ...(typeof ready.error === "string" ? { error: ready.error } : {}),
    madeKeyFile: ready.madeKeyFile,
    keyFileMode: typeof ready.keyFileMode === "string" ? ready.keyFileMode : null,
  };
}
