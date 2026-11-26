import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

const NAME = "hosted-keyring-guard-e2e";
const ROOT = resolve(import.meta.dirname, "../..");
const HOSTING = join(ROOT, "scripts", "hosting");
const OUT = join(ROOT, ".openbot-build", NAME);
const SERVICE_USER = "openbot";
const SERVICE_HOME = "/var/lib/openbot";
const APP_NAME = "openbot-keyring-e2e";
const RUNS = `${SERVICE_HOME}/.config/${APP_NAME}/runs.jsonl`;
const KEYRING = "/srv/openbot-hosted/keyrings/login.keyring";
const PASSWORD = `${SERVICE_HOME}/.config/openbot-hosted/keyring-password`;
const BACKUP = "/srv/openbot-keyring";
const GUARD = "/opt/OpenBot/hosted/openbot-hosted-keyring";
const RESTORED = "Restored the copy from";
const DEADLINE_MS = 120_000;
const POLL_MS = 250;
const SAFE_STORAGE_SCHEMA = "chrome_libsecret_os_crypt_password_v2";
const logger = createOpenBotLogger(NAME);

const release = optionValue("--release") ?? "24.04";
const keep = process.argv.includes("--keep");
assert.match(release, /^\d{2}\.\d{2}$/u, "--release must be an Ubuntu release such as 24.04.");
const electronVersion = electronVersionOf(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
const image = `openbot-${NAME}:ubuntu-${release}-electron-${electronVersion}`;
const container = `openbot-${NAME}-${process.pid}`;

const PACKAGES = [
  "systemd",
  "systemd-sysv",
  "dbus",
  "dbus-x11",
  "gnome-keyring",
  "libsecret-1-0",
  "libsecret-tools",
  "xvfb",
  "xauth",
  "x11-utils",
  "x11-xserver-utils",
  "procps",
  "ca-certificates",
  "curl",
  "unzip",
  "libasound2t64",
  "libgbm1",
  "libgtk-3-0t64",
  "libnss3",
  "libxss1",
  "libxtst6",
];

const STUB_MAIN = `const { app, safeStorage } = require("electron");
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const SESSION = "hosted-keyring-guard-e2e-session";
app.whenReady().then(() => {
  const folder = app.getPath("userData");
  mkdirSync(folder, { recursive: true });
  const session = join(folder, "session.bin");
  const entry = {
    at: Date.now(),
    backend: safeStorage.getSelectedStorageBackend(),
    available: safeStorage.isEncryptionAvailable(),
  };
  if (existsSync(session)) {
    entry.action = "read";
    try {
      entry.opened = safeStorage.decryptString(readFileSync(session)) === SESSION;
    } catch (error) {
      entry.opened = false;
      entry.error = String(error && error.message);
    }
  } else {
    writeFileSync(session, safeStorage.encryptString(SESSION));
    entry.action = "write";
  }
  appendFileSync(join(folder, "runs.jsonl"), JSON.stringify(entry) + "\\n");
});
`;

const SETUP = `set -euo pipefail
useradd --system --create-home --home-dir ${SERVICE_HOME} --shell /bin/bash ${SERVICE_USER}
install -d -m 0755 /opt/OpenBot/hosted /opt/OpenBot/app
cp -a /opt/electron/. /opt/OpenBot/app/
mv /opt/OpenBot/app/electron /opt/OpenBot/app/openbot
chown root:root /opt/OpenBot/app/chrome-sandbox
chmod 4755 /opt/OpenBot/app/chrome-sandbox
install -d -m 0755 /opt/OpenBot/app/resources/app
cp /e2e/stub/package.json /e2e/stub/main.js /opt/OpenBot/app/resources/app/
cp -a /e2e/hosting /opt/OpenBot/app/resources/hosting
printf '%s\\n' ${SERVICE_USER} >/opt/OpenBot/hosted/service-user
printf '%s\\n' self >/opt/OpenBot/hosted/mode
install -m 0755 /e2e/hosting/openbot-hosted-server /opt/OpenBot/hosted/openbot-hosted-server
install -m 0755 /e2e/hosting/openbot-hosted-update /opt/OpenBot/hosted/openbot-hosted-update
sed 's/@SERVICE_USER@/${SERVICE_USER}/g' /e2e/hosting/openbot.service >/etc/systemd/system/openbot.service
install -d -o ${SERVICE_USER} -g ${SERVICE_USER} -m 0700 /srv/openbot-hosted
systemctl daemon-reload
`;

const AS_SERVICE_USER = (script: string) =>
  `runuser -u ${SERVICE_USER} -- env HOME=${SERVICE_HOME} bash -euo pipefail -c ${quote(script)}`;

const SERVICE_BUS = `bus=
for pid in $(pgrep -u ${SERVICE_USER} -x gnome-keyring-d); do
  bus=$(tr '\\0' '\\n' <"/proc/$pid/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p')
  [ -z "$bus" ] || break
done
[ -n "$bus" ]
`;

interface Run {
  at: number;
  backend: string;
  available: boolean;
  action: "write" | "read";
  opened?: boolean;
  error?: string;
}

interface CaseNotes {
  modes?: string;
  items?: number;
  error?: string | undefined;
  guardInstalledByTrigger?: boolean;
  hourlyCheckKeptCopy?: boolean;
  copyRefreshed?: boolean;
}

interface CaseReport {
  name: string;
  run: Run;
  restored: boolean;
  backupChanged: boolean;
  guardLog: string[];
  notes: CaseNotes;
}

const cases: CaseReport[] = [];
let passed = false;
let failure: string | undefined;
let journal = "";
let lastDigest = "";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  buildImage();
  startContainer();
  await runCases();
  passed = true;
} catch (caught) {
  failure = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
} finally {
  journal = tryInside("journalctl -u openbot.service -o short-iso --no-pager") ?? "";
  writeFileSync(join(OUT, "journal.txt"), journal);
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, failure, release, electronVersion, image, cases }, null, 2)}\n`,
  );
  if (!keep) spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}
if (passed) {
  logger.info(`The hosted keyring guard E2E test passed on Ubuntu ${release}. Report: ${join(OUT, "report.json")}`);
} else {
  logger.error(`The hosted keyring guard E2E test failed on Ubuntu ${release}: ${failure}`);
}
process.exit(passed ? 0 : 1);

async function runCases(): Promise<void> {
  const first = await startAndRead(() => inside("systemctl start openbot.service"));
  assert.equal(first.run.action, "write", "first start: the app saves its session");
  assert.equal(first.run.backend, "gnome_libsecret", "first start: safeStorage uses the keyring");
  assert.equal(inside(`test -x ${GUARD} && echo installed`).trim(), "installed", "trigger installs the new guard");
  assert.equal(inside(`test -e ${BACKUP} && echo yes || echo no`).trim(), "no", "no copy before the keyring exists");
  await waitForKeyringWrite(first.run.at);
  record("first start", first, { guardInstalledByTrigger: true });

  inside("touch /run/openbot-update.staged && /opt/OpenBot/hosted/openbot-hosted-update check");
  const saved = backupState();
  assert.equal(saved.modes, "root:root 700|root:root 600|root:root 600", "the copy is only for root");
  assert.equal(saved.items.length, 1, "the copy has the safeStorage key");
  cases.push({
    name: "hourly check saves the copy",
    run: first.run,
    restored: false,
    backupChanged: true,
    guardLog: [],
    notes: { modes: saved.modes, items: saved.items.length },
  });

  const unchanged = await restartAndRead();
  assert.equal(unchanged.run.opened, true, "restart: the session opens");
  assert.equal(unchanged.restored, false, "restart: nothing is restored");
  assert.equal(backupState().digest, saved.digest, "restart: the copy stays");
  record("restart with no change", unchanged);

  inside(`chmod 0644 ${GUARD}`);
  damageLikeTheIncident();
  const control = await restartAndRead();
  assert.equal(control.run.opened, false, "control: without the guard, the incident loses the session");
  record("control: the incident without the guard", control, { error: control.run.error });
  inside(`chmod 0755 ${GUARD}`);
  const recovered = await restartAndRead();
  assert.equal(recovered.restored, true, "incident: the guard restores the keyring");
  assert.equal(recovered.run.opened, true, "incident: the session opens again");
  assert.equal(inside(`test -f ${BACKUP}/replaced/login.keyring && echo kept`).trim(), "kept", "replaced file kept");
  record("incident with the guard after the control", recovered);

  damageLikeTheIncident();
  record("incident", await expectRestored("incident"));

  inside(AS_SERVICE_USER(`head -c 32 /dev/urandom | base64 >${PASSWORD}`));
  record("the password file changed", await expectRestored("the password file changed"));

  inside(AS_SERVICE_USER(`rm -f ${PASSWORD}`));
  record("the password file is removed", await expectRestored("the password file is removed"));

  inside(AS_SERVICE_USER(`head -c 4096 /dev/urandom >${KEYRING}`));
  record("damaged keyring file", await expectRestored("damaged keyring file"));

  const beforeDelete = backupState();
  const deletedAt = Date.now();
  inside(`${SERVICE_BUS}
items=$(runuser -u ${SERVICE_USER} -- env DBUS_SESSION_BUS_ADDRESS="$bus" dbus-send --session --print-reply=literal \\
  --dest=org.freedesktop.secrets /org/freedesktop/secrets/collection/login \\
  org.freedesktop.Secret.Collection.SearchItems dict:string:string:xdg:schema,${SAFE_STORAGE_SCHEMA})
for item in $(grep -o '/org/freedesktop/secrets/collection/login/[A-Za-z0-9_]*' <<<"$items"); do
  runuser -u ${SERVICE_USER} -- env DBUS_SESSION_BUS_ADDRESS="$bus" dbus-send --session --print-reply \\
    --dest=org.freedesktop.secrets "$item" org.freedesktop.Secret.Item.Delete >/dev/null
done`);
  await waitForKeyringWrite(deletedAt);
  const hourly = inside(`touch /run/openbot-update.staged && /opt/OpenBot/hosted/openbot-hosted-update check 2>&1`);
  assert.match(hourly, /restored at the next start/u, "deleted item: the hourly check reports it");
  assert.equal(backupState().digest, beforeDelete.digest, "deleted item: the hourly check keeps the copy");
  record("deleted item over D-Bus", await expectRestored("deleted item"), { hourlyCheckKeptCopy: true });

  const beforeAdd = backupState();
  const addedAt = Date.now();
  inside(`${SERVICE_BUS}
printf other-secret | runuser -u ${SERVICE_USER} -- env DBUS_SESSION_BUS_ADDRESS="$bus" \\
  secret-tool store --label=Other service openbot-keyring-e2e`);
  await waitForKeyringWrite(addedAt);
  inside("touch /run/openbot-update.staged && /opt/OpenBot/hosted/openbot-hosted-update check");
  const afterAdd = backupState();
  assert.notEqual(afterAdd.digest, beforeAdd.digest, "added item: the hourly check refreshes the copy");
  assert.equal(afterAdd.items.length, 1, "added item: the copy still has the safeStorage key");
  const added = await restartAndRead();
  assert.equal(added.run.opened, true, "added item: the session opens");
  assert.equal(added.restored, false, "added item: nothing is restored");
  const kept = inside(
    `${SERVICE_BUS}\nrunuser -u ${SERVICE_USER} -- env DBUS_SESSION_BUS_ADDRESS="$bus" secret-tool lookup service openbot-keyring-e2e`,
  );
  assert.equal(kept, "other-secret", "added item: the other program keeps its secret");
  record("another program adds an item", added, { copyRefreshed: true });
}

function damageLikeTheIncident(): void {
  inside(
    AS_SERVICE_USER(`pkill -u ${SERVICE_USER} -x gnome-keyring-d || true
rm -f /run/openbot/keyring/control
XDG_DATA_HOME=/srv/openbot-hosted dbus-run-session -- bash -c 'printf agent-password | gnome-keyring-daemon --unlock --components=secrets >/dev/null; gnome-keyring-daemon --start --components=secrets >/dev/null'
rm -f ${KEYRING}`),
  );
}

async function expectRestored(name: string): Promise<{ run: Run; restored: boolean; guardLog: string[] }> {
  const result = await restartAndRead();
  assert.equal(result.restored, true, `${name}: the guard restores the keyring`);
  assert.equal(result.run.opened, true, `${name}: the session opens`);
  assert.equal(
    inside(`stat -c '%U %a' ${KEYRING} ${PASSWORD} | sort -u`).trim(),
    `${SERVICE_USER} 600`,
    `${name}: the restored files belong to the service user`,
  );
  return result;
}

function record(
  name: string,
  result: { run: Run; restored: boolean; guardLog: string[] },
  notes: CaseNotes = {},
): void {
  const previous = cases.at(-1);
  cases.push({
    name,
    run: result.run,
    restored: result.restored,
    backupChanged: previous === undefined ? false : backupState().digest !== lastDigest,
    guardLog: result.guardLog,
    notes,
  });
  lastDigest = backupState().digest;
  logger.info(`${name}: opened=${String(result.run.opened)} restored=${String(result.restored)}`);
}

async function restartAndRead() {
  return startAndRead(() => inside("systemctl reset-failed openbot.service && systemctl restart openbot.service"));
}

async function startAndRead(start: () => void): Promise<{ run: Run; restored: boolean; guardLog: string[] }> {
  const before = runs().length;
  const lines = journalLines().length;
  start();
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const all = runs();
    const run = all[before];
    if (run) {
      const guardLog = journalLines()
        .slice(lines)
        .filter((line) => line.includes("keyring"));
      return { run, restored: guardLog.some((line) => line.includes(RESTORED)), guardLog };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `OpenBot did not start in ${DEADLINE_MS} ms. Journal:\n${journalLines().slice(lines).join("\n")}`,
      );
    }
    await delay(POLL_MS);
  }
}

async function waitForKeyringWrite(since: number): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const modified = Number(tryInside(`stat -c %.3Y ${KEYRING}`)?.trim());
    if (Number.isFinite(modified) && modified * 1000 >= since - 1000) return;
    if (Date.now() > deadline) throw new Error("gnome-keyring did not write the keyring file.");
    await delay(POLL_MS);
  }
}

function backupState(): { digest: string; modes: string; items: string[] } {
  if (inside(`test -f ${BACKUP}/login.keyring && echo yes || echo no`).trim() !== "yes") {
    return { digest: "", modes: "", items: [] };
  }
  const digest = inside(`cat ${BACKUP}/keyring-password ${BACKUP}/login.keyring | sha256sum | cut -c1-64`).trim();
  const modes = inside(
    `stat -c '%U:%G %a' ${BACKUP} ${BACKUP}/keyring-password ${BACKUP}/login.keyring | paste -sd'|'`,
  ).trim();
  const items = inside(`home=$(mktemp -d)
cp ${BACKUP}/keyring-password ${BACKUP}/login.keyring "$home/"
mkdir -p "$home/data/keyrings" "$home/run"
cp "$home/login.keyring" "$home/data/keyrings/"
printf login >"$home/data/keyrings/default"
chown -R nobody "$home"
runuser -u nobody -- env -i HOME="$home" XDG_DATA_HOME="$home/data" XDG_RUNTIME_DIR="$home/run" PATH=/usr/bin:/bin \\
  dbus-run-session -- bash -c 'gnome-keyring-daemon --unlock --components=secrets <"$HOME/keyring-password" >/dev/null 2>&1
gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1
dbus-send --session --print-reply=literal --dest=org.freedesktop.secrets /org/freedesktop/secrets/collection/login \\
  org.freedesktop.Secret.Collection.SearchItems dict:string:string:xdg:schema,${SAFE_STORAGE_SCHEMA}' |
  grep -o '/org/freedesktop/secrets/collection/login/[A-Za-z0-9_]*' || true
rm -rf "$home"`)
    .split("\n")
    .filter(Boolean);
  return { digest, modes, items };
}

function runs(): Run[] {
  const text = tryInside(`cat ${RUNS} 2>/dev/null`) ?? "";
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => toRun(JSON.parse(line)));
}

function toRun(value: unknown): Run {
  assert.ok(isDynamicRecord(value), "a run line is an object");
  assert.ok(value.action === "write" || value.action === "read", "a run has an action");
  const run: Run = {
    at: Number(value.at),
    backend: String(value.backend),
    available: value.available === true,
    action: value.action,
  };
  if (typeof value.opened === "boolean") run.opened = value.opened;
  if (typeof value.error === "string") run.error = value.error;
  return run;
}

function journalLines(): string[] {
  return (tryInside("journalctl -u openbot.service -o cat --no-pager") ?? "").split("\n");
}

function buildImage(): void {
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0) return;
  const architecture = docker(["info", "--format", "{{.Architecture}}"]).trim();
  const electronArch = architecture === "aarch64" || architecture === "arm64" ? "arm64" : "x64";
  const zip = `electron-v${electronVersion}-linux-${electronArch}.zip`;
  const base = `https://github.com/electron/electron/releases/download/v${electronVersion}`;
  const dockerfile = `FROM ubuntu:${release}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${PACKAGES.join(" ")} && rm -rf /var/lib/apt/lists/*
RUN cd /tmp && curl -fsSLO ${base}/${zip} && curl -fsSL ${base}/SHASUMS256.txt | grep " \\*${zip}$" | sha256sum -c - && mkdir -p /opt/electron && unzip -q ${zip} -d /opt/electron && rm ${zip}
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
`;
  logger.info(`Building ${image}.`);
  docker(["build", "--tag", image, "-"], dockerfile);
}

function startContainer(): void {
  docker([
    "run",
    "--detach",
    "--name",
    container,
    "--privileged",
    "--cgroupns=private",
    "--tmpfs",
    "/run",
    "--tmpfs",
    "/run/lock",
    image,
  ]);
  const stub = join(OUT, "stub");
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, "package.json"), `${JSON.stringify({ name: APP_NAME, main: "main.js" })}\n`);
  writeFileSync(join(stub, "main.js"), STUB_MAIN);
  inside("mkdir -p /e2e");
  docker(["cp", HOSTING, `${container}:/e2e/hosting`]);
  docker(["cp", stub, `${container}:/e2e/stub`]);
  inside("systemctl is-system-running --wait >/dev/null 2>&1 || true");
  inside(SETUP);
}

function inside(script: string): string {
  return docker(["exec", "-i", container, "bash", "-euo", "pipefail", "-s"], script);
}

function tryInside(script: string): string | undefined {
  try {
    return inside(script);
  } catch {
    return undefined;
  }
}

function docker(args: string[], input?: string): string {
  const result = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(" ")} failed (${String(result.status)}): ${result.stderr}`);
  }
  return result.stdout;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function electronVersionOf(manifest: unknown): string {
  assert.ok(isDynamicRecord(manifest) && isDynamicRecord(manifest.devDependencies), "package.json has devDependencies");
  const version = manifest.devDependencies.electron;
  assert.ok(typeof version === "string" && /^\d+\.\d+\.\d+$/u.test(version), "Electron has an exact version");
  return version;
}
