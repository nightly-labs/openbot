/**
 * Tests that `move-from-boat.sh export` and `import` carry the server of a pool machine through a reinstall
 * of that machine, as the archive of plan 012 does (plans/012-pool-server-archive.md, item 1):
 *
 *   bunx dotenvx run -f apps/auth-api/.env.production -fk <root>/.env.keys -- \
 *     bun scripts/hosting/pool-archive-e2e.ts --vps=<VPS ID> --keys=<operator keys file>
 *
 * The VPS must have a `pool-test-<NN>` reference: the test erases its disk two times. It does not use D1.
 *
 * 1. Reinstall, `prepare` and `leaseweb-bootstrap.sh`, as `leaseweb-pool.ts prepare` does, and a restart.
 * 2. A server runs: OpenBot starts with a random host ID and a claim that is not valid, so it makes its
 *    database and its keyring and does not sign in. The customer adds a file, a link, a command and a
 *    crontab line.
 * 3. `export -` streams the archive to this computer. Then the checksum, mode and owner of each file of the
 *    server (the home and the server keyring) and the crontab.
 * 4. Reinstall, `prepare`, bootstrap and restart again: the machine has none of the data now.
 * 5. `import`, the same list again, then `start`: OpenBot must run as it did before the export.
 *
 * The local copy of the archive is deleted at the end. The report is .openbot-build/pool-archive-e2e.json.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";

const logger = createOpenBotLogger("pool-archive-e2e");
const HOSTING = resolve(import.meta.dirname);
const REPORT = join(process.cwd(), ".openbot-build", "pool-archive-e2e.json");
const LEASEWEB_API = "https://api.leaseweb.com/publicCloud/v1/vps";
const LEASEWEB_ACCOUNTS = ["NL", "DE", "US", "AU", "SG"];
const IMAGE = "UBUNTU_26_04_64BIT";
const MACHINE_HOSTING = "/root/openbot-hosting";
const MACHINE_ARCHIVE = "/root/openbot-e2e-archive.tar";
/** The account service of the test Worker. The machine never offers itself, so it never calls it. */
const AUTH_API = "https://openbot-auth-api-test.internal9671.workers.dev";
const TEST_REFERENCE = /^pool-test-\d{2}$/u;
const WAIT_MS = 15 * 60_000;

/** Each file, link and folder of the server, and the crontab. OpenBot must not run. */
const FACTS = `
set -euo pipefail
export LC_ALL=C
cd /
find home/user srv/openbot-hosted -xdev ! -name '.Xauthority*' -type f -print0 | sort -z | xargs -0 sha256sum | sed 's/^/sha256 /'
find home/user srv/openbot-hosted -xdev ! -name '.Xauthority*' -printf 'entry %y %m %u:%g %p\\n' | sort
find home/user srv/openbot-hosted -xdev -type l -printf 'link %p -> %l\\n' | sort
if command -v crontab >/dev/null; then echo "crontab $(crontab -u user -l 2>/dev/null | sha256sum | cut -c1-64)"; fi
`;

/** A server that ran, with files of its customer. */
const SEED = (hostId: string) => `
set -euo pipefail
runuser -u user -- env HOME=/home/user OPENBOT_HOSTED_HOST_ID=${hostId} OPENBOT_HOSTED_CLAIM=e2e_claim_that_is_not_valid \\
  /opt/OpenBot/hosted/openbot-hosted-env
systemctl enable --now openbot.service
for _ in $(seq 1 180); do
  [ -s /home/user/.config/OpenBot/openbot.db ] && [ -s /srv/openbot-hosted/keyrings/login.keyring ] &&
    [ -s /home/user/.config/openbot-hosted/keyring-password ] && break
  sleep 1
done
[ -s /home/user/.config/OpenBot/openbot.db ] || { journalctl -u openbot.service -n 30 --no-pager >&2; exit 1; }
runuser -u user -- bash -c 'set -e; cd ~
mkdir -p projects/e2e .local/bin
head -c 1048576 /dev/urandom >projects/e2e/data.bin
printf "#!/bin/sh\\necho e2e\\n" >.local/bin/e2e-tool
chmod 0755 .local/bin/e2e-tool
ln -s projects/e2e/data.bin e2e-link'
if command -v crontab >/dev/null; then echo '17 3 * * * true # e2e' | crontab -u user -; fi
echo seeded
`;

/** True when OpenBot runs as a service of the service user. */
const RUNS = `
for _ in $(seq 1 120); do
  if systemctl is-active --quiet openbot.service && pgrep -u user -x openbot >/dev/null; then echo runs; exit 0; fi
  sleep 1
done
echo "does not run: $(systemctl is-active openbot.service)"
`;

interface Vps {
  id: string;
  key: string;
  reference: string | null;
  address: string;
}

interface Step {
  name: string;
  seconds: number;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const vpsSchema = z.object({
  id: z.string(),
  reference: z.string().nullish(),
  ips: z.array(z.object({ ip: z.string(), version: z.number(), mainIp: z.boolean().optional() })),
});
const releaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string(), digest: z.string().nullish() })),
});

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function leaseweb(key: string, path: string, init: RequestInit = {}) {
  return fetch(`${LEASEWEB_API}${path}`, {
    ...init,
    headers: { "X-LSW-Auth": key, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
}

async function findVps(id: string): Promise<Vps> {
  for (const account of LEASEWEB_ACCOUNTS) {
    const key = process.env[`LEASEWEB_API_KEY_${account}`];
    if (!key) continue;
    const response = await leaseweb(key, `/${id}`);
    if (response.status === 401 || response.status === 403 || response.status === 404) continue;
    if (!response.ok) throw new Error(`Leaseweb answered ${response.status} for VPS ${id}.`);
    const body = vpsSchema.parse(await response.json());
    const address = body.ips.find((ip) => ip.mainIp && ip.version === 4)?.ip;
    if (!address) throw new Error(`VPS ${id} has no public IPv4 address.`);
    return { id, key, reference: body.reference || null, address };
  }
  throw new Error(`No Leaseweb key in the environment has VPS ${id}.`);
}

function sshArgs(password: boolean) {
  const args = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", "-o", "ConnectionAttempts=3"];
  args.push("-o", "ServerAliveInterval=15");
  if (password) args.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
  else args.push("-o", "BatchMode=yes");
  return args;
}

/** Runs a command as root. With `password`, ssh reads it from a file of this user, never from a command line. */
function remote(
  machine: Vps,
  command: string,
  options: { input?: string; password?: string; stdin?: number; stdout?: number; quiet?: boolean } = {},
) {
  const env = { ...process.env };
  let askpass: string | undefined;
  if (options.password !== undefined) {
    askpass = mkdtempSync(join(tmpdir(), "openbot-askpass-"));
    writeFileSync(join(askpass, "password"), options.password, { mode: 0o600 });
    writeFileSync(join(askpass, "askpass"), `#!/bin/sh\nexec cat '${join(askpass, "password")}'\n`, { mode: 0o700 });
    Object.assign(env, { SSH_ASKPASS: join(askpass, "askpass"), SSH_ASKPASS_REQUIRE: "force", DISPLAY: "none" });
  }
  try {
    return execFileSync("ssh", [...sshArgs(options.password !== undefined), `root@${machine.address}`, command], {
      env,
      input: options.input,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: [
        options.stdin ?? (options.input === undefined ? "ignore" : "pipe"),
        options.stdout ?? "pipe",
        options.quiet ? "ignore" : "inherit",
      ],
    });
  } finally {
    if (askpass) rmSync(askpass, { recursive: true, force: true });
  }
}

function hostKeys(machine: Vps) {
  try {
    return execFileSync("ssh-keyscan", ["-T", "10", machine.address], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .sort()
      .join("\n");
  } catch {
    return "";
  }
}

/** Erases the disk with a new system. Leaseweb shows RUNNING for the whole reinstall: new host keys end it. */
async function reinstall(machine: Vps) {
  const before = hostKeys(machine);
  if (before === "") throw new Error(`VPS ${machine.id} does not answer on SSH.`);
  const response = await leaseweb(machine.key, `/${machine.id}/reinstall`, {
    method: "PUT",
    body: JSON.stringify({ imageId: IMAGE }),
  });
  if (!response.ok) throw new Error(`Leaseweb refused the reinstall of VPS ${machine.id}: ${response.status}.`);
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await delay(10_000);
    const keys = hostKeys(machine);
    if (keys !== "" && keys !== before) {
      execFileSync("ssh-keygen", ["-R", machine.address], { stdio: "ignore" });
      return;
    }
  }
  throw new Error(`VPS ${machine.id} did not finish its reinstall in ${WAIT_MS / 60_000} minutes.`);
}

async function rootPassword(machine: Vps) {
  // The new system gets its password some seconds after its SSH keys.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await leaseweb(machine.key, `/${machine.id}/credentials/OPERATING_SYSTEM/root`);
    if (response.ok) return z.object({ password: z.string().min(1) }).parse(await response.json()).password;
    await delay(10_000);
  }
  throw new Error(`Leaseweb gave no root password for VPS ${machine.id}.`);
}

async function newestRelease() {
  const body = JSON.parse(
    execFileSync("gh", ["api", "repos/nightly-labs/openbot/releases/latest"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const release = releaseSchema.parse(body);
  const version = release.tag_name.replace(/^v/u, "");
  const asset = release.assets.find((item) => item.name === `OpenBot-${version}-x86_64.AppImage`);
  const sha256 = asset?.digest?.replace(/^sha256:/u, "") ?? "";
  if (!asset || !/^[0-9a-f]{64}$/u.test(sha256)) throw new Error(`Release ${version} has no AppImage with a SHA-256.`);
  return { version, url: asset.browser_download_url, sha256 };
}

/** A shell text that puts this scripts/hosting in MACHINE_HOSTING. The files have no secret. */
function hostingCopy() {
  const archive = execFileSync(
    "tar",
    ["-czf", "-", "--no-xattrs", "--exclude=*.ts", "-C", resolve(HOSTING, ".."), "hosting"],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return `set -euo pipefail
rm -rf ${MACHINE_HOSTING}
install -d -m 0700 ${MACHINE_HOSTING}
base64 -d <<'OPENBOT_HOSTING' | tar -xz --no-same-owner --strip-components=1 -C ${MACHINE_HOSTING}
${archive.toString("base64")}
OPENBOT_HOSTING
`;
}

async function restart(machine: Vps) {
  const bootId = "cat /proc/sys/kernel/random/boot_id";
  const before = remote(machine, bootId).trim();
  remote(machine, "systemd-run --quiet --on-active=2 systemctl reboot");
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await delay(5_000);
    try {
      const now = remote(machine, bootId, { quiet: true }).trim();
      if (now !== "" && now !== before) return;
    } catch {
      // The machine restarts.
    }
  }
  throw new Error(`VPS ${machine.id} did not start again.`);
}

/** A new pool machine, as `leaseweb-pool.ts prepare` makes it: user 1000:1000, OpenBot disabled. */
async function preparePool(machine: Vps, release: { url: string; sha256: string }, keys: string) {
  await reinstall(machine);
  const password = await rootPassword(machine);
  const script = `${hostingCopy()}
bash ${MACHINE_HOSTING}/move-from-boat.sh prepare lsw-${machine.id} 1000 1000 '${release.url}' ${release.sha256} '${AUTH_API}'
bash ${MACHINE_HOSTING}/leaseweb-bootstrap.sh '${keys}'
`;
  remote(machine, "bash -s", { input: script, password });
  await restart(machine);
  remote(machine, "bash -s", { input: hostingCopy() });
}

function factLines(text: string) {
  return new Set(text.split("\n").filter((line) => line !== ""));
}

async function main() {
  const id = option("vps");
  const keysFile = option("keys");
  if (!id || !/^\d{1,20}$/u.test(id) || !keysFile) {
    throw new Error("usage: bun scripts/hosting/pool-archive-e2e.ts --vps=<VPS ID> --keys=<operator keys file>");
  }
  const keys = Buffer.from(readFileSync(keysFile, "utf8")).toString("base64");
  const machine = await findVps(id);
  if (!TEST_REFERENCE.test(machine.reference ?? "")) {
    throw new Error(
      `VPS ${id} has the reference ${machine.reference ?? "(none)"}, not pool-test-<NN>. It is not erased.`,
    );
  }
  const release = await newestRelease();
  const steps: Step[] = [];
  const checks: Check[] = [];
  const step = async <T>(name: string, run: () => Promise<T> | T) => {
    const started = Date.now();
    logger.info(`${name}…`);
    const result = await run();
    steps.push({ name, seconds: Math.round((Date.now() - started) / 1000) });
    return result;
  };
  const local = mkdtempSync(join(tmpdir(), "openbot-pool-archive-"));
  const archive = join(local, "archive.tar");
  let archiveBytes = 0;
  let archiveSha256 = "";
  try {
    await step("prepare a pool machine", () => preparePool(machine, release, keys));
    await step("run a server with customer files", () => remote(machine, "bash -s", { input: SEED(randomUUID()) }));
    const before = await step("check that OpenBot runs", () => remote(machine, "bash -s", { input: RUNS }).trim());
    checks.push({ name: "OpenBot runs before the export", pass: before === "runs", detail: before });

    await step("export to this computer", () => {
      const output = openSync(archive, "wx", 0o600);
      try {
        remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh export -`, { stdout: output });
      } finally {
        closeSync(output);
      }
    });
    archiveBytes = statSync(archive).size;
    archiveSha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const exported = factLines(remote(machine, "bash -s", { input: FACTS }));
    checks.push({
      name: "the archive is not empty",
      pass: archiveBytes > 1024 * 1024,
      detail: `${archiveBytes} bytes`,
    });

    await step("reinstall and prepare the machine again", () => preparePool(machine, release, keys));
    const empty = remote(
      machine,
      "test ! -e /home/user/.config/OpenBot && test ! -e /srv/openbot-hosted/keyrings && echo empty || echo data",
    ).trim();
    checks.push({ name: "the reinstall erased the server", pass: empty === "empty", detail: empty });

    await step("upload and import", () => {
      const input = openSync(archive, "r");
      try {
        remote(machine, `cat >${MACHINE_ARCHIVE}`, { stdin: input });
      } finally {
        closeSync(input);
      }
      const sum = remote(machine, `sha256sum ${MACHINE_ARCHIVE} | cut -d' ' -f1`).trim();
      checks.push({ name: "the machine got the same archive", pass: sum === archiveSha256, detail: sum });
      remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh import ${MACHINE_ARCHIVE}; rm -f ${MACHINE_ARCHIVE}`);
    });
    const imported = factLines(remote(machine, "bash -s", { input: FACTS }));
    const missing = [...exported].filter((line) => !imported.has(line));
    const added = [...imported].filter((line) => !exported.has(line));
    checks.push({
      name: "each file, mode, owner, link and the crontab are the same after the import",
      pass: missing.length === 0 && added.length === 0,
      detail: `${exported.size} facts; missing ${JSON.stringify(missing.slice(0, 20))}; added ${JSON.stringify(added.slice(0, 20))}`,
    });

    await step("start", () => remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh start`));
    const after = remote(machine, "bash -s", { input: RUNS }).trim();
    checks.push({ name: "OpenBot runs after the import", pass: after === "runs", detail: after });
  } finally {
    rmSync(local, { recursive: true, force: true });
    try {
      remote(machine, `rm -f ${MACHINE_ARCHIVE}`, { quiet: true });
    } catch {
      // The machine does not answer; a reinstall erases the copy.
    }
  }
  const pass = checks.every((check) => check.pass);
  mkdirSync(resolve(REPORT, ".."), { recursive: true });
  writeFileSync(
    REPORT,
    `${JSON.stringify({ at: new Date().toISOString(), vps: id, release: release.version, archiveBytes, steps, checks, pass }, null, 2)}\n`,
  );
  for (const check of checks) logger.info(`${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  logger.info(`Report: ${REPORT}`);
  if (!pass) process.exitCode = 1;
}

await main();
