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
const KEYRING_SESSION = [
  'export XDG_DATA_HOME="$1"; shift',
  'mkdir -p "$XDG_DATA_HOME/keyrings"',
  'printf login >"$XDG_DATA_HOME/keyrings/default"',
  'eval "$(printf e2e-keyring | gnome-keyring-daemon --unlock --components=secrets)"',
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
  keyring?: string;
  switches?: string[];
  platform?: "darwin" | "win32";
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

  {
    const steps = await runCase("macOS rules: no keyring", [
      { name: "first start writes", step: "write", value: "secret-without-keychain", platform: "darwin" },
      { name: "restart reads", step: "read", platform: "darwin" },
    ]);
    const [write, read] = steps;
    assert.equal(write?.keyringAvailable, false, "macOS, no Keychain: safeStorage has no key");
    assert.equal(write?.keyFileBeforeReady, false, "macOS, before ready: no key file is made");
    assert.equal(write?.canPersist, true, "macOS, no Keychain: the secret can be kept");
    assert.equal(write?.format, "obk1", "macOS, no Keychain: the key file encrypts");
    assert.equal(write?.keyFileMode, "600", "macOS, no Keychain: only the user reads the key file");
    assert.equal(read?.readValue, "secret-without-keychain", "macOS, no Keychain: the secret opens after a restart");
  }

  {
    const steps = await runCase("Windows rules: no secret storage", [
      { name: "first start writes", step: "write", value: "secret-without-dpapi", platform: "win32" },
      { name: "restart reads", step: "read", platform: "win32" },
    ]);
    const [write, read] = steps;
    assert.equal(write?.keyringAvailable, false, "Windows, no secret storage: safeStorage has no key");
    assert.equal(write?.keyFileBeforeReady, false, "Windows, before ready: no key file is made");
    assert.equal(write?.canPersist, true, "Windows, no secret storage: the secret can be kept");
    assert.equal(write?.format, "obk1", "Windows, no secret storage: the key file encrypts");
    assert.equal(write?.madeKeyFile, true, "Windows, no secret storage: the key file is made");
    assert.equal(
      read?.readValue,
      "secret-without-dpapi",
      "Windows, no secret storage: the secret opens after a restart",
    );
    assert.equal(read?.madeKeyFile, false, "Windows, no secret storage: a restart uses the same key file");
  }

  if (hasKeyring) {
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
    assert.equal(anotherKeyring?.madeKeyFile, false, "after the reset: the key file is not made again");

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

    const mac = await runCase("macOS rules: a secret that does not open", [
      { name: "first start writes", step: "write", value: "secret-in-keychain", keyring: "mac-1", platform: "darwin" },
      { name: "restart with another key reads", step: "read", keyring: "mac-2", platform: "darwin" },
    ]);
    const [macWrite, macRead] = mac;
    assert.equal(macWrite?.format, "v11", "macOS: a Keychain that works encrypts");
    assert.ok(macRead?.error, "macOS: the secret with another key does not open");
    assert.equal(macRead?.madeKeyFile, false, "macOS: a failed read makes no key file");
    assert.equal(macRead?.keyFileMode, null, "macOS: still no key file");

    const macBack = await runCase("macOS rules: the Keychain works again", [
      { name: "a start with no Keychain writes", step: "write", value: "secret-in-file", platform: "darwin" },
      {
        name: "the next start writes",
        step: "write",
        value: "secret-in-keychain",
        keyring: "mac-3",
        platform: "darwin",
      },
      { name: "restart reads", step: "read", keyring: "mac-3", platform: "darwin" },
    ]);
    const windows = await runCase("Windows rules: the secret storage works again", [
      { name: "a start with no secret storage writes", step: "write", value: "secret-in-file", platform: "win32" },
      { name: "the next start reads", step: "read", keyring: "win-1", platform: "win32" },
      { name: "the next start writes", step: "write", value: "secret-in-dpapi", keyring: "win-1", platform: "win32" },
      { name: "restart reads", step: "read", keyring: "win-1", platform: "win32" },
      { name: "a read with another key", step: "read", keyring: "win-2", platform: "win32" },
    ]);
    const [winRefused, winFileRead, winWorksAgain, winReadAgain, winOtherKey] = windows;
    assert.equal(winRefused?.format, "obk1", "Windows, no secret storage: the key file encrypts");
    assert.equal(winFileRead?.readValue, "secret-in-file", "Windows: a key file secret opens when the storage works");
    assert.equal(winWorksAgain?.format, "v11", "Windows: a secret storage that works again encrypts new secrets");
    assert.equal(winReadAgain?.readValue, "secret-in-dpapi", "Windows: the system secret opens after a restart");
    assert.ok(winOtherKey?.error, "Windows: the secret with another key does not open");
    assert.equal(winOtherKey?.madeKeyFile, false, "Windows: a failed read makes no new key file");

    const [refused, worksAgain, readAgain] = macBack;
    assert.equal(refused?.format, "obk1", "macOS, no Keychain: the key file encrypts");
    assert.equal(worksAgain?.format, "v11", "macOS: a Keychain that works again encrypts new secrets");
    assert.equal(readAgain?.readValue, "secret-in-keychain", "macOS: the Keychain secret opens after a restart");
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
    ...(step.platform ? [`--platform=${step.platform}`] : []),
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
