import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import {
  abortUpload,
  archiveScript,
  type B2Key,
  completeUpload,
  deleteArchive,
  newArchiveKey,
  PART_BYTES,
  partCount,
  partUrls,
  presign,
  SERVER_BYTES,
  shellWord,
  startUpload,
  uploadedParts,
} from "./pool-archive";
import { hostingCopy, MACHINE_HOSTING, prepareScript } from "./pool-machine";

const logger = createOpenBotLogger("pool-archive-e2e");
const LEASEWEB_API = "https://api.leaseweb.com/publicCloud/v1/vps";
const LEASEWEB_ACCOUNTS = ["NL", "DE", "US", "AU", "SG"];
const IMAGE = "UBUNTU_26_04_64BIT";
const AUTH_API = "https://openbot-auth-api-test.internal9671.workers.dev";
const TEST_REFERENCE = /^pool-test-\d{2}$/u;
const WAIT_MS = 15 * 60_000;
const DOWNLOAD_URL_SECONDS = 60 * 60;
const LEFT_BEHIND = "ls -d /var/tmp/openbot-restore.* /run/openbot-restore-key.* 2>/dev/null | wc -l";

const FACTS = `
set -euo pipefail
export LC_ALL=C
cd /
find home/user srv/openbot-hosted -xdev ! -name '.Xauthority*' ! -path 'home/user/.boat*' -type f -print0 | sort -z | xargs -0 sha256sum | sed 's/^/sha256 /'
find home/user srv/openbot-hosted -xdev ! -name '.Xauthority*' ! -path 'home/user/.boat*' -printf 'entry %y %m %u:%g %p\\n' | sort
find home/user srv/openbot-hosted -xdev ! -path 'home/user/.boat*' -type l -printf 'link %p -> %l\\n' | sort
if command -v crontab >/dev/null; then echo "crontab $(crontab -u user -l 2>/dev/null | sha256sum | cut -c1-64)"; fi
`;

const SEED = (hostId: string, extraGb: number) => `
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
ln -s projects/e2e/data.bin e2e-link
if [ ${extraGb} -gt 0 ]; then
  cp -R /usr/share projects/e2e/share 2>/dev/null || true
  head -c $((${extraGb} * 1024 * 1024 * 1024)) /dev/urandom >projects/e2e/large.bin
fi'
if command -v crontab >/dev/null; then echo '17 3 * * * true # e2e' | crontab -u user -; fi
echo seeded
`;

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
  bytes?: number;
  megabytesPerSecond?: number;
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

function remote(machine: Vps, command: string, options: { input?: string; password?: string; quiet?: boolean } = {}) {
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
      maxBuffer: 1024 * 1024 * 1024,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", options.quiet ? "ignore" : "inherit"],
    });
  } finally {
    if (askpass) rmSync(askpass, { recursive: true, force: true });
  }
}

function remoteOrEmpty(machine: Vps, command: string) {
  try {
    return remote(machine, command, { quiet: true }).trim();
  } catch {
    return "";
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

async function restart(machine: Vps) {
  const bootId = "cat /proc/sys/kernel/random/boot_id";
  const before = remote(machine, bootId).trim();
  remote(machine, "systemd-run --quiet --on-active=2 systemctl reboot");
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await delay(5_000);
    const now = remoteOrEmpty(machine, bootId);
    if (now !== "" && now !== before) return;
  }
  throw new Error(`VPS ${machine.id} did not start again.`);
}

async function preparePool(machine: Vps, release: { url: string; sha256: string }, keys: string) {
  await reinstall(machine);
  const password = await rootPassword(machine);
  remote(machine, "bash -s", { input: prepareScript(machine.id, release, AUTH_API, keys), password });
  await restart(machine);
  remote(machine, "bash -s", { input: hostingCopy() });
}

function factLines(text: string) {
  return new Set(text.split("\n").filter((line) => line !== ""));
}

function megabytesPerSecond(bytes: number, seconds: number) {
  return Math.round((bytes / 1_000_000 / Math.max(seconds, 1)) * 10) / 10;
}

async function main() {
  const id = option("vps");
  const keysFile = option("keys");
  const extraGb = Number(option("extra-gb") ?? "0");
  if (!id || !/^\d{1,20}$/u.test(id) || !keysFile || !Number.isInteger(extraGb) || extraGb < 0 || extraGb > 50) {
    throw new Error(
      "usage: bun scripts/hosting/pool-archive-e2e.ts --vps=<VPS ID> --keys=<operator keys file> [--extra-gb=<0-50>]",
    );
  }
  const b2Id = process.env.B2_KEY_ID_EU;
  const b2Secret = process.env.B2_APPLICATION_KEY_EU;
  if (!b2Id || !b2Secret) throw new Error("B2_KEY_ID_EU and B2_APPLICATION_KEY_EU are not in the environment.");
  const b2: B2Key = { id: b2Id, secret: b2Secret };
  const workerId = process.env.B2_WORKER_KEY_ID_EU;
  const workerSecret = process.env.B2_WORKER_APPLICATION_KEY_EU;
  if (!workerId || !workerSecret) {
    throw new Error("B2_WORKER_KEY_ID_EU and B2_WORKER_APPLICATION_KEY_EU are not in the environment.");
  }
  const workerB2: B2Key = { id: workerId, secret: workerSecret };
  const keys = Buffer.from(readFileSync(keysFile, "utf8")).toString("base64");
  const machine = await findVps(id);
  if (!TEST_REFERENCE.test(machine.reference ?? "")) {
    throw new Error(
      `VPS ${id} has the reference ${machine.reference ?? "(none)"}, not pool-test-<NN>. It is not erased.`,
    );
  }
  const release = await newestRelease();
  const report = join(process.cwd(), ".openbot-build", `pool-archive-e2e-${extraGb}gb.json`);
  const steps: Step[] = [];
  const checks: Check[] = [];
  const step = async <T>(name: string, run: () => Promise<T> | T) => {
    const started = Date.now();
    logger.info(`${name}…`);
    const result = await run();
    const done: Step = { name, seconds: Math.round((Date.now() - started) / 1000) };
    steps.push(done);
    return { result, done };
  };
  const withBytes = (done: Step, bytes: number) => {
    done.bytes = bytes;
    done.megabytesPerSecond = megabytesPerSecond(bytes, done.seconds);
  };
  const objectKey = `e2e/${randomUUID()}.tar.age`;
  const archiveKey = newArchiveKey();
  let uploadId = "";
  let completed = false;
  let deleted = false;
  let versionId = "";
  let serverBytes = 0;
  let archiveBytes = 0;
  let archiveSha256 = "";
  try {
    await step("prepare a pool machine", () => preparePool(machine, release, keys));
    const age = remoteOrEmpty(machine, "age --version");
    checks.push({ name: "the bootstrap installed age", pass: age !== "", detail: age || "missing" });
    await step("run a server with customer files", () =>
      remote(machine, "bash -s", { input: SEED(randomUUID(), extraGb) }),
    );
    const before = (await step("check that OpenBot runs", () => remote(machine, "bash -s", { input: RUNS }).trim()))
      .result;
    checks.push({ name: "OpenBot runs before the archive", pass: before === "runs", detail: before });
    serverBytes = Number(remote(machine, SERVER_BYTES).trim());

    uploadId = (await step("start the B2 upload", () => startUpload(b2, objectKey))).result;
    const urls = partUrls(b2, objectKey, uploadId, partCount(serverBytes));
    const archived = await step("export, encrypt and upload to B2 on the machine", () =>
      remote(
        machine,
        `bash -c ${shellWord(archiveScript(MACHINE_HOSTING))} archive ${archiveKey.recipient} ${PART_BYTES}`,
        {
          input: `${urls}\n`,
        },
      ),
    );
    const upload = uploadedParts(archived.result);
    const parts = upload.parts;
    archiveSha256 = upload.sha256;
    archiveBytes = upload.bytes;
    withBytes(archived.done, archiveBytes);
    const exported = factLines(remote(machine, "bash -s", { input: FACTS }));
    checks.push({
      name: "each part in B2 has the MD5 of the part that the machine sent",
      pass: parts.length > 0 && parts.every((part) => part.etag === part.md5),
      detail: `${parts.length} parts; ${parts.filter((part) => part.etag !== part.md5).length} differ`,
    });

    await step("complete and verify in B2", async () => {
      const head = await completeUpload(b2, objectKey, uploadId, parts);
      completed = true;
      versionId = head.versionId;
      const stored = head.size;
      checks.push({
        name: "B2 has an object of the size that the machine sent",
        pass: head.status === 200 && stored === archiveBytes && archiveSha256 !== "",
        detail: `${stored} of ${archiveBytes} bytes, sha256 ${archiveSha256 === "" ? "missing" : "recorded"}`,
      });
    });

    await step("reinstall and prepare the machine again", () => preparePool(machine, release, keys));
    const empty = remote(
      machine,
      "test ! -e /home/user/.config/OpenBot && test ! -e /srv/openbot-hosted/keyrings && echo empty || echo data",
    ).trim();
    checks.push({ name: "the reinstall erased the server", pass: empty === "empty", detail: empty });

    const download = () =>
      `${archiveKey.identity}\n${presign(workerB2, "GET", objectKey, { versionId }, DOWNLOAD_URL_SECONDS)}\n`;
    const wrongSum = archiveSha256.replace(/^./u, (first) => (first === "0" ? "1" : "0"));
    const refused = remote(
      machine,
      `bash ${MACHINE_HOSTING}/move-from-boat.sh restore ${wrongSum} >/dev/null 2>&1 && echo restored || echo refused; test -e /home/user/.config/OpenBot && echo data || echo empty; ${LEFT_BEHIND}`,
      { input: download() },
    )
      .trim()
      .split("\n");
    checks.push({
      name: "a restore with a wrong checksum stops, imports nothing and leaves no decrypted file or key",
      pass: refused[0] === "refused" && refused[1] === "empty" && refused[2] === "0",
      detail: refused.join(", "),
    });

    const restored = await step("download, decrypt and import with move-from-boat.sh restore", () =>
      remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh restore ${archiveSha256}`, { input: download() }),
    );
    withBytes(restored.done, archiveBytes);
    const leftBehind = remote(machine, LEFT_BEHIND).trim();
    checks.push({
      name: "the restore with the read-only Worker key leaves no decrypted archive or key",
      pass: leftBehind === "0",
      detail: `${leftBehind} left`,
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

    await step("delete the archive in B2", async () => {
      const answer = await deleteArchive(b2, objectKey, versionId);
      deleted = answer.deleted;
      checks.push({
        name: "B2 has no archive after the delete",
        pass: deleted && versionId !== "",
        detail: `delete ${answer.status}, ${deleted ? "gone" : "still there"}, version ${versionId === "" ? "missing" : "known"}`,
      });
    });
  } finally {
    if (uploadId !== "" && !completed) await abortUpload(b2, objectKey, uploadId);
    if (completed && !deleted) await deleteArchive(b2, objectKey, versionId).catch(() => undefined);
  }
  const pass = checks.every((check) => check.pass);
  mkdirSync(resolve(report, ".."), { recursive: true });
  writeFileSync(
    report,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        vps: id,
        release: release.version,
        extraGb,
        serverBytes,
        archiveBytes,
        partBytes: PART_BYTES,
        steps,
        checks,
        pass,
      },
      null,
      2,
    )}\n`,
  );
  for (const item of steps) {
    const speed = item.megabytesPerSecond === undefined ? "" : ` (${item.megabytesPerSecond} MB/s)`;
    logger.info(`${item.name}: ${item.seconds} s${speed}`);
  }
  for (const check of checks) logger.info(`${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  logger.info(`Report: ${report}`);
  if (!pass) process.exitCode = 1;
}

await main();
