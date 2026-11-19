import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BILLING_PLAN_IDS, type BillingPlanId } from "@openbot/contracts/billing";
import { HOSTED_PLAN_SIZE, HOSTED_SERVER_SIZE_NAMES } from "@openbot/contracts/hosted-servers";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";
import {
  ARCHIVE_REGION,
  abortUpload,
  archiveScript,
  B2_BUCKET,
  type B2Key,
  completeUpload,
  deleteArchive,
  newArchiveKey,
  PART_BYTES,
  partCount,
  partUrls,
  shellWord,
  startUpload,
  uploadedParts,
  wrapArchiveKey,
  wrapKeySecret,
} from "./pool-archive";
import { hostingCopy, MACHINE_HOSTING, prepareScript, upgradeScript } from "./pool-machine";

const logger = createOpenBotLogger("leaseweb-pool");
const AUTH_API = resolve(import.meta.dirname, "../../apps/auth-api");
const LEASEWEB_API = "https://api.leaseweb.com/publicCloud/v1/vps";
const POOL_REFERENCE = "pool";
const LEGACY_POOL_REFERENCE = "pool-free";
const isPoolReference = (reference: string | null) =>
  reference === POOL_REFERENCE || reference === LEGACY_POOL_REFERENCE;
const isOwnerReference = (reference: string) => {
  const [email, server, ...rest] = reference.split(" ");
  return rest.length === 0 && EMAIL_PATTERN.test((email ?? "").toLowerCase()) && /^[0-9a-f]{8}$/u.test(server ?? "");
};
const IMAGE = "UBUNTU_26_04_64BIT";
const OPERATOR_KEYS_HOST_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/u;
const OPERATOR_KEY_PATTERN =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+=*( .*)?$/u;
const keyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
const keyBlob = (line: string) => line.split(/\s+/u)[1] ?? "";
const REINSTALL_WAIT_MS = 15 * 60_000;
const VPS_ID_PATTERN = /^\d{1,20}$/u;
const HOST_ID_PATTERN = /^leaseweb:\d{1,20}$/u;
const SERVER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const LOCATION_PATTERN = /^[A-Z]{3}-\d{2}$/u;
const PRODUCT_PATTERN = /^VPS\d{2}$/u;
const HOSTING = resolve(import.meta.dirname);
const BOAT_API = "https://boat.dev/api/v1";
const SANDBOX_USABLE = new Set(["ready", "idle", "running"]);
const SANDBOX_PATTERN = /^bx_[a-z0-9]{4,40}$/u;
const STATE_PATTERN = /^[a-z_]{1,32}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const PRODUCT_OF_PLAN: Record<BillingPlanId, string> = { starter: "VPS01", standard: "VPS02", pro: "VPS03" };
const AUTH_API_URL = {
  production: "https://api.openbot.run",
  test: "https://openbot-auth-api-test.internal9671.workers.dev",
};
const SANDBOX_MOVE = "/root/openbot-move";
const MACHINE_ARCHIVE = "/root/openbot-move.tar";
const EXPORT_WAIT_MS = 3 * 60 * 60_000;
const RESTORE_WAIT_MS = 30 * 60_000;
const LEASEWEB_ACCOUNTS = ["NL", "DE", "US", "AU", "SG"];
const CUSTOM_NUMBER_PATTERN = /^custom-(\d{2,}) /u;
const CUSTOMER_PATTERN = /^[a-z0-9]{1,32}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TRAFFIC_CONCURRENCY = 6;
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/u;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{4,30}[A-Za-z0-9.]$/u;
const CLAIM_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const REMOTE_HOST_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;
const ONLINE_WAIT_MS = 5 * 60_000;
const POOL_SEEN_WITHIN_MS = 150_000;
const POOL_FIRST_START_SQL = `(operator_host IS NOT NULL AND observed_state = 'starting' AND last_wake_reason = 'create'
  AND provider_template IS NULL AND retired_sandbox_id IS NULL AND claim_redeemed_at IS NULL)`;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const OFFER_WAIT_MS = 2 * 60_000;
const ROOT = resolve(HOSTING, "../..");
const DAY_MS = 24 * 60 * 60_000;
const ARCHIVE_KEPT_MS = 14 * DAY_MS;
const POOL_UNPAID_ARCHIVE_AFTER_MS = 3 * DAY_MS;
const OPEN_STATUSES_SQL = "('active', 'trialing', 'past_due', 'unpaid', 'paused')";
const ENDED_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);
const SUBSCRIPTION_PATTERN = /^sub_[A-Za-z0-9]{1,250}$/u;
const OBJECT_KEY_PATTERN = /^[a-z]{2}\/[A-Za-z0-9:_-]{1,128}\/\d{13}\.tar\.age$/u;
const ARCHIVE_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,512}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SERVER_BYTES = `du -sb --one-file-system /home/user /srv/openbot-hosted | awk '{ total += $1 } END { print total }'`;

function literal(value: string | number, pattern?: RegExp): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("A number for D1 is not an integer.");
    return String(value);
  }
  if (!pattern?.test(value)) throw new Error("A value for D1 has characters that are not permitted.");
  return `'${value}'`;
}

const statementSchema = z.array(
  z.object({ results: z.array(z.record(z.string(), z.unknown())), meta: z.object({ changes: z.number() }).partial() }),
);

const wranglerErrorSchema = z.object({
  error: z.object({ text: z.string(), notes: z.array(z.object({ text: z.string() })).default([]) }),
});

function d1Statement(sql: string, testDatabase: boolean) {
  let output: string;
  try {
    output = execFileSync(
      "bunx",
      [
        "wrangler",
        "d1",
        "execute",
        testDatabase ? "openbot-auth-test" : "openbot-auth",
        ...(testDatabase ? ["--env", "test"] : []),
        "--remote",
        "--json",
        `--command=${sql}`,
      ],
      { cwd: AUTH_API, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    const stdout = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    const failure = wranglerErrorSchema.safeParse(stdout ? JSON.parse(stdout) : null);
    if (!failure.success) throw new Error("Wrangler failed. Run it by hand to see why.");
    const notes = failure.data.error.notes.map(({ text }) => text).join(" ");
    throw new Error(`D1 refused the query: ${notes || failure.data.error.text}`);
  }
  const [first] = statementSchema.parse(JSON.parse(output));
  if (!first) throw new Error("Wrangler gave no D1 result.");
  return first;
}

const workRowSchema = z.object({
  server_id: z.string().regex(SERVER_ID_PATTERN),
  operator_host: z.string().regex(HOST_ID_PATTERN),
});
type WorkRow = z.infer<typeof workRowSchema>;
const archiveRowSchema = workRowSchema.extend({
  plan_ended_at: z.number().int(),
  subscription: z.string().regex(SUBSCRIPTION_PATTERN).nullable(),
});
type ArchiveRow = z.infer<typeof archiveRowSchema>;
const storedArchiveSchema = z.object({
  object_key: z.string().regex(OBJECT_KEY_PATTERN),
  version_id: z.string().regex(ARCHIVE_VALUE_PATTERN),
  server_id: z.string().regex(SERVER_ID_PATTERN),
});
const subscriptionSchema = z.object({
  status: z.string(),
  cancellation_details: z.object({ reason: z.string().nullable() }).nullish(),
});

const moveRowSchema = z.object({
  plan: z.string(),
  size: z.enum(HOSTED_SERVER_SIZE_NAMES),
  desired_state: z.string(),
  observed_state: z.string().regex(STATE_PATTERN),
  observed_error: z.string().nullable(),
  provider_sandbox_id: z.string().nullable(),
  operator_host: z.string().nullable(),
  currency: z.string().nullable(),
  email: z.string(),
});
const releaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string(), digest: z.string().nullish() })),
});
interface Release {
  version: string;
  url: string;
  sha256: string;
}
const sandboxValueSchema = z.object({
  state: z.string(),
  stop: z.object({ status: z.string() }).nullish(),
});
const sandboxSchema = z.union([
  z.object({ sandbox: sandboxValueSchema }).transform((value) => value.sandbox),
  sandboxValueSchema,
]);
type Sandbox = z.infer<typeof sandboxValueSchema>;
const commandSchema = z.object({
  exitCode: z.number().nullable(),
  stdout: z.string().nullish(),
  stderr: z.string().nullish(),
});

interface MachineState {
  version: string;
  user: string;
  ids: string;
  enabled: string;
  data: boolean;
  hostKey: string;
}
const MACHINE_STATE = `v=$(sed -n 's/^X-AppImage-Version=//p' /opt/OpenBot/app/*.desktop 2>/dev/null | head -n 1)
echo "version=$v"
echo "user=$(cat /opt/OpenBot/hosted/service-user 2>/dev/null || true)"
echo "ids=$(id -u user 2>/dev/null || true):$(id -g user 2>/dev/null || true)"
echo "enabled=$(systemctl is-enabled openbot.service 2>/dev/null || true)"
if [ -e /home/user/.config/OpenBot ] || [ -e /home/user/.config/openbot-hosted ] || [ -e /srv/openbot-hosted/keyrings ]; then echo data=yes; else echo data=no; fi
echo "hostkey=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`;

const CUSTOM_STATE = `export LC_ALL=C
echo "hostname=$(hostname)"
if [ -s /etc/ssh/openbot-operator-keys/root ]; then echo bootstrap=yes; else echo bootstrap=no; fi
user=$(cat /opt/OpenBot/hosted/service-user 2>/dev/null || true)
if [ -n "$user" ] && command -v openbot >/dev/null && systemctl is-active --quiet openbot.service; then
  status=$(runuser -u "$user" -- openbot status 2>/dev/null || true)
  echo "version=$(sed -n 's/^OpenBot //p' <<<"$status" | head -n 1)"
  echo "account=$(sed -n 's/^Account: //p' <<<"$status" | head -n 1)"
  echo "server=$(sed -n 's/^Server: //p' <<<"$status" | head -n 1)"
  home=$(getent passwd "$user" | cut -d: -f6)
  echo "hosts=$(grep -o '"serverId": *"[^"]*"' "$home/.config/OpenBot/openbot-team-server-v2.json" 2>/dev/null |
    sed 's/.*"\\([^"]*\\)"$/\\1/' | paste -sd, -)"
fi`;

interface CustomState {
  hostname: string;
  bootstrapped: boolean;
  version: string;
  account: string;
  online: boolean;
  hosts: string[];
}

function signedIn(state: CustomState, owner: string) {
  if (state.account === "") return "not signed in";
  return state.account === owner ? "signed in to the owner" : "signed in to another account";
}

function toCustomState(output: string): CustomState {
  const values = keyValues(output);
  const account = values.get("account") ?? "";
  return {
    hostname: values.get("hostname") ?? "",
    bootstrapped: values.get("bootstrap") === "yes",
    version: values.get("version") ?? "",
    account: account.includes("@") ? account.toLowerCase() : "",
    online: /(^| \()online\)?$/u.test(values.get("server") ?? ""),
    hosts: (values.get("hosts") ?? "").split(",").filter((host) => REMOTE_HOST_PATTERN.test(host)),
  };
}

interface CustomOptions {
  owner: string;
  customer: string;
  name: string;
}

const SANDBOX_SSH = `ssh -i "$d/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \\
  -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15`;

function movableFolder(folder: string) {
  return (
    /^\/(?:srv\/|mnt\/|media\/)?[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*$/u.test(folder) &&
    folder !== "/srv/openbot-hosted" &&
    !/^\/(?:bin|boot|cdrom|dev|etc|gnu|home|initrd.*|lib.*|lost\+found|media|mnt|nix|opt|proc|root|run|sbin|snap|srv|swap.*|sys|tmp|usr|var)$/u.test(
      folder,
    )
  );
}

const RUN_EXPORT = `#!/bin/bash
set -o pipefail
d=${SANDBOX_MOVE}
bash "$d/move-from-boat.sh" export - "\${@:2}" 2>"$d/export.log" | ${SANDBOX_SSH} "root@$1"
echo "$?" >"$d/status"
`;

function keyValues(output: string) {
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) values.set(line.slice(0, at), line.slice(at + 1));
  }
  return values;
}

function isOlder(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}

function writeFileCommand(path: string, content: string) {
  return `base64 -d >'${path}' <<'OPENBOT_FILE'\n${Buffer.from(content).toString("base64")}\nOPENBOT_FILE\n`;
}

function scriptOutput(stdout: string, marker: string, sandbox: string) {
  const start = stdout.indexOf(`${marker}\n`);
  if (start === -1) throw new Error(`The output of a command in sandbox ${sandbox} has no start.`);
  const from = start + marker.length + 1;
  const end = stdout.lastIndexOf(`\n${marker}`);
  return end < from - 1 ? stdout.slice(from) : stdout.slice(from, end);
}

function seconds(milliseconds: number) {
  return Math.round(milliseconds / 1000);
}

function referenceLabel(reference: string) {
  if (reference === "") return "no reference";
  if (isOwnerReference(reference)) return "server";
  return reference
    .split(" ")
    .filter((word) => !word.includes("@"))
    .join(" ");
}

const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

function packBytes(pack: { value: number; unit: string } | null | undefined) {
  const scale = { GB: 1e9, TB: 1e12 }[pack?.unit ?? ""];
  return pack && scale ? pack.value * scale : null;
}

const trafficTotalSchema = z.object({ total: z.number().nonnegative() }).optional();
const contractSchema = z.object({
  contract: z
    .object({ dataTraffic: z.object({ value: z.number(), unit: z.string() }).nullable().optional() })
    .nullable()
    .optional(),
});
const trafficSchema = z.object({
  _metadata: z.object({
    summary: z.object({ downPublic: trafficTotalSchema, upPublic: trafficTotalSchema }).optional(),
  }),
});

const ipSchema = z.object({ ip: z.string(), version: z.number(), mainIp: z.boolean() });
const vpsSchema = z.object({
  id: z.string().regex(VPS_ID_PATTERN),
  datacenter: z.string().regex(LOCATION_PATTERN),
  pack: z.string().regex(/^Leaseweb VPS \d{1,2}$/u),
  reference: z.string().nullable(),
  state: z.string(),
  ips: z.array(ipSchema),
});

interface Vps {
  id: string;
  location: string;
  product: string;
  reference: string | null;
  state: string;
  address: string | null;
  key: string;
}

function toVps(body: unknown, key: string): Vps {
  const parsed = vpsSchema.parse(body);
  return {
    id: parsed.id,
    location: parsed.datacenter,
    product: `VPS${parsed.pack.replace("Leaseweb VPS ", "").padStart(2, "0")}`,
    reference: parsed.reference || null,
    state: parsed.state,
    address: parsed.ips.find((ip) => ip.mainIp && ip.version === 4)?.ip ?? null,
    key,
  };
}

class Pool {
  readonly #apply: boolean;
  readonly #testDatabase: boolean;
  readonly #keys: { name: string; key: string }[];
  readonly #found = new Map<string, Vps>();
  readonly #operatorKeysFile: string | undefined;
  readonly #operatorKeysHost: string | undefined;
  #operatorKeysBase64: string | undefined;
  readonly #boatKey: string | undefined;
  readonly #claimsToken: string | undefined;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(
    apply: boolean,
    testDatabase: boolean,
    environment: NodeJS.ProcessEnv,
    operatorKeysFile: string | undefined = undefined,
  ) {
    this.#apply = apply;
    this.#testDatabase = testDatabase;
    this.#operatorKeysFile = operatorKeysFile;
    this.#operatorKeysHost = environment.OPERATOR_KEYS_HOST || undefined;
    this.#boatKey = environment.BOAT_API_KEY || undefined;
    this.#claimsToken = environment.SERVER_CLAIMS_ADMIN_TOKEN || undefined;
    this.#environment = environment;
    this.#keys = Object.entries(environment).flatMap(([name, key]) =>
      /^LEASEWEB_API_KEY_[A-Z]+$/u.test(name) && key ? [{ name, key }] : [],
    );
  }

  #rows<Row>(sql: string, schema: z.ZodType<Row>): Row[] {
    return z.array(schema).parse(d1Statement(sql, this.#testDatabase).results);
  }

  #write(sql: string): number {
    const { changes } = d1Statement(sql, this.#testDatabase).meta;
    if (changes === undefined) throw new Error("Wrangler gave no D1 write result.");
    return changes;
  }

  #leaseweb(key: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    return fetch(`${LEASEWEB_API}${path}`, {
      ...init,
      headers: { "X-LSW-Auth": key, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async #vps(id: string): Promise<Vps> {
    if (!VPS_ID_PATTERN.test(id)) throw new Error(`Not a VPS ID: ${id}`);
    const known = this.#found.get(id);
    const accounts = known ? this.#keys.filter(({ key }) => key === known.key) : this.#keys;
    const slow: string[] = [];
    for (const account of accounts) {
      let response: Response;
      try {
        response = await this.#leaseweb(account.key, `/${id}`, {}, 60_000);
      } catch (error) {
        if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
        slow.push(account.name);
        continue;
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) continue;
      if (!response.ok) throw new Error(`Leaseweb answered ${response.status} for VPS ${id} (${account.name}).`);
      const machine = toVps(await response.json(), account.key);
      this.#found.set(id, machine);
      return machine;
    }
    if (slow.length > 0) throw new Error(`Leaseweb did not answer for ${slow.join(", ")}. Run the command again.`);
    throw new Error(`No Leaseweb key in the environment has VPS ${id}.`);
  }

  async #setReference(machine: Vps, reference: string) {
    const response = await this.#leaseweb(machine.key, `/${machine.id}`, {
      method: "PUT",
      body: JSON.stringify({ reference }),
    });
    if (!response.ok) throw new Error(`Leaseweb refused the reference of VPS ${machine.id}: ${response.status}.`);
  }

  #work() {
    const query = (where: string) =>
      this.#rows(
        `SELECT server_id, operator_host FROM hosted_servers WHERE operator_host IS NOT NULL AND ${where}`,
        workRowSchema,
      );
    return {
      stop: query(
        `desired_state = 'stopped' AND observed_state NOT IN ('stopped', 'deleted') AND NOT COALESCE(${POOL_FIRST_START_SQL}, 0)`,
      ),
      start: query(
        `desired_state = 'running' AND observed_state NOT IN ('running', 'deleted') AND NOT COALESCE(${POOL_FIRST_START_SQL}, 0)`,
      ),
      reinstall: query("desired_state = 'deleted' AND observed_state = 'deleted'"),
      archive: this.#rows(
        `SELECT h.server_id, h.operator_host, h.plan_ended_at,
           (SELECT s.stripe_subscription_id FROM billing_subscriptions s WHERE s.server_id = h.server_id
            ORDER BY COALESCE(s.current_period_end, 0) DESC, s.updated_at DESC LIMIT 1) AS subscription
         FROM hosted_servers h
         WHERE h.operator_host IS NOT NULL AND h.desired_state = 'stopped' AND h.observed_error = 'plan_ended'
           AND h.plan_ended_at IS NOT NULL AND NOT COALESCE(${POOL_FIRST_START_SQL}, 0)
           AND NOT EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = h.server_id
             AND s.status IN ${OPEN_STATUSES_SQL})
           AND NOT EXISTS(SELECT 1 FROM hosted_server_archives a WHERE a.server_id = h.server_id
             AND a.deleted_at IS NULL)
         ORDER BY h.plan_ended_at`,
        archiveRowSchema,
      ),
    };
  }

  #dueArchives() {
    return this.#rows(
      `SELECT a.object_key, a.version_id, a.server_id FROM hosted_server_archives a
       LEFT JOIN hosted_servers h ON h.server_id = a.server_id
       WHERE a.deleted_at IS NULL AND (a.delete_after <= ${literal(Date.now())} OR a.restored_at IS NOT NULL
         OR h.server_id IS NULL OR h.desired_state = 'deleted')
       ORDER BY a.delete_after`,
      storedArchiveSchema,
    );
  }

  #readySql() {
    return `(p.assign_token_hash IS NOT NULL AND COALESCE(p.seen_at, 0) > ${literal(Date.now() - POOL_SEEN_WITHIN_MS)})`;
  }

  boat() {
    const onBoat = `h.operator_host IS NULL AND h.provider_sandbox_id IS NOT NULL AND h.deleted_at IS NULL
      AND h.desired_state != 'deleted'`;
    const subscription = (condition: string) =>
      `EXISTS(SELECT 1 FROM billing_subscriptions b WHERE b.server_id = h.server_id AND ${condition})`;
    const paid = subscription("b.status IN ('active', 'trialing') AND b.cancel_at_period_end = 0");
    const toMove = this.#rows(
      `SELECT h.server_id, h.plan, h.currency, h.observed_state FROM hosted_servers h WHERE ${onBoat} AND ${paid}
       ORDER BY h.created_at`,
      z.object({ server_id: z.string(), plan: z.string(), currency: z.string(), observed_state: z.string() }),
    );
    for (const row of toMove) {
      logger.info(`Move ${row.server_id}: ${row.plan}, ${row.currency}, ${row.observed_state} on boat.`);
    }
    if (toMove.length === 0) logger.info("No server with a paid plan is on boat.");
    const [others] = this.#rows(
      `SELECT
         SUM(${subscription("b.status IN ('active', 'trialing') AND b.cancel_at_period_end = 1")}) AS ending,
         SUM(${subscription("b.status IN ('past_due', 'unpaid')")}) AS past_due,
         SUM(NOT ${subscription("b.status IN ('active', 'trialing', 'past_due', 'unpaid')")}) AS ended
       FROM hosted_servers h WHERE ${onBoat} AND NOT ${paid}`,
      z.object({ ending: z.number().nullable(), past_due: z.number().nullable(), ended: z.number().nullable() }),
    );
    logger.info(
      `Also on boat: ${others?.ending ?? 0} whose plan ends, ${others?.past_due ?? 0} past due, ${others?.ended ?? 0} with no plan.`,
    );
  }

  status() {
    const ready = this.#readySql();
    const free = "NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = p.host_id)";
    const groups = this.#rows(
      `SELECT p.location, p.product, COUNT(*) AS machines, SUM(${free}) AS free, SUM(${free} AND ${ready}) AS ready
       FROM operator_hosts p WHERE p.removed_at IS NULL GROUP BY p.location, p.product ORDER BY p.location, p.product`,
      z.object({
        location: z.string(),
        product: z.string(),
        machines: z.number(),
        free: z.number(),
        ready: z.number(),
      }),
    );
    if (groups.length === 0) logger.info("The pool has no machine.");
    for (const group of groups) {
      logger.info(
        `${group.location} ${group.product}: ${group.free} free of ${group.machines}, ${group.ready} ready for a new server.`,
      );
    }
    const notReady = this.#rows(
      `SELECT p.host_id FROM operator_hosts p WHERE p.removed_at IS NULL AND ${free} AND NOT ${ready} ORDER BY p.host_id`,
      z.object({ host_id: z.string() }),
    );
    for (const { host_id } of notReady) logger.info(`${host_id} is free and not ready for a new server. Run prepare.`);
    const starts = this.#rows(
      `SELECT server_id, operator_host FROM hosted_servers WHERE ${POOL_FIRST_START_SQL}`,
      workRowSchema,
    );
    for (const row of starts) logger.info(`The new server ${row.server_id} starts on ${row.operator_host}.`);
    const work = this.#work();
    for (const [action, rows] of Object.entries(work)) {
      for (const row of rows) logger.info(`sync would ${action} ${row.operator_host} (server ${row.server_id}).`);
    }
    const due = this.#dueArchives();
    for (const row of due) logger.info(`sync would delete the archive of server ${row.server_id} in B2.`);
    if (Object.values(work).every((rows) => rows.length === 0) && due.length === 0) logger.info("sync has no work.");
  }

  async add(ids: string[]) {
    for (const id of ids) {
      const machine = await this.#vps(id);
      logger.info(`VPS ${id}: ${machine.location} ${machine.product}, reference ${machine.reference ?? "none"}.`);
      if (machine.reference !== null && !isPoolReference(machine.reference)) {
        logger.warn(`VPS ${id} has a reference that is not ${POOL_REFERENCE}. Make sure that it is free, then set it.`);
        continue;
      }
      if (!this.#apply) continue;
      if (machine.reference === null) {
        await this.#setReference(machine, POOL_REFERENCE);
        if ((await this.#vps(id)).reference !== POOL_REFERENCE) {
          logger.warn(`Another operator took VPS ${id}. It stays out of the pool.`);
          continue;
        }
      }
      this.#write(
        `INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at)
         VALUES (${literal(`leaseweb:${id}`, HOST_ID_PATTERN)}, ${literal(machine.location, LOCATION_PATTERN)},
           ${literal(machine.product, PRODUCT_PATTERN)}, ${literal(Date.now())}, NULL)
         ON CONFLICT(host_id) DO UPDATE SET location = excluded.location, product = excluded.product,
           removed_at = NULL`,
      );
      logger.info(`VPS ${id} is in the pool.`);
    }
  }

  remove(ids: string[]) {
    for (const id of ids) {
      if (!VPS_ID_PATTERN.test(id)) throw new Error(`Not a VPS ID: ${id}`);
      const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
      const used = this.#rows(
        `SELECT server_id FROM hosted_servers WHERE operator_host = ${host}`,
        z.object({ server_id: z.string() }),
      );
      if (used[0]) {
        logger.warn(`VPS ${id} still has server ${used[0].server_id}. It stays in the pool.`);
        continue;
      }
      if (!this.#apply) {
        logger.info(`VPS ${id} would leave the pool.`);
        continue;
      }
      const changes = this.#write(
        `UPDATE operator_hosts SET removed_at = ${literal(Date.now())}, assign_token_hash = NULL, seen_at = NULL
         WHERE host_id = ${host} AND removed_at IS NULL
           AND NOT EXISTS(SELECT 1 FROM hosted_servers WHERE operator_host = ${host})`,
      );
      logger.info(changes === 1 ? `VPS ${id} left the pool.` : `VPS ${id} did not change.`);
    }
  }

  async sync() {
    const work = this.#work();
    let failed = 0;
    const each = async <Row extends WorkRow>(row: Row, task: (row: Row) => Promise<void>) => {
      try {
        await task(row);
      } catch (error) {
        failed += 1;
        logger.error(`The work on ${row.operator_host} (server ${row.server_id}) failed.`, toLogValue(error));
      }
    };
    for (const row of work.stop) await each(row, (item) => this.#runService(item, "stopped"));
    for (const row of work.start) await each(row, (item) => this.#runService(item, "running"));
    for (const row of work.reinstall) await each(row, (item) => this.#reinstall(item));
    for (const row of work.archive) await each(row, (item) => this.#archive(item));
    for (const row of this.#dueArchives()) {
      try {
        await this.#deleteStoredArchive(row);
      } catch (error) {
        failed += 1;
        logger.error(`The archive of server ${row.server_id} is not deleted.`, toLogValue(error));
      }
    }
    try {
      await this.#nameMachines();
    } catch (error) {
      failed += 1;
      logger.error("The references of the machines with a new server are not set.", toLogValue(error));
    }
    if (!this.#apply) logger.info("Nothing changed. Run again with --apply.");
    if (failed > 0) throw new Error(`${failed} machines failed. Run sync again.`);
  }

  async #nameMachines() {
    const rows = this.#rows(
      `SELECT h.server_id, h.operator_host, u.email FROM hosted_servers h JOIN users u ON u.id = h.owner_user_id
       WHERE h.operator_host IS NOT NULL AND h.retired_sandbox_id IS NULL AND h.provider_template IS NULL
         AND h.claim_redeemed_at IS NOT NULL AND h.observed_state = 'running'`,
      workRowSchema.extend({ email: z.string().min(3) }),
    );
    const free = this.#rows(
      `SELECT p.host_id FROM operator_hosts p WHERE p.removed_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = p.host_id)`,
      z.object({ host_id: z.string().regex(HOST_ID_PATTERN) }),
    );
    if (rows.length === 0 && free.length === 0) return;
    const references = new Map((await this.#allReferences(false)).map((vps) => [vps.id, vps.reference]));
    for (const row of rows) {
      const id = row.operator_host.replace("leaseweb:", "");
      const reference = references.get(id);
      if (reference === undefined) logger.warn(`No Leaseweb key in the environment shows VPS ${id}.`);
      if (reference === undefined || !isPoolReference(reference)) continue;
      logger.info(`Set the reference of VPS ${id} to the owner of server ${row.server_id}.`);
      if (!this.#apply) continue;
      await this.#setReference(await this.#vps(id), `${row.email} ${row.server_id.slice(0, 8)}`);
    }
    for (const { host_id: host } of free) {
      const id = host.replace("leaseweb:", "");
      const reference = references.get(id);
      if (reference === undefined) logger.warn(`No Leaseweb key in the environment shows VPS ${id}.`);
      if (reference === undefined || reference === POOL_REFERENCE) continue;
      if (reference !== LEGACY_POOL_REFERENCE && !isOwnerReference(reference)) {
        logger.warn(`Free VPS ${id} has a reference that is not of the pool. Examine it by hand.`);
        continue;
      }
      logger.info(`Set the reference of free VPS ${id} to ${POOL_REFERENCE}.`);
      if (!this.#apply) continue;
      await this.#setReference(await this.#vps(id), POOL_REFERENCE);
    }
  }

  async #runService(row: WorkRow, state: "stopped" | "running") {
    const machine = await this.#vps(row.operator_host.replace("leaseweb:", ""));
    logger.info(`${state === "stopped" ? "Stop" : "Start"} OpenBot on VPS ${machine.id} (server ${row.server_id}).`);
    if (!this.#apply) return;
    this.#remote(machine, `systemctl ${state === "stopped" ? "disable" : "enable"} --now openbot.service`);
    const changes = this.#write(
      `UPDATE hosted_servers SET observed_state = '${state}', updated_at = ${literal(Date.now())}
       WHERE server_id = ${literal(row.server_id, SERVER_ID_PATTERN)}
         AND operator_host = ${literal(row.operator_host, HOST_ID_PATTERN)} AND desired_state = '${state}'`,
    );
    if (changes === 0) logger.warn(`Server ${row.server_id} changed. Run sync again.`);
  }

  async #reinstall(row: WorkRow) {
    const host = literal(row.operator_host, HOST_ID_PATTERN);
    const inPool = this.#rows(
      `SELECT host_id FROM operator_hosts WHERE host_id = ${host} AND removed_at IS NULL`,
      z.object({ host_id: z.string() }),
    );
    if (inPool.length === 0) {
      logger.warn(`${row.operator_host} (server ${row.server_id}) is not in the pool. Add it, then sync again.`);
      return;
    }
    const machine = await this.#vps(row.operator_host.replace("leaseweb:", ""));
    logger.info(`Reinstall VPS ${machine.id}: server ${row.server_id} is deleted.`);
    if (!this.#apply) return;
    this.#write(`UPDATE operator_hosts SET assign_token_hash = NULL, seen_at = NULL WHERE host_id = ${host}`);
    await this.#erase(machine);
    await this.#setReference(machine, POOL_REFERENCE);
    const changes = this.#write(
      `UPDATE hosted_servers SET operator_host = NULL, updated_at = ${literal(Date.now())}
       WHERE server_id = ${literal(row.server_id, SERVER_ID_PATTERN)} AND operator_host = ${host}
         AND observed_state = 'deleted'`,
    );
    logger.info(
      changes === 1
        ? `VPS ${machine.id} is free. Run prepare to offer it for a new server.`
        : `The row of server ${row.server_id} changed.`,
    );
  }

  #archiveKeys(): { b2: B2Key; wrapSecret: Buffer } {
    const id = this.#environment.B2_KEY_ID_EU;
    const secret = this.#environment.B2_APPLICATION_KEY_EU;
    if (!id || !secret) throw new Error("B2_KEY_ID_EU and B2_APPLICATION_KEY_EU are not in the environment.");
    return { b2: { id, secret }, wrapSecret: wrapKeySecret(this.#environment.HOSTED_ARCHIVE_KEY_SECRET) };
  }

  async #subscriptionEnd(subscription: string): Promise<"open" | "cancelled" | "payment_failed"> {
    const key = this.#environment.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not in the environment.");
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Stripe answered ${response.status} for subscription ${subscription}.`);
    const body = subscriptionSchema.parse(await response.json());
    if (!ENDED_SUBSCRIPTION_STATUSES.has(body.status)) return "open";
    return body.cancellation_details?.reason === "payment_failed" ? "payment_failed" : "cancelled";
  }

  async #archive(row: ArchiveRow) {
    if (!row.subscription) {
      logger.warn(`Server ${row.server_id} has no Stripe subscription. It is not archived. Examine it by hand.`);
      return;
    }
    const end = await this.#subscriptionEnd(row.subscription);
    if (end === "open") {
      logger.info(`The plan of server ${row.server_id} is open in Stripe. It is not archived.`);
      return;
    }
    const archiveAt = row.plan_ended_at + POOL_UNPAID_ARCHIVE_AFTER_MS;
    if (end === "payment_failed" && Date.now() < archiveAt) {
      logger.info(
        `The last payment of server ${row.server_id} failed. Its archive starts after ${new Date(archiveAt).toISOString()}.`,
      );
      return;
    }
    const machine = await this.#vps(row.operator_host.replace("leaseweb:", ""));
    logger.info(`Archive server ${row.server_id} from VPS ${machine.id} in B2, then reinstall the VPS.`);
    if (!this.#apply) return;
    const { b2, wrapSecret } = this.#archiveKeys();
    const host = literal(row.operator_host, HOST_ID_PATTERN);
    const server = literal(row.server_id, SERVER_ID_PATTERN);
    this.#remote(machine, "bash -s", {
      input: `${hostingCopy()}
command -v age >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q age >/dev/null
`,
    });
    const serverBytes = Number(this.#remote(machine, SERVER_BYTES, { capture: true }).trim());
    if (!Number.isSafeInteger(serverBytes) || serverBytes <= 0)
      throw new Error(`VPS ${machine.id} has no server data.`);
    const objectKey = `${ARCHIVE_REGION}/${row.server_id}/${Date.now()}.tar.age`;
    const archiveKey = newArchiveKey();
    const uploadId = await startUpload(b2, objectKey);
    let versionId = "";
    let kept = false;
    try {
      const output = this.#remote(
        machine,
        `bash -c ${shellWord(archiveScript(MACHINE_HOSTING))} archive ${archiveKey.recipient} ${PART_BYTES}`,
        { input: `${partUrls(b2, objectKey, uploadId, partCount(serverBytes))}\n`, capture: true },
      );
      const upload = uploadedParts(output);
      if (upload.parts.length === 0 || upload.sha256 === "" || upload.parts.some((part) => part.etag !== part.md5)) {
        throw new Error(`B2 did not get each part of server ${row.server_id} as the machine sent it.`);
      }
      const head = await completeUpload(b2, objectKey, uploadId, upload.parts);
      versionId = head.versionId;
      if (head.status !== 200 || head.size !== upload.bytes || !ARCHIVE_VALUE_PATTERN.test(versionId)) {
        throw new Error(`B2 has ${head.size} of ${upload.bytes} bytes of the archive of server ${row.server_id}.`);
      }
      const wrapped = wrapArchiveKey(wrapSecret, archiveKey.identity, row.server_id, objectKey);
      const stored = this.#write(
        `INSERT INTO hosted_server_archives(object_key, server_id, region, bucket, version_id, size_bytes, sha256,
           wrapped_key, plan_ended_at, delete_after, created_at)
         SELECT ${literal(objectKey, OBJECT_KEY_PATTERN)}, server_id, '${ARCHIVE_REGION}', '${B2_BUCKET}',
           ${literal(versionId, ARCHIVE_VALUE_PATTERN)}, ${literal(upload.bytes)}, ${literal(upload.sha256, SHA256_PATTERN)},
           ${literal(wrapped, ARCHIVE_VALUE_PATTERN)}, plan_ended_at, plan_ended_at + ${literal(ARCHIVE_KEPT_MS)},
           ${literal(Date.now())}
         FROM hosted_servers WHERE server_id = ${server} AND operator_host = ${host} AND desired_state = 'stopped'
           AND plan_ended_at = ${literal(row.plan_ended_at)}`,
      );
      if (stored !== 1) {
        logger.warn(`Server ${row.server_id} changed during its archive. It stays on VPS ${machine.id}.`);
        return;
      }
      kept = true;
    } finally {
      if (versionId === "") await abortUpload(b2, objectKey, uploadId);
      else if (!kept) await deleteArchive(b2, objectKey, versionId).catch(() => undefined);
    }
    const released = this.#write(
      `UPDATE hosted_servers SET operator_host = NULL, updated_at = ${literal(Date.now())}
       WHERE server_id = ${server} AND operator_host = ${host} AND desired_state = 'stopped'`,
    );
    if (released !== 1) {
      logger.warn(`Server ${row.server_id} was renewed after its archive. It stays on VPS ${machine.id}.`);
      await this.#deleteStoredArchive({ object_key: objectKey, version_id: versionId, server_id: row.server_id });
      return;
    }
    this.#write(`UPDATE operator_hosts SET assign_token_hash = NULL, seen_at = NULL WHERE host_id = ${host}`);
    try {
      await this.#erase(machine);
    } catch (error) {
      throw new Error(
        `Server ${row.server_id} is in B2, but VPS ${machine.id} still has its data. Run prepare --reinstall for it.`,
        { cause: error },
      );
    }
    await this.#setReference(machine, POOL_REFERENCE);
    logger.info(`VPS ${machine.id} is free. Run prepare to offer it for a new server.`);
  }

  async #deleteStoredArchive(row: z.infer<typeof storedArchiveSchema>) {
    logger.info(`Delete the archive of server ${row.server_id} in B2.`);
    if (!this.#apply) return;
    const { b2 } = this.#archiveKeys();
    const answer = await deleteArchive(b2, row.object_key, row.version_id);
    if (!answer.deleted)
      throw new Error(`B2 answered ${answer.status} and keeps the archive of server ${row.server_id}.`);
    this.#write(
      `UPDATE hosted_server_archives SET deleted_at = ${literal(Date.now())}, wrapped_key = NULL
       WHERE object_key = ${literal(row.object_key, OBJECT_KEY_PATTERN)} AND deleted_at IS NULL`,
    );
  }

  async #erase(machine: Vps) {
    const oldKeys = this.#hostKeys(machine);
    if (oldKeys === "") throw new Error(`VPS ${machine.id} does not answer on SSH, so it is not reinstalled.`);
    const response = await this.#leaseweb(machine.key, `/${machine.id}/reinstall`, {
      method: "PUT",
      body: JSON.stringify({ imageId: IMAGE }),
    });
    if (!response.ok) throw new Error(`Leaseweb refused the reinstall of VPS ${machine.id}: ${response.status}.`);
    await this.#waitForReinstall(machine, oldKeys);
    this.#forgetHostKeys(machine);
  }

  async #waitForReinstall(machine: Vps, oldKeys: string) {
    const deadline = Date.now() + REINSTALL_WAIT_MS;
    while (Date.now() < deadline) {
      await delay(10_000);
      const keys = this.#hostKeys(machine);
      if (keys !== "" && keys !== oldKeys) return;
    }
    throw new Error(`VPS ${machine.id} did not finish its reinstall in ${REINSTALL_WAIT_MS / 60_000} minutes.`);
  }
  #forgetHostKeys(machine: Vps) {
    if (!machine.address) return;
    try {
      execFileSync("ssh-keygen", ["-R", machine.address], { stdio: "ignore" });
    } catch {}
  }
  #hostKeys(machine: Vps) {
    if (!machine.address) return "";
    try {
      const output = execFileSync("ssh-keyscan", ["-T", "10", machine.address], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => line.split(" ").slice(1).join(" "))
        .sort()
        .join("\n");
    } catch {
      return "";
    }
  }

  #remote(
    machine: Vps,
    command: string,
    options: { input?: string; capture?: boolean; quiet?: boolean; password?: string | undefined } = {},
  ) {
    if (!machine.address) throw new Error(`VPS ${machine.id} has no public IPv4 address.`);
    const args = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", "-o", "ConnectionAttempts=3"];
    args.push("-o", "ServerAliveInterval=15");
    const env = { ...process.env };
    const askpass = options.password === undefined ? undefined : mkdtempSync(join(tmpdir(), "openbot-askpass-"));
    if (askpass && options.password !== undefined) {
      writeFileSync(join(askpass, "password"), options.password, { mode: 0o600 });
      writeFileSync(join(askpass, "askpass"), `#!/bin/sh\nexec cat '${join(askpass, "password")}'\n`, { mode: 0o700 });
      Object.assign(env, { SSH_ASKPASS: join(askpass, "askpass"), SSH_ASKPASS_REQUIRE: "force", DISPLAY: "none" });
      args.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
      args.push("-o", "NumberOfPasswordPrompts=1");
    } else {
      args.push("-o", "BatchMode=yes");
    }
    try {
      const output = execFileSync("ssh", [...args, `root@${machine.address}`, command], {
        env,
        input: options.input,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: [
          options.input === undefined ? "ignore" : "pipe",
          options.capture ? "pipe" : "inherit",
          options.quiet ? "ignore" : "inherit",
        ],
      });
      return output ?? "";
    } finally {
      if (askpass) rmSync(askpass, { recursive: true, force: true });
    }
  }

  #machineState(machine: Vps): MachineState | null {
    let output: string;
    try {
      output = this.#remote(machine, MACHINE_STATE, { capture: true, quiet: true });
    } catch {
      return null;
    }
    const values = keyValues(output);
    return {
      version: values.get("version") ?? "",
      user: values.get("user") ?? "",
      ids: values.get("ids") ?? "",
      enabled: values.get("enabled") ?? "",
      data: values.get("data") !== "no",
      hostKey: values.get("hostkey") ?? "",
    };
  }

  async #freeMachine(id: string, product?: string) {
    const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
    const inPool = this.#rows(
      `SELECT host_id FROM operator_hosts WHERE host_id = ${host} AND removed_at IS NULL`,
      z.object({ host_id: z.string() }),
    );
    if (inPool.length === 0) throw new Error(`VPS ${id} is not in the pool. Add it first.`);
    const used = this.#rows(
      `SELECT server_id FROM hosted_servers WHERE operator_host = ${host}`,
      z.object({ server_id: z.string() }),
    );
    if (used[0]) throw new Error(`VPS ${id} has server ${used[0].server_id}. It is not free.`);
    const machine = await this.#vps(id);
    if (!isPoolReference(machine.reference))
      throw new Error(`VPS ${id} does not have the reference ${POOL_REFERENCE}.`);
    if (product && machine.product !== product) {
      throw new Error(`VPS ${id} is a ${machine.product}, and this plan needs a ${product}.`);
    }
    return machine;
  }

  async #release(): Promise<Release> {
    let body: unknown;
    try {
      body = JSON.parse(
        execFileSync("gh", ["api", "repos/nightly-labs/openbot/releases/latest"], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      const response = await fetch("https://api.github.com/repos/nightly-labs/openbot/releases/latest", {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for the newest release. Sign in to gh.`);
      body = await response.json();
    }
    const release = releaseSchema.parse(body);
    const version = release.tag_name.replace(/^v/u, "");
    const asset = release.assets.find((item) => item.name === `OpenBot-${version}-x86_64.AppImage`);
    const sha256 = asset?.digest?.replace(/^sha256:/u, "") ?? "";
    if (!VERSION_PATTERN.test(version) || !asset || !/^[0-9a-f]{64}$/u.test(sha256)) {
      throw new Error(`Release ${release.tag_name} has no x86_64 AppImage with a SHA-256.`);
    }
    if (!asset.browser_download_url.startsWith("https://github.com/nightly-labs/openbot/releases/download/")) {
      throw new Error(`The AppImage of release ${version} is not on the releases of the repository.`);
    }
    return { version, url: asset.browser_download_url, sha256 };
  }

  #operatorKeys() {
    this.#operatorKeysBase64 ??= this.#readOperatorKeys();
    return this.#operatorKeysBase64;
  }

  #readOperatorKeys() {
    const host = this.#operatorKeysHost;
    if (!host) throw new Error("OPERATOR_KEYS_HOST is not in the environment.");
    if (!OPERATOR_KEYS_HOST_PATTERN.test(host)) throw new Error("OPERATOR_KEYS_HOST is not <user>@<host>.");
    const fromCore = execFileSync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", host, "cat /root/.ssh/authorized_keys"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    const coreLines = keyLines(fromCore);
    if (coreLines.length === 0) throw new Error("The core server of the operators has no public key.");
    const fileLines = this.#operatorKeysFile ? keyLines(readFileSync(this.#operatorKeysFile, "utf8")) : [];
    const lines: string[] = [];
    for (const line of [...coreLines, ...fileLines]) {
      if (!OPERATOR_KEY_PATTERN.test(line)) {
        throw new Error(`Operator key ${lines.length + 1} is not a public key with no options.`);
      }
      if (!lines.some((listed) => keyBlob(listed) === keyBlob(line))) lines.push(line);
    }
    let own = "";
    try {
      own += execFileSync("ssh-add", ["-L"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {}
    const home = process.env.HOME ?? "";
    for (const name of ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]) {
      try {
        own += `\n${readFileSync(join(home, ".ssh", name), "utf8")}`;
      } catch {}
    }
    const ownBlobs = keyLines(own).map(keyBlob);
    if (!lines.some((line) => ownBlobs.includes(keyBlob(line)))) {
      throw new Error(
        "The operator keys have no key of this computer, so the script could not sign in after the bootstrap.",
      );
    }
    logger.info(`The bootstrap installs ${lines.length} operator keys.`);
    return Buffer.from(`${lines.join("\n")}\n`).toString("base64");
  }

  async #rootPassword(machine: Vps) {
    const response = await this.#leaseweb(machine.key, `/${machine.id}/credentials/OPERATING_SYSTEM/root`);
    if (!response.ok) throw new Error(`Leaseweb gave no root password for VPS ${machine.id}: ${response.status}.`);
    return z.object({ password: z.string().min(1) }).parse(await response.json()).password;
  }

  async #prepareMachine(machine: Vps, release: Release) {
    const keys = this.#operatorKeys();
    const password = this.#machineState(machine) === null ? await this.#rootPassword(machine) : undefined;
    if (password !== undefined)
      logger.info(`VPS ${machine.id} has no key of this computer. Sign in one time with the root password.`);
    const authApi = this.#testDatabase ? AUTH_API_URL.test : AUTH_API_URL.production;
    this.#remote(machine, "bash -s", { input: prepareScript(machine.id, release, authApi, keys), password });
    await this.#restartMachine(machine);
  }

  #upgradeMachine(machine: Vps, release: Release) {
    const authApi = this.#testDatabase ? AUTH_API_URL.test : AUTH_API_URL.production;
    this.#remote(machine, "bash -s", { input: upgradeScript(release, authApi) });
  }

  async #restartMachine(machine: Vps) {
    const bootId = "cat /proc/sys/kernel/random/boot_id";
    const before = this.#remote(machine, bootId, { capture: true }).trim();
    this.#remote(machine, "systemd-run --quiet --on-active=2 systemctl reboot");
    const deadline = Date.now() + REINSTALL_WAIT_MS;
    while (Date.now() < deadline) {
      await delay(5_000);
      try {
        const now = this.#remote(machine, bootId, { capture: true, quiet: true }).trim();
        if (now !== "" && now !== before) return;
      } catch {}
    }
    throw new Error(`VPS ${machine.id} did not start again in ${REINSTALL_WAIT_MS / 60_000} minutes.`);
  }

  #isReady(id: string) {
    const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
    return (
      this.#rows(
        `SELECT p.host_id FROM operator_hosts p WHERE p.host_id = ${host} AND p.removed_at IS NULL AND ${this.#readySql()}
           AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = p.host_id)`,
        z.object({ host_id: z.string() }),
      ).length > 0
    );
  }

  #withdrawOffer(id: string) {
    const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
    this.#write(
      `UPDATE operator_hosts SET assign_token_hash = NULL, seen_at = NULL
       WHERE host_id = ${host} AND NOT EXISTS(SELECT 1 FROM hosted_servers WHERE operator_host = ${host})`,
    );
    const used = this.#rows(
      `SELECT server_id FROM hosted_servers WHERE operator_host = ${host}`,
      z.object({ server_id: z.string() }),
    );
    if (used[0]) throw new Error(`The new server ${used[0].server_id} got VPS ${id} first. It is not free.`);
  }

  async #offer(machine: Vps) {
    const host = literal(`leaseweb:${machine.id}`, HOST_ID_PATTERN);
    const token = randomBytes(32).toString("base64url");
    const hash = literal(createHash("sha256").update(token).digest("base64url"), TOKEN_HASH_PATTERN);
    const changes = this.#write(
      `UPDATE operator_hosts SET assign_token_hash = ${hash}, seen_at = NULL
       WHERE host_id = ${host} AND removed_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM hosted_servers WHERE operator_host = ${host})`,
    );
    if (changes !== 1) throw new Error(`VPS ${machine.id} is not a free machine of the pool any more.`);
    try {
      this.#remote(machine, "bash -s", { input: hostingCopy() });
      this.#remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh offer leaseweb:${machine.id}`, {
        input: `${token}\n`,
      });
    } catch (error) {
      this.#write(
        `UPDATE operator_hosts SET assign_token_hash = NULL, seen_at = NULL
         WHERE host_id = ${host} AND assign_token_hash = ${hash}`,
      );
      throw error;
    }
    const deadline = Date.now() + OFFER_WAIT_MS;
    while (!this.#isReady(machine.id)) {
      if (Date.now() > deadline) {
        throw new Error(
          `VPS ${machine.id} has its token, and the account service did not get a question from it in ${OFFER_WAIT_MS / 60_000} minutes.`,
        );
      }
      await delay(5_000);
    }
  }

  async prepare(ids: string[], reinstall = false) {
    const release = await this.#release();
    for (const id of ids) {
      const machine = await this.#freeMachine(id);
      const state = this.#machineState(machine);
      const erase = Boolean(state?.user && state.data);
      const upgrade = Boolean(state?.user && !state.data && isOlder(state.version, release.version));
      if (erase && !reinstall) {
        logger.warn(
          `VPS ${id} is free and has the data of a server: a first start that failed, or a move that went back. ` +
            "It is not changed. Run prepare with --reinstall to erase its disk.",
        );
        continue;
      }
      if (erase) logger.info(`VPS ${id}: erase the disk, install OpenBot ${release.version}, and restart.`);
      else if (upgrade) logger.info(`VPS ${id}: install OpenBot ${release.version} over ${state?.version}.`);
      else if (state?.user) {
        if (this.#isReady(id)) {
          logger.info(`VPS ${id} has OpenBot ${state.version || "of no known version"} and is ready for a new server.`);
          continue;
        }
        logger.info(`VPS ${id} has OpenBot ${state.version || "of no known version"}. Offer it for a new server.`);
      } else logger.info(`VPS ${id}: install OpenBot ${release.version}, run the bootstrap, and restart.`);
      if (!this.#apply) continue;
      const started = Date.now();
      this.#withdrawOffer(id);
      if (erase) await this.#erase(machine);
      if (erase || !state?.user) await this.#prepareMachine(machine, release);
      else if (upgrade) this.#upgradeMachine(machine, release);
      await this.#offer(machine);
      logger.info(`VPS ${id} is prepared and ready for a new server in ${seconds(Date.now() - started)} s.`);
    }
    if (!this.#apply) logger.info("Nothing changed. Run again with --apply.");
  }

  #inPool(id: string) {
    const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
    return (
      this.#rows(
        `SELECT host_id FROM operator_hosts WHERE host_id = ${host} AND removed_at IS NULL`,
        z.object({ host_id: z.string() }),
      ).length > 0
    );
  }

  async #allReferences(eachAccount = true) {
    const missing = LEASEWEB_ACCOUNTS.filter(
      (account) => !this.#keys.some(({ name }) => name === `LEASEWEB_API_KEY_${account}`),
    );
    if (eachAccount && missing.length > 0)
      throw new Error(`The environment has no LEASEWEB_API_KEY_${missing.join(", _")}.`);
    const pageSchema = z.object({
      _metadata: z.object({ totalCount: z.number() }),
      vps: z.array(
        z.object({
          id: z.string(),
          reference: z.string().nullable(),
          state: z.string(),
          datacenter: z.string(),
          pack: z.string(),
          ips: z.array(ipSchema),
        }),
      ),
    });
    const references: {
      id: string;
      reference: string;
      account: string;
      state: string;
      location: string;
      product: string;
      address: string;
      key: string;
    }[] = [];
    for (const account of this.#keys) {
      for (let offset = 0; ; offset += 50) {
        const response = await this.#leaseweb(account.key, `?limit=50&offset=${offset}`, {}, 90_000);
        if (!response.ok) throw new Error(`Leaseweb answered ${response.status} for the VPS of ${account.name}.`);
        const page = pageSchema.parse(await response.json());
        for (const vps of page.vps)
          references.push({
            id: vps.id,
            reference: vps.reference ?? "",
            account: account.name.replace("LEASEWEB_API_KEY_", ""),
            state: vps.state,
            location: vps.datacenter,
            product: vps.pack,
            address: vps.ips.find((ip) => ip.version === 4 && ip.mainIp)?.ip ?? "",
            key: account.key,
          });
        if (page.vps.length === 0 || offset + page.vps.length >= page._metadata.totalCount) break;
      }
    }
    return references;
  }

  async free() {
    const free = (await this.#allReferences()).filter(({ reference }) => reference === "");
    if (free.length === 0) logger.info("No VPS on the five Leaseweb accounts is without a reference.");
    for (const vps of free)
      logger.info(
        `VPS ${vps.id} has no reference: account ${vps.account}, ${vps.location}, ${vps.product}, ${vps.state}, address ${vps.address || "none"}.`,
      );
  }

  async traffic(from: string | undefined, to: string | undefined) {
    const today = new Date().toISOString().slice(0, 10);
    const start = from ?? `${today.slice(0, 8)}01`;
    const end = to ?? today;
    const isDay = (day: string) =>
      DATE_PATTERN.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().startsWith(day);
    if (!isDay(start) || !isDay(end) || start > end)
      throw new Error("--from and --to must be days as YYYY-MM-DD, and --from must not be after --to.");
    const missing = LEASEWEB_ACCOUNTS.filter(
      (account) => !this.#keys.some(({ name }) => name === `LEASEWEB_API_KEY_${account}`),
    );
    if (missing.length > 0)
      logger.warn(`No key for the account ${missing.join(", ")}: its VPS are not in the traffic.`);
    const machines = await this.#allReferences(false);
    const rows: { vps: (typeof machines)[number]; down: number; up: number; pack: number | null }[] = [];
    let next = 0;
    let failed = false;
    const work = async () => {
      for (let index = next++; index < machines.length && !failed; index = next++) {
        const vps = machines[index];
        if (!vps) continue;
        const [detail, response] = await Promise.all([
          this.#leaseweb(vps.key, `/${vps.id}`, {}, 60_000),
          this.#leaseweb(
            vps.key,
            `/${vps.id}/metrics/datatraffic?from=${start}&to=${end}&granularity=DAY&aggregation=SUM`,
            {},
            60_000,
          ),
        ]).catch((error: unknown) => {
          failed = true;
          throw error;
        });
        if (!detail.ok || !response.ok) {
          failed = true;
          throw new Error(`Leaseweb answered ${detail.status} and ${response.status} for VPS ${vps.id}.`);
        }
        const pack = packBytes(contractSchema.parse(await detail.json()).contract?.dataTraffic);
        const summary = trafficSchema.parse(await response.json())._metadata.summary;
        rows.push({ vps, down: summary?.downPublic?.total ?? 0, up: summary?.upPublic?.total ?? 0, pack });
      }
    };
    await Promise.all(Array.from({ length: TRAFFIC_CONCURRENCY }, work));
    rows.sort((a, b) => b.down + b.up - (a.down + a.up) || a.vps.id.localeCompare(b.vps.id));
    logger.info(`Public traffic from ${start} to ${end} (UTC days), the most first:`);
    for (const { vps, down, up, pack: packSize } of rows) {
      const pack = packSize ? `, out is ${Math.round((up / packSize) * 100)}% of the ${packSize / 1e12} TB pack` : "";
      logger.info(
        `VPS ${vps.id} (${vps.account}, ${vps.location}, ${referenceLabel(vps.reference)}): in ${gigabytes(down)}, out ${gigabytes(up)}${pack}.`,
      );
    }
    for (const account of new Set(rows.map(({ vps }) => vps.account))) {
      const own = rows.filter(({ vps }) => vps.account === account);
      const down = own.reduce((sum, row) => sum + row.down, 0);
      const up = own.reduce((sum, row) => sum + row.up, 0);
      logger.info(`Account ${account}: ${own.length} VPS, in ${gigabytes(down)}, out ${gigabytes(up)}.`);
    }
  }

  async #nextCustomNumber() {
    let highest = 0;
    for (const { reference } of await this.#allReferences()) {
      const number = Number(CUSTOM_NUMBER_PATTERN.exec(reference)?.[1] ?? 0);
      if (number > highest) highest = number;
    }
    return String(highest + 1).padStart(2, "0");
  }

  #customState(machine: Vps, password?: string): CustomState | null {
    try {
      return toCustomState(
        this.#remote(machine, "bash -s", { input: CUSTOM_STATE, capture: true, quiet: true, password }),
      );
    } catch {
      return null;
    }
  }

  async #serverClaim(owner: string) {
    if (!this.#claimsToken) throw new Error("SERVER_CLAIMS_ADMIN_TOKEN is not in the environment.");
    const authApi = this.#testDatabase ? AUTH_API_URL.test : AUTH_API_URL.production;
    const response = await fetch(`${authApi}/v2/admin/server-claims`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#claimsToken}`, "content-type": "application/json" },
      body: JSON.stringify({ email: owner }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`The account service answered ${response.status} for the server claim.`);
    const { claim } = z.object({ claim: z.string().regex(CLAIM_PATTERN) }).parse(await response.json());
    return claim;
  }

  #checkOwner(owner: string, hosts: string[]) {
    const [user] = this.#rows(
      `SELECT id FROM users WHERE email = ${literal(owner, EMAIL_PATTERN)}`,
      z.object({ id: z.string().regex(ACCOUNT_ID_PATTERN) }),
    );
    if (!user) throw new Error("The owner has no account.");
    for (const host of hosts) {
      const hostId = literal(host, REMOTE_HOST_PATTERN);
      const [row] = this.#rows(
        `SELECT owner_user_id FROM remote_hosts WHERE host_id = ${hostId}`,
        z.object({ owner_user_id: z.string() }),
      );
      if (row?.owner_user_id !== user.id) continue;
      const [membership] = this.#rows(
        `SELECT role, status, removed_at FROM remote_memberships
         WHERE host_id = ${hostId} AND user_id = ${literal(user.id, ACCOUNT_ID_PATTERN)}`,
        z.object({ role: z.string(), status: z.string(), removed_at: z.number().nullable() }),
      );
      if (membership?.role === "owner" && membership.status === "active" && membership.removed_at === null) return host;
    }
    throw new Error("D1 shows no OpenBot server of this machine that the owner owns.");
  }

  async #waitOnline(machine: Vps) {
    const deadline = Date.now() + ONLINE_WAIT_MS;
    for (;;) {
      const state = this.#customState(machine);
      if (state?.online) return state;
      if (Date.now() > deadline) throw new Error(`OpenBot on VPS ${machine.id} is not online after 5 minutes.`);
      await delay(10_000);
    }
  }

  async custom(id: string, options: CustomOptions) {
    const owner = options.owner.toLowerCase();
    if (!EMAIL_PATTERN.test(owner)) throw new Error("Give the owner's email with --owner=<email>.");
    if (!CUSTOMER_PATTERN.test(options.customer)) {
      throw new Error("Give --customer=<word>: one word in small letters and digits.");
    }
    if (!SERVER_NAME_PATTERN.test(options.name)) {
      throw new Error("Give --name=<server name>: 6 to 32 letters, digits, spaces, '.', '_' or '-'.");
    }
    const keys = this.#operatorKeys();
    if (!this.#claimsToken) throw new Error("SERVER_CLAIMS_ADMIN_TOKEN is not in the environment.");
    if (this.#inPool(id)) throw new Error(`VPS ${id} is in the hosted pool. It is not for a custom server.`);

    let machine = await this.#vps(id);
    if (machine.state !== "RUNNING") throw new Error(`VPS ${id} is ${machine.state}, not RUNNING.`);
    const suffix = ` ${options.customer} ${owner}`;
    const resumed = machine.reference !== null && CUSTOM_NUMBER_PATTERN.test(machine.reference);
    if (machine.reference !== null && !(resumed && machine.reference.endsWith(suffix))) {
      throw new Error(`VPS ${id} has a reference. Take only a VPS with no reference.`);
    }
    const reference = machine.reference ?? `custom-${await this.#nextCustomNumber()}${suffix}`;
    const label = `${reference.split(" ")[0]} ${options.customer}`;
    if (!this.#apply) {
      logger.info(
        resumed
          ? `VPS ${id} is ${label} already. --apply continues its setup.`
          : `VPS ${id} would get the reference ${label} <owner>, the hostname lsw-${id}, OpenBot with a claim for the owner, the bootstrap, and a restart.`,
      );
      if (resumed) this.#showCustomState(machine, owner);
      logger.info("Nothing changed. Run again with --apply.");
      return;
    }

    if (!resumed) {
      await this.#setReference(machine, reference);
      machine = await this.#vps(id);
      if (machine.reference !== reference) throw new Error(`Another operator took VPS ${id}. Select another one.`);
      const number = CUSTOM_NUMBER_PATTERN.exec(reference)?.[1];
      const twins = (await this.#allReferences()).filter(
        (item) => item.id !== id && CUSTOM_NUMBER_PATTERN.exec(item.reference)?.[1] === number,
      );
      if (twins.length > 0) {
        await this.#setReference(machine, "");
        throw new Error(`VPS ${twins[0]?.id} took custom-${number} at the same time. Run the command again.`);
      }
      if (this.#inPool(id)) {
        throw new Error(`VPS ${id} went in the hosted pool at the same time. Check its reference by hand.`);
      }
      logger.info(`VPS ${id} has the reference ${label} <owner>.`);
      this.#forgetHostKeys(machine);
    }

    let password: string | undefined;
    let before = this.#customState(machine);
    if (before === null) {
      password = await this.#rootPassword(machine);
      before = this.#customState(machine, password);
      if (before === null) {
        throw new Error(
          `No key of this computer and not the root password sign in to VPS ${id}. Ask the operator who ran the bootstrap.`,
        );
      }
      logger.info(`VPS ${id} has no key of this computer. Sign in one time with the root password.`);
    }
    if (before.account !== "" && before.account !== owner) {
      throw new Error(`OpenBot on VPS ${id} is signed in to another account. Stop and check the server by hand.`);
    }

    const install = before.account === "";
    const hostname = `lsw-${id}`;
    const claim = install ? await this.#serverClaim(owner) : "";
    const authApi = this.#testDatabase ? ` --auth-api-url '${AUTH_API_URL.test}'` : "";
    const script = `${hostingCopy()}
hostnamectl set-hostname ${hostname}
${
  install
    ? `${writeFileCommand(`${MACHINE_HOSTING}/install-server.sh`, readFileSync(join(ROOT, "scripts/install-server.sh"), "utf8"))}
{ printf 'OPENBOT_CLAIM=%s\\n' '${claim}'; cat ${MACHINE_HOSTING}/install-server.sh; } | bash -s -- --name '${options.name}'${authApi} 2>&1 |
  sed -u 's/[^[:space:]]*@[^[:space:]]*/<email>/g'`
    : ""
}
bash ${MACHINE_HOSTING}/leaseweb-bootstrap.sh '${keys}'
`;
    logger.info(
      install
        ? `VPS ${id}: install OpenBot with a claim for the owner, then run the bootstrap.`
        : `VPS ${id}: OpenBot is signed in to the owner. Run the bootstrap again.`,
    );
    this.#remote(machine, "bash -s", { input: script, password });

    const restart = install || !before.bootstrapped || before.hostname !== hostname;
    logger.info(`VPS ${id}: check the bootstrap${restart ? " and restart the machine" : ""}.`);
    execFileSync(
      "bun",
      [
        join(HOSTING, "leaseweb-bootstrap-e2e.ts"),
        `--host=root@${machine.address}`,
        `--restart=${restart ? "yes" : "no"}`,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );

    const after = await this.#waitOnline(machine);
    if (after.account !== owner) throw new Error(`OpenBot on VPS ${id} is not signed in to the owner.`);
    const remoteHost = this.#checkOwner(owner, after.hosts);
    logger.info(
      `VPS ${id} is ${label}: OpenBot ${after.version}, online, server ${remoteHost} of the owner. Address ${machine.address}.`,
    );
  }

  #showCustomState(machine: Vps, owner: string) {
    const state = this.#customState(machine);
    if (state === null) {
      logger.info(`No key of this computer signs in to VPS ${machine.id}: the bootstrap did not run.`);
      return;
    }
    logger.info(
      `VPS ${machine.id}: hostname ${state.hostname}, bootstrap ${state.bootstrapped ? "done" : "not done"}, ` +
        `OpenBot ${state.version || "not running"}, ${signedIn(state, owner)}, ` +
        `${state.online ? "online" : "not online"}.`,
    );
  }

  async #boat(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (!this.#boatKey) throw new Error("BOAT_API_KEY is not in the environment.");
    const response = await fetch(`${BOAT_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#boatKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`boat answered ${response.status} for ${method} ${path}.`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async #sandbox(sandbox: string): Promise<Sandbox> {
    return sandboxSchema.parse(await this.#boat("GET", `/sandboxes/${sandbox}`));
  }

  async #waitForSandbox(sandbox: string, done: (value: Sandbox) => boolean, what: string) {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const value = await this.#sandbox(sandbox);
      if (done(value)) return value.state;
      await delay(3_000);
    }
    throw new Error(`Sandbox ${sandbox} did not ${what} in 10 minutes.`);
  }

  async #sandboxRun(sandbox: string, script: string, timeoutSeconds = 120) {
    const marker = `OPENBOT_OUTPUT_${randomBytes(12).toString("hex")}`;
    const command = `f=$(mktemp)
${writeFileCommand("$f", script).replace("'$f'", '"$f"')}printf '%s\\n' '${marker}'
sudo -n bash "$f"
status=$?
printf '\\n%s\\n' '${marker}'
rm -f "$f"
exit "$status"`;
    const result = commandSchema.parse(
      await this.#boat(
        "POST",
        `/sandboxes/${sandbox}/commands`,
        { command, timeoutSeconds },
        (timeoutSeconds + 30) * 1000,
      ),
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `A command in sandbox ${sandbox} failed with ${result.exitCode}: ${(result.stderr ?? "").slice(-2000)}`,
      );
    }
    return scriptOutput(result.stdout ?? "", marker, sandbox);
  }

  #moveCandidates(product: string, currency: string | null) {
    const locations: [string, ...string[]] =
      currency === "usd" || currency === "brl" ? ["WDC-02", "AMS-01"] : ["AMS-01"];
    return this.#rows(
      `SELECT p.host_id FROM operator_hosts p
       WHERE p.removed_at IS NULL AND p.product = ${literal(product, PRODUCT_PATTERN)}
         AND p.location IN (${locations.map((location) => literal(location, LOCATION_PATTERN)).join(", ")})
         AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = p.host_id)
       ORDER BY ${this.#readySql()} DESC, (p.location = ${literal(locations[0], LOCATION_PATTERN)}) DESC,
         p.added_at, p.host_id`,
      z.object({ host_id: z.string().regex(HOST_ID_PATTERN) }),
    ).map(({ host_id }) => host_id.replace("leaseweb:", ""));
  }

  async #firstFreeMachine(ids: readonly string[], product: string, named = false) {
    for (const id of ids) {
      try {
        const machine = await this.#freeMachine(id, product);
        if (!machine.address) throw new Error(`VPS ${id} has no public IPv4 address.`);
        return machine;
      } catch (error) {
        if (named) throw error;
        logger.warn(`VPS ${id} is not usable for the move.`, toLogValue(error));
      }
    }
    throw new Error(`The pool has no free ${product} for this server. Add a machine first.`);
  }

  async move(
    serverId: string,
    vpsArg: string,
    unitsMovedByHand: readonly string[] = [],
    dockerMovedByHand = false,
    foldersToCopy: readonly string[] = [],
  ) {
    if (!SERVER_ID_PATTERN.test(serverId)) throw new Error(`Not a server ID: ${serverId}`);
    for (const folder of foldersToCopy) {
      if (!movableFolder(folder)) throw new Error(`The move cannot copy ${folder}, so this server stays on boat.`);
    }
    const folderArgs = foldersToCopy.map((folder) => `'${folder}'`).join(" ");
    if (vpsArg !== "auto" && !VPS_ID_PATTERN.test(vpsArg)) throw new Error(`Not a VPS ID: ${vpsArg}`);
    const started = Date.now();
    let last = started;
    const lap = (step: string) => {
      const now = Date.now();
      logger.info(`${step}: ${seconds(now - last)} s (total ${seconds(now - started)} s).`);
      last = now;
    };
    const [row] = this.#rows(
      `SELECT h.plan, h.size, h.desired_state, h.observed_state, h.observed_error, h.provider_sandbox_id, h.operator_host,
         h.currency, u.email FROM hosted_servers h JOIN users u ON u.id = h.owner_user_id
       WHERE h.server_id = ${literal(serverId, SERVER_ID_PATTERN)}`,
      moveRowSchema,
    );
    if (!row) throw new Error(`There is no server ${serverId}.`);
    if (!isOneOf(BILLING_PLAN_IDS, row.plan)) {
      throw new Error(`Server ${serverId} has the plan ${row.plan}. No machine is set for this plan.`);
    }
    const product = PRODUCT_OF_PLAN[row.plan];
    const planSize = HOSTED_PLAN_SIZE[row.plan];
    if (row.desired_state !== "running" && row.desired_state !== "idle") {
      throw new Error(`Server ${serverId} is ${row.desired_state}. Move only a server that is running or idle.`);
    }
    if (row.operator_host !== null) throw new Error(`Server ${serverId} is on ${row.operator_host} already.`);
    const sandbox = row.provider_sandbox_id;
    if (!sandbox || !SANDBOX_PATTERN.test(sandbox)) throw new Error(`Server ${serverId} has no boat sandbox.`);
    const candidates = vpsArg === "auto" ? this.#moveCandidates(product, row.currency) : [vpsArg];
    let machine = await this.#firstFreeMachine(candidates, product, vpsArg !== "auto");
    let vpsId = machine.id;
    const release = await this.#release();
    let state = this.#machineState(machine);
    const before = await this.#sandbox(sandbox);
    if (before.stop?.status === "failing") {
      throw new Error(
        `boat cannot stop sandbox ${sandbox}: its stop is failing. Read stop.error of GET /sandboxes/${sandbox}, ` +
          "and repair the sandbox first. Nothing changed.",
      );
    }
    logger.info(
      `Move server ${serverId} (${row.plan}, ${row.desired_state}, sandbox ${before.state}) to VPS ${vpsId} ` +
        `(${machine.location} ${machine.product}, ${state?.user ? `OpenBot ${state.version}` : "not prepared"}).`,
    );
    if (!this.#apply) {
      logger.info("Nothing changed. Run again with --apply.");
      return;
    }
    for (;;) {
      if (!state?.user) this.#operatorKeys();
      try {
        this.#withdrawOffer(vpsId);
        break;
      } catch (error) {
        if (vpsArg !== "auto") throw error;
        logger.warn(`VPS ${vpsId} is not free any more. Select the next machine.`, toLogValue(error));
        machine = await this.#firstFreeMachine(candidates.slice(candidates.indexOf(vpsId) + 1), product);
        vpsId = machine.id;
        state = this.#machineState(machine);
        logger.info(`Move server ${serverId} to VPS ${vpsId} (${machine.location} ${machine.product}).`);
      }
    }

    if (!state?.user) {
      await this.#prepareMachine(machine, release);
      state = this.#machineState(machine);
    } else if (!state.data && isOlder(state.version, release.version)) {
      logger.info(`Install OpenBot ${release.version} over ${state.version}.`);
      this.#upgradeMachine(machine, release);
      state = this.#machineState(machine);
    } else {
      this.#remote(machine, "bash -s", {
        input: `${hostingCopy()}\nbash ${MACHINE_HOSTING}/move-from-boat.sh withdraw\n`,
      });
    }
    if (state?.user !== "user" || state.data || state.enabled === "enabled") {
      throw new Error(`VPS ${vpsId} is not a prepared machine with no data and with OpenBot disabled.`);
    }
    if (!/^ssh-ed25519 [A-Za-z0-9+/]+=*$/u.test(state.hostKey))
      throw new Error(`VPS ${vpsId} has no ed25519 host key.`);
    const machineState = state;
    lap("Machine prepared");

    const host = literal(`leaseweb:${vpsId}`, HOST_ID_PATTERN);
    const server = literal(serverId, SERVER_ID_PATTERN);
    const changes = this.#write(
      `UPDATE hosted_servers SET operator_host = ${host}, retired_sandbox_id = provider_sandbox_id,
         size = ${literal(planSize, STATE_PATTERN)},
         provider_sandbox_id = NULL, desired_state = 'running', observed_state = 'running', observed_error = NULL,
         updated_at = ${literal(Date.now())}
       WHERE server_id = ${server} AND provider_sandbox_id = ${literal(sandbox, SANDBOX_PATTERN)} AND operator_host IS NULL
         AND plan = ${literal(row.plan, STATE_PATTERN)} AND desired_state IN ('running', 'idle')`,
    );
    if (changes !== 1) throw new Error(`The row of server ${serverId} changed. Nothing moved.`);
    lap("Row written");

    let packages: string[];
    try {
      const sandboxState = (await this.#sandbox(sandbox)).state;
      if (!SANDBOX_USABLE.has(sandboxState)) {
        logger.info(`Sandbox ${sandbox} is ${sandboxState}. Start it.`);
        await this.#boat("POST", `/sandboxes/${sandbox}/resume`, { ttlSeconds: 7200 }, 120_000);
        await this.#waitForSandbox(sandbox, (value) => SANDBOX_USABLE.has(value.state), "start");
      } else {
        await this.#boat("PATCH", `/sandboxes/${sandbox}`, { ttlSeconds: 7200 });
      }
      const restoreDeadline = Date.now() + RESTORE_WAIT_MS;
      const restoring = `l=/var/lib/ascii-lazy
[ -e "$l/status.json" ] || exit 0
if [ -e "$l/active" ] && [ ! -e "$l/hydration-done" ]; then echo restoring; exit 0; fi
work() { python3 -I -c 'import json, sys; s = json.load(open(sys.argv[1])); q = s.get("engineQueues") or {}; print(s.get("materialized"), sum(v for v in q.values() if isinstance(v, int)))' "$l/status.json" 2>/dev/null || true; }
before=$(work)
timeout 60 find /home/user -xdev -printf '' 2>/dev/null || true
sleep 10
after=$(work)
# No status: there is nothing to wait for.
[ -z "$after" ] || { [ "$before" = "$after" ] && [ "\${after##* }" = 0 ]; } || echo restoring`;
      if ((await this.#sandboxRun(sandbox, restoring)).includes("restoring")) {
        logger.info(`boat restores the disk of sandbox ${sandbox}. Wait.`);
        do {
          if (Date.now() > restoreDeadline)
            throw new Error(`boat did not restore the disk of sandbox ${sandbox} in 30 minutes.`);
          await delay(15_000);
        } while ((await this.#sandboxRun(sandbox, restoring)).includes("restoring"));
        lap("Disk restored");
      }
      const output = await this.#sandboxRun(
        sandbox,
        `set -euo pipefail
d=${SANDBOX_MOVE}
rm -rf "$d"
install -d -m 0700 "$d"
${writeFileCommand(`${SANDBOX_MOVE}/move-from-boat.sh`, readFileSync(join(HOSTING, "move-from-boat.sh"), "utf8"))}
${writeFileCommand(`${SANDBOX_MOVE}/run-export.sh`, RUN_EXPORT)}
${writeFileCommand(`${SANDBOX_MOVE}/known-hosts`, `${machine.address} ${machineState.hostKey}\n`)}
ssh-keygen -q -t ed25519 -N '' -C openbot-move -f "$d/key" </dev/null
echo "key=$(cat "$d/key.pub")"
echo "ids=$(id -u user):$(id -g user)"
echo "version=$(sed -n 's/^X-AppImage-Version=//p' /opt/OpenBot/app/*.desktop | head -n 1)"
echo "containers=$(find /var/lib/docker/containers -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
if ids=$(docker ps -aq 2>/dev/null); then
  echo "docker_running=$(docker ps -q | wc -l)"
  restart=0
  [ -n "$ids" ] && restart=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' $ids | awk '$0 != "no" { n++ } END { print n + 0 }')
  echo "docker_restart=$restart"
fi
bash "$d/move-from-boat.sh" packages`,
        600,
      );
      const values = keyValues(output);
      packages = output.split("\n").filter((line) => /^apt=[a-z0-9][a-z0-9+.-]+$/u.test(line));
      const units = output
        .split("\n")
        .flatMap((line) => /^unit=([\w@.:-]+)$/u.exec(line)?.[1] ?? [])
        .filter((unit) => !unitsMovedByHand.includes(unit));
      if (units.length > 0) {
        throw new Error(
          `The sandbox has systemd units of the customer that the move does not copy: ${units.join(", ")}.`,
        );
      }
      const folders = output
        .split("\n")
        .flatMap((line) => /^folder=(\/\S.*)$/u.exec(line)?.[1] ?? [])
        .filter((folder) => !foldersToCopy.includes(folder));
      if (folders.length > 0) {
        throw new Error(
          `The sandbox has files of the customer in folders that the move does not copy: ${folders.join(", ")}. ` +
            "With --folders, the move copies /srv/<name>, /mnt/<name>, /media/<name> and a new top-level folder. " +
            "A server with another such folder stays on boat.",
        );
      }
      if (foldersToCopy.length > 0) {
        const present = this.#remote(
          machine,
          `for f in ${folderArgs}; do if [ -e "$f" ] || [ -L "$f" ]; then echo "$f"; fi; done`,
          { capture: true },
        ).trim();
        if (present !== "")
          throw new Error(`The machine has these folders already: ${present.split("\n").join(", ")}.`);
      }
      const containers = Number(values.get("containers") ?? "");
      if (!Number.isInteger(containers)) throw new Error("The sandbox did not count its Docker containers.");
      if (containers > 0 && !dockerMovedByHand) {
        throw new Error(
          `The sandbox has ${containers} Docker containers. The VPS has no Docker, and the move does not copy them.`,
        );
      }
      if (containers > 0) {
        const running = Number(values.get("docker_running") ?? "0");
        const restarting = Number(values.get("docker_restart") ?? "0");
        if (!Number.isInteger(running) || !Number.isInteger(restarting)) {
          throw new Error("The sandbox did not give the state of its Docker containers.");
        }
        if (running > 0 || restarting > 0) {
          throw new Error(
            `The sandbox has ${running} running Docker containers and ${restarting} with a restart policy other ` +
              "than no. Stop each container and set its restart policy to no before the move.",
          );
        }
        logger.warn(`The sandbox has ${containers} stopped Docker containers. An operator moves them by hand.`);
      }
      const sandboxVersion = values.get("version") ?? "";
      if (values.get("ids") !== machineState.ids) {
        throw new Error(
          `The user has the IDs ${values.get("ids")} in the sandbox and ${machineState.ids} on the machine.`,
        );
      }
      if (!VERSION_PATTERN.test(sandboxVersion) || isOlder(machineState.version, sandboxVersion)) {
        throw new Error(`The machine has OpenBot ${machineState.version}, and the sandbox has ${sandboxVersion}.`);
      }
      const key = values.get("key") ?? "";
      if (!/^ssh-ed25519 [A-Za-z0-9+/]+=* openbot-move$/u.test(key))
        throw new Error("The sandbox made no key for the move.");
      lap(`Sandbox ready (OpenBot ${sandboxVersion}, ${packages.length} apt packages)`);
      if (packages.length > 0) {
        this.#remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh install-packages`, {
          input: `${packages.join("\n")}\n`,
        });
        lap("Packages installed");
      }
      this.#remote(
        machine,
        "install -d -m 0700 /root/.ssh && touch /root/.ssh/authorized_keys && sed -i '/ openbot-move$/d' /root/.ssh/authorized_keys && cat >>/root/.ssh/authorized_keys",
        { input: `restrict,command="umask 077; cat >${MACHINE_ARCHIVE}" ${key}\n` },
      );
      await this.#sandboxRun(sandbox, `d=${SANDBOX_MOVE}\n${SANDBOX_SSH} "root@${machine.address}" </dev/null`);
      lap("SSH from the sandbox to the machine");
    } catch (error) {
      await this.#undoRow(serverId, vpsId, sandbox, row, machine);
      throw error;
    }

    const downtime = Date.now();
    try {
      await this.#sandboxRun(
        sandbox,
        `systemctl reset-failed openbot-move-export.service 2>/dev/null || true
systemd-run --quiet --collect --unit=openbot-move-export bash ${SANDBOX_MOVE}/run-export.sh ${machine.address} ${folderArgs}`,
      );
      const deadline = Date.now() + EXPORT_WAIT_MS;
      let status = "";
      let shown = Date.now();
      let leased = Date.now();
      let failures = 0;
      while (status === "" && Date.now() < deadline) {
        await delay(5_000);
        try {
          if (Date.now() - leased > 30 * 60_000) {
            await this.#boat("PATCH", `/sandboxes/${sandbox}`, { ttlSeconds: 7200 });
            leased = Date.now();
          }
          status = (await this.#sandboxRun(sandbox, `cat ${SANDBOX_MOVE}/status 2>/dev/null || true`)).trim();
          failures = 0;
        } catch (error) {
          failures += 1;
          if (failures >= 24) throw error;
          logger.warn("The status of the export is not available. Try again.", toLogValue(error));
          continue;
        }
        if (status === "" && Date.now() - shown > 30_000) {
          shown = Date.now();
          try {
            const size = this.#remote(machine, `stat -c %s ${MACHINE_ARCHIVE} 2>/dev/null || echo 0`, {
              capture: true,
              quiet: true,
            }).trim();
            logger.info(`Export: ${Math.round(Number(size) / 1e6)} MB on the machine.`);
          } catch {
            logger.warn("The size of the archive on the machine is not available.");
          }
        }
      }
      const log = await this.#sandboxRun(sandbox, `cat ${SANDBOX_MOVE}/export.log 2>/dev/null || true`);
      for (const line of log.split("\n").filter((item) => item !== "")) logger.info(`export: ${line}`);
      if (status !== "0")
        throw new Error(status === "" ? "The export did not end in 3 hours." : `The export failed with ${status}.`);
      this.#remote(machine, "sed -i '/ openbot-move$/d' /root/.ssh/authorized_keys");
      await this.#sandboxRun(sandbox, `rm -rf ${SANDBOX_MOVE}`);
      lap("Export and copy");

      await this.#boat("POST", `/sandboxes/${sandbox}/stop`, {});
      this.#remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh import ${MACHINE_ARCHIVE} ${folderArgs}`);
      lap("Import");
      const stopped = await this.#waitForSandbox(
        sandbox,
        (value) => {
          if (value.stop?.status === "failing")
            throw new Error(`boat cannot stop sandbox ${sandbox}: its stop is failing.`);
          return value.state === "archived";
        },
        "stop",
      );
      lap(`Sandbox ${stopped}`);
      this.#remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh start && rm -f ${MACHINE_ARCHIVE}`);
      let active = "";
      for (let attempt = 0; attempt < 30 && active !== "active"; attempt += 1) {
        if (attempt > 0) await delay(2_000);
        active = this.#remote(machine, "systemctl is-active openbot.service || true", { capture: true }).trim();
      }
      if (active !== "active") throw new Error(`openbot.service is ${active} on VPS ${vpsId} after 60 s.`);
      lap("OpenBot started");
    } catch (error) {
      try {
        this.#remote(machine, "sed -i '/ openbot-move$/d' /root/.ssh/authorized_keys 2>/dev/null || true", {
          quiet: true,
        });
      } catch {
        logger.warn(`Remove the openbot-move line of /root/.ssh/authorized_keys on VPS ${vpsId} by hand.`);
      }
      logger.error(
        `The move of server ${serverId} stopped after the export started. OpenBot is stopped in sandbox ${sandbox}, and the row names VPS ${vpsId}. ` +
          `Read the error, then finish the move by hand or roll it back (docs/hosted-servers.md#move-a-server-from-boat). ` +
          `Delete ${MACHINE_ARCHIVE} on the machine and ${SANDBOX_MOVE} in the sandbox.`,
      );
      throw error;
    }
    logger.info(`Downtime: ${seconds(Date.now() - downtime)} s.`);
    await this.#setReference(machine, `${row.email} ${serverId.slice(0, 8)}`);
    logger.info(
      `Server ${serverId} runs on VPS ${vpsId}. Check in a client that the server is online and that an agent answers.`,
    );
  }

  async #undoRow(serverId: string, vpsId: string, sandbox: string, row: z.infer<typeof moveRowSchema>, machine: Vps) {
    try {
      this.#remote(machine, "sed -i '/ openbot-move$/d' /root/.ssh/authorized_keys 2>/dev/null || true", {
        quiet: true,
      });
      await this.#sandboxRun(sandbox, `rm -rf ${SANDBOX_MOVE}`);
    } catch (error) {
      logger.warn(`Remove ${SANDBOX_MOVE} in sandbox ${sandbox} by hand.`, toLogValue(error));
    }
    const error =
      row.observed_error !== null && STATE_PATTERN.test(row.observed_error) ? `'${row.observed_error}'` : "NULL";
    const changes = this.#write(
      `UPDATE hosted_servers SET provider_sandbox_id = retired_sandbox_id, retired_sandbox_id = NULL, operator_host = NULL,
         size = ${literal(row.size, STATE_PATTERN)},
         desired_state = ${literal(row.desired_state, STATE_PATTERN)}, observed_state = ${literal(row.observed_state, STATE_PATTERN)},
         observed_error = ${error}, updated_at = ${literal(Date.now())}
       WHERE server_id = ${literal(serverId, SERVER_ID_PATTERN)} AND operator_host = ${literal(`leaseweb:${vpsId}`, HOST_ID_PATTERN)}
         AND retired_sandbox_id = ${literal(sandbox, SANDBOX_PATTERN)} AND desired_state = 'running'`,
    );
    logger.warn(
      changes === 1
        ? `The move stopped before the export. The row names sandbox ${sandbox} again, and the customer did not see a downtime.`
        : `The move stopped before the export, and the row of server ${serverId} changed. Roll it back by hand.`,
    );
  }
}

const USAGE =
  "Usage: leaseweb-pool.ts status | boat | free | traffic [--from=<YYYY-MM-DD>] [--to=<YYYY-MM-DD>] | add <VPS ID>... | remove <VPS ID>... | sync | prepare <VPS ID>... [--keys=<file>] [--reinstall] | move <server ID> <VPS ID | auto> [--keys=<file>] [--units=<unit>,...] [--docker] [--folders=<folder>,...] | custom <VPS ID> --owner=<email> --customer=<word> --name=<server name> [--keys=<file>] [--apply] [--env=test]";

async function main(args: string[]) {
  const [command, ...operands] = args.filter((arg) => !arg.startsWith("--"));
  const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const keys = option("keys");
  const pool = new Pool(args.includes("--apply"), args.includes("--env=test"), process.env, keys);
  if (command === "status") pool.status();
  else if (command === "boat") pool.boat();
  else if (command === "free") await pool.free();
  else if (command === "traffic") await pool.traffic(option("from"), option("to"));
  else if (command === "add" && operands.length > 0) await pool.add(operands);
  else if (command === "remove" && operands.length > 0) pool.remove(operands);
  else if (command === "sync") await pool.sync();
  else if (command === "prepare" && operands.length > 0) await pool.prepare(operands, args.includes("--reinstall"));
  else if (command === "move" && operands.length === 2 && operands[0] && operands[1])
    await pool.move(
      operands[0],
      operands[1],
      option("units")?.split(",").filter(Boolean),
      args.includes("--docker"),
      option("folders")
        ?.split(",")
        .map((folder) => folder.replace(/(?<=.)\/+$/u, ""))
        .filter(Boolean),
    );
  else if (command === "custom" && operands.length === 1 && operands[0])
    await pool.custom(operands[0], {
      owner: option("owner") ?? "",
      customer: option("customer") ?? "",
      name: option("name") ?? "",
    });
  else throw new Error(USAGE);
}

if (import.meta.main) {
  void main(process.argv.slice(2)).catch((error) => {
    logger.error("The pool command failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
