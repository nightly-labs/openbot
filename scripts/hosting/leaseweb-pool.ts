// The operator side of the pool of Leaseweb machines for hosted servers
// (docs/hosted-servers.md#reuse-a-pool-machine). The Worker writes what each server must do
// (`desired_state`), and deletes a server 30 days after its plan ends. This script does the rest, on the
// machines and in D1:
//
//   bun scripts/hosting/leaseweb-pool.ts status
//       Read only. The machines of each location and product, and the work that `sync` does.
//   bun scripts/hosting/leaseweb-pool.ts free
//       Read only. Each VPS with no reference on the four Leaseweb accounts, such as a VPS just bought.
//   bun scripts/hosting/leaseweb-pool.ts add <VPS ID>... [--apply]
//       Adds machines to the pool, with the location and the product from the Leaseweb API. A machine
//       with no reference gets `pool-free`.
//   bun scripts/hosting/leaseweb-pool.ts remove <VPS ID>... [--apply]
//       Takes free machines out of the pool, before their Leaseweb contract ends.
//   bun scripts/hosting/leaseweb-pool.ts sync [--apply]
//       Stops OpenBot on each machine whose plan ended, starts it on each renewed one, and reinstalls each
//       machine whose server is deleted. Then it writes the result in D1. A reinstall erases the disk.
//   bun scripts/hosting/leaseweb-pool.ts prepare <VPS ID>... --keys=<file> [--apply]
//       Installs the newest release, disabled, on free machines of the pool, and runs
//       leaseweb-bootstrap.sh with the public keys of the operators in <file>. Then it restarts each
//       machine. A new or reinstalled machine has no key: the script then signs in one time with the
//       root password of the Leaseweb API.
//   bun scripts/hosting/leaseweb-pool.ts move <server ID> <VPS ID> [--keys=<file>] [--apply]
//       Moves one Standard or Pro server from its boat sandbox to a free machine of the pool, as
//       docs/hosted-servers.md#move-a-server-from-boat says. It prepares the machine when it is not
//       prepared (then `--keys` is necessary). It needs `BOAT_API_KEY`.
//   bun scripts/hosting/leaseweb-pool.ts custom <VPS ID> --owner=<email> --customer=<word> \
//       --name=<server name> --keys=<file> [--apply]
//       Sets up a VPS with no reference as the server of one customer, not in the pool
//       (docs/hosted-servers.md#leaseweb-vps): the next `custom-<NN>` reference, the hostname, OpenBot
//       signed in with a server claim for the owner, the bootstrap, a restart, and the checks. It needs
//       `SERVER_CLAIMS_ADMIN_TOKEN` and the key of each Leaseweb account. A second run continues a run
//       that stopped.
//
// With no `--apply`, the script only shows what it would do. `--env=test` uses the D1 of the test Worker.
// Each Leaseweb account has its own key; the script tries each `LEASEWEB_API_KEY_<ACCOUNT>` of the
// environment. D1 goes through Wrangler, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` or a
// `wrangler login`. On a computer of the operator:
//
//   bunx dotenvx run -f apps/auth-api/.env.production -fk <root>/.env.keys -- \
//     bun scripts/hosting/leaseweb-pool.ts status
//
// The output has machine and server IDs only: no email and no key.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";

const logger = createOpenBotLogger("leaseweb-pool");
const AUTH_API = resolve(import.meta.dirname, "../../apps/auth-api");
const LEASEWEB_API = "https://api.leaseweb.com/publicCloud/v1/vps";
const POOL_FREE = "pool-free";
const IMAGE = "UBUNTU_26_04_64BIT";
const REINSTALL_WAIT_MS = 15 * 60_000;
const VPS_ID_PATTERN = /^\d{1,20}$/u;
const HOST_ID_PATTERN = /^leaseweb:\d{1,20}$/u;
/** The pattern of `HostedServerService`: `billing-service.ts`. */
const SERVER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const LOCATION_PATTERN = /^[A-Z]{3}-\d{2}$/u;
const PRODUCT_PATTERN = /^VPS\d{2}$/u;
const HOSTING = resolve(import.meta.dirname);
const BOAT_API = "https://boat.dev/api/v1";
// The states in which the sandbox runs, as `isUsable` in apps/auth-api/src/server/hosted-server-service.ts.
// `idle` is a machine that runs no command of the API; `running` is one that does.
const SANDBOX_USABLE = new Set(["ready", "idle", "running"]);
const SANDBOX_PATTERN = /^bx_[a-z0-9]{4,40}$/u;
const STATE_PATTERN = /^[a-z_]{1,32}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
/** The machine of each plan that moves. Starter servers stay on boat. */
const PRODUCT_OF_PLAN: Record<string, string> = { standard: "VPS02", pro: "VPS03" };
const AUTH_API_URL = {
  production: "https://api.openbot.run",
  test: "https://openbot-auth-api-test.internal9671.workers.dev",
};
/** The directory of the move in the sandbox, of root. It holds the key to the machine for the export. */
const SANDBOX_MOVE = "/root/openbot-move";
/** The copy of scripts/hosting on the machine. */
const MACHINE_HOSTING = "/root/openbot-hosting";
const MACHINE_ARCHIVE = "/root/openbot-move.tar";
const EXPORT_WAIT_MS = 3 * 60 * 60_000;
/** Each Leaseweb account. `custom` reads all of them, so that a `custom-<NN>` number is never used again. */
const LEASEWEB_ACCOUNTS = ["NL", "DE", "US", "AU"];
const CUSTOM_NUMBER_PATTERN = /^custom-(\d{2,}) /u;
const CUSTOMER_PATTERN = /^[a-z0-9]{1,32}$/u;
// No quote and no space, so that the email can go in a D1 literal and in a reference.
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/u;
// The server name of `openbot name`: 6 to 32 characters. Only characters that need no shell quote.
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{4,30}[A-Za-z0-9.]$/u;
const CLAIM_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const REMOTE_HOST_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;
const ONLINE_WAIT_MS = 5 * 60_000;
const ROOT = resolve(HOSTING, "../..");

/** A SQL literal of a checked value. Wrangler takes no bound values, so each text must match a pattern. */
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

/** With `--json`, Wrangler writes a failed query as this object on its output. */
const wranglerErrorSchema = z.object({
  error: z.object({ text: z.string(), notes: z.array(z.object({ text: z.string() })).default([]) }),
});

/** Runs one statement on the D1 of the Worker. */
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

const moveRowSchema = z.object({
  plan: z.string(),
  desired_state: z.string(),
  observed_state: z.string().regex(STATE_PATTERN),
  observed_error: z.string().nullable(),
  provider_sandbox_id: z.string().nullable(),
  operator_host: z.string().nullable(),
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
// boat answers with the sandbox, or with `{ sandbox }` (apps/auth-api/src/server/boat-client.ts).
const sandboxSchema = z.union([
  z.object({ sandbox: z.object({ state: z.string() }) }).transform((value) => value.sandbox),
  z.object({ state: z.string() }),
]);
const commandSchema = z.object({
  // null when the command did not end in its time.
  exitCode: z.number().nullable(),
  stdout: z.string().nullish(),
  stderr: z.string().nullish(),
});

/**
 * The state of a machine, from `MACHINE_STATE`. `user` is the service user of an install of OpenBot,
 * and `data` tells if the machine has the data of a server.
 */
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
if [ -e /home/user/.config/OpenBot ] || [ -e /srv/openbot-hosted/keyrings ]; then echo data=yes; else echo data=no; fi
echo "hostkey=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`;

/**
 * The state of a custom server, for `bash -s`. `account` is the `Account:` line of `openbot status`,
 * and `hosts` the OpenBot server IDs of the team server state. The output has the email of the
 * owner: never write it in a log.
 */
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
  /** The email of the signed-in account, in small letters, or "" when no account is signed in. */
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
    // `Server: <name> (online)`, or `Server: online` with no name.
    online: /(^| \()online\)?$/u.test(values.get("server") ?? ""),
    hosts: (values.get("hosts") ?? "").split(",").filter((host) => REMOTE_HOST_PATTERN.test(host)),
  };
}

interface CustomOptions {
  owner: string;
  customer: string;
  name: string;
}

/** The ssh of the sandbox to the machine, with the key of the move. `$d` is the move directory. */
const SANDBOX_SSH = `ssh -i "$d/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \\
  -o UserKnownHostsFile="$d/known-hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15`;

/** Runs in the sandbox as root. Sends the archive to the machine; the key of the move can only write it there. */
const RUN_EXPORT = `#!/bin/bash
set -o pipefail
d=${SANDBOX_MOVE}
bash "$d/move-from-boat.sh" export - 2>"$d/export.log" | ${SANDBOX_SSH} "root@$1"
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

/** True when version `a` is older than version `b`. */
function isOlder(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}

/** A shell text that writes `content` to `path`, with no quote problem. */
function writeFileCommand(path: string, content: string) {
  return `base64 -d >'${path}' <<'OPENBOT_FILE'\n${Buffer.from(content).toString("base64")}\nOPENBOT_FILE\n`;
}

function seconds(milliseconds: number) {
  return Math.round(milliseconds / 1000);
}

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
  readonly #boatKey: string | undefined;
  readonly #claimsToken: string | undefined;

  constructor(
    apply: boolean,
    testDatabase: boolean,
    environment: NodeJS.ProcessEnv,
    operatorKeysFile: string | undefined = undefined,
  ) {
    this.#apply = apply;
    this.#testDatabase = testDatabase;
    this.#operatorKeysFile = operatorKeysFile;
    this.#boatKey = environment.BOAT_API_KEY || undefined;
    this.#claimsToken = environment.SERVER_CLAIMS_ADMIN_TOKEN || undefined;
    this.#keys = Object.entries(environment).flatMap(([name, key]) =>
      /^LEASEWEB_API_KEY_[A-Z]+$/u.test(name) && key ? [{ name, key }] : [],
    );
  }

  #rows<Row>(sql: string, schema: z.ZodType<Row>): Row[] {
    return z.array(schema).parse(d1Statement(sql, this.#testDatabase).results);
  }

  /** The number of rows that a write changed: 0 when another writer changed the row first. */
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

  /** The machine now, from the Leaseweb account that has it. */
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
        // The API of one account can be slow (2026-11-12): the VPS can be on another account.
        if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
        slow.push(account.name);
        continue;
      }
      // A key that Leaseweb refuses (401) must not stop the work on the machines of the other accounts.
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
      stop: query("desired_state = 'stopped' AND observed_state NOT IN ('stopped', 'deleted')"),
      start: query("desired_state = 'running' AND observed_state NOT IN ('running', 'deleted')"),
      reinstall: query("desired_state = 'deleted' AND observed_state = 'deleted'"),
    };
  }

  status() {
    const groups = this.#rows(
      `SELECT p.location, p.product, COUNT(*) AS machines, SUM(h.server_id IS NULL) AS free
       FROM operator_hosts p LEFT JOIN hosted_servers h ON h.operator_host = p.host_id
       WHERE p.removed_at IS NULL GROUP BY p.location, p.product ORDER BY p.location, p.product`,
      z.object({ location: z.string(), product: z.string(), machines: z.number(), free: z.number() }),
    );
    if (groups.length === 0) logger.info("The pool has no machine.");
    for (const group of groups) {
      logger.info(`${group.location} ${group.product}: ${group.free} free of ${group.machines}.`);
    }
    const work = this.#work();
    for (const [action, rows] of Object.entries(work)) {
      for (const row of rows) logger.info(`sync would ${action} ${row.operator_host} (server ${row.server_id}).`);
    }
    if (Object.values(work).every((rows) => rows.length === 0)) logger.info("sync has no work.");
  }

  async add(ids: string[]) {
    for (const id of ids) {
      const machine = await this.#vps(id);
      logger.info(`VPS ${id}: ${machine.location} ${machine.product}, reference ${machine.reference ?? "none"}.`);
      if (machine.reference !== null && machine.reference !== POOL_FREE) {
        logger.warn(`VPS ${id} has a reference that is not ${POOL_FREE}. Make sure that it is free, then set it.`);
        continue;
      }
      if (!this.#apply) continue;
      if (machine.reference === null) {
        await this.#setReference(machine, POOL_FREE);
        // `custom` can take the same VPS at the same time: the reference read again tells who has it.
        if ((await this.#vps(id)).reference !== POOL_FREE) {
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
        `UPDATE operator_hosts SET removed_at = ${literal(Date.now())}
         WHERE host_id = ${host} AND removed_at IS NULL
           AND NOT EXISTS(SELECT 1 FROM hosted_servers WHERE operator_host = ${host})`,
      );
      logger.info(changes === 1 ? `VPS ${id} left the pool.` : `VPS ${id} did not change.`);
    }
  }

  async sync() {
    const work = this.#work();
    // One machine that does not answer must not stop the work on the other machines.
    let failed = 0;
    const each = async (row: WorkRow, task: (row: WorkRow) => Promise<void>) => {
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
    if (!this.#apply) logger.info("Nothing changed. Run again with --apply.");
    if (failed > 0) throw new Error(`${failed} machines failed. Run sync again.`);
  }

  /** Stops or starts OpenBot on the machine, then records the state that the Worker asked for. */
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
    // The owner changed the plan during the SSH command. The next sync does the new work.
    if (changes === 0) logger.warn(`Server ${row.server_id} changed. Run sync again.`);
  }

  async #reinstall(row: WorkRow) {
    const host = literal(row.operator_host, HOST_ID_PATTERN);
    // Only a machine of the pool is erased: a mistyped row must not reinstall another machine.
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
    // Without the keys before the reinstall, the wait cannot tell the new system from the old one.
    const oldKeys = this.#hostKeys(machine);
    if (oldKeys === "") throw new Error(`VPS ${machine.id} does not answer on SSH, so it is not reinstalled.`);
    const response = await this.#leaseweb(machine.key, `/${machine.id}/reinstall`, {
      method: "PUT",
      body: JSON.stringify({ imageId: IMAGE }),
    });
    if (!response.ok) throw new Error(`Leaseweb refused the reinstall of VPS ${machine.id}: ${response.status}.`);
    await this.#waitForReinstall(machine, oldKeys);
    this.#forgetHostKeys(machine);
    await this.#setReference(machine, POOL_FREE);
    const changes = this.#write(
      `UPDATE hosted_servers SET operator_host = NULL, updated_at = ${literal(Date.now())}
       WHERE server_id = ${literal(row.server_id, SERVER_ID_PATTERN)} AND operator_host = ${host}
         AND observed_state = 'deleted'`,
    );
    logger.info(changes === 1 ? `VPS ${machine.id} is free.` : `The row of server ${row.server_id} changed.`);
  }

  /**
   * Leaseweb shows `RUNNING` for the whole reinstall (smoke of 2026-11-11), so the state does not tell when
   * it ends. The new system makes new SSH host keys: the reinstall is done when the machine shows keys that
   * differ from the keys before it.
   */
  async #waitForReinstall(machine: Vps, oldKeys: string) {
    const deadline = Date.now() + REINSTALL_WAIT_MS;
    while (Date.now() < deadline) {
      await delay(10_000);
      const keys = this.#hostKeys(machine);
      if (keys !== "" && keys !== oldKeys) return;
    }
    throw new Error(`VPS ${machine.id} did not finish its reinstall in ${REINSTALL_WAIT_MS / 60_000} minutes.`);
  }
  /** Removes the old host keys of the machine from `known_hosts`, so that the next `#ssh` accepts the new ones. */
  #forgetHostKeys(machine: Vps) {
    if (!machine.address) return;
    try {
      execFileSync("ssh-keygen", ["-R", machine.address], { stdio: "ignore" });
    } catch {
      // No `known_hosts` file: there is no old key to remove.
    }
  }
  /** The SSH host keys of the machine, or an empty text when SSH does not answer. */
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

  /**
   * Runs a command on the machine as root. With `password`, ssh signs in with the root password through
   * SSH_ASKPASS: the password goes in a file of this user for the time of the command, never on a
   * command line. `quiet` hides the messages of ssh, for a wait.
   */
  #remote(
    machine: Vps,
    command: string,
    options: { input?: string; capture?: boolean; quiet?: boolean; password?: string | undefined } = {},
  ) {
    if (!machine.address) throw new Error(`VPS ${machine.id} has no public IPv4 address.`);
    const args = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15"];
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

  /** The machine as root with a key, or null when no key of this computer signs in. */
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

  /** A machine of the pool that no server has, with the reference `pool-free`, and of `product` when given. */
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
    if (machine.reference !== POOL_FREE) throw new Error(`VPS ${id} does not have the reference ${POOL_FREE}.`);
    if (product && machine.product !== product) {
      throw new Error(`VPS ${id} is a ${machine.product}, and this plan needs a ${product}.`);
    }
    return machine;
  }

  /** The newest release of OpenBot, with the SHA-256 that GitHub calculated for its AppImage. */
  async #release(): Promise<Release> {
    // GitHub refuses many calls with no sign-in from one address, so `gh` signs the call when it can.
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

  /**
   * The public keys of the operators, as the base64 argument of leaseweb-bootstrap.sh. One key of this
   * computer must be in the list: the bootstrap turns off the password, and the script then signs in
   * with a key.
   */
  #operatorKeys() {
    if (!this.#operatorKeysFile) throw new Error("Give the public keys of the operators with --keys=<file>.");
    const text = readFileSync(this.#operatorKeysFile, "utf8");
    const blobs = (lines: string) =>
      lines
        .split("\n")
        .map((line) => line.trim().split(/\s+/u)[1] ?? "")
        .filter((blob) => blob !== "");
    const listed = blobs(text);
    if (listed.length === 0) throw new Error(`${this.#operatorKeysFile} has no public key.`);
    let own = "";
    try {
      own += execFileSync("ssh-add", ["-L"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // No agent, or an agent with no key.
    }
    const home = process.env.HOME ?? "";
    for (const name of ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]) {
      try {
        own += `\n${readFileSync(join(home, ".ssh", name), "utf8")}`;
      } catch {
        // This computer has no key of this type.
      }
    }
    if (!blobs(own).some((blob) => listed.includes(blob))) {
      throw new Error(
        `${this.#operatorKeysFile} has no key of this computer, so the script could not sign in after the bootstrap.`,
      );
    }
    return Buffer.from(text).toString("base64");
  }

  /** The root password of a new or reinstalled machine, which has no key of an operator. */
  async #rootPassword(machine: Vps) {
    const response = await this.#leaseweb(machine.key, `/${machine.id}/credentials/OPERATING_SYSTEM/root`);
    if (!response.ok) throw new Error(`Leaseweb gave no root password for VPS ${machine.id}: ${response.status}.`);
    return z.object({ password: z.string().min(1) }).parse(await response.json()).password;
  }

  /** A shell text that puts the current scripts/hosting in MACHINE_HOSTING. The files have no secret. */
  #hostingCopy() {
    const archive = execFileSync("tar", ["-czf", "-", "--exclude=*.ts", "-C", resolve(HOSTING, ".."), "hosting"], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return `set -euo pipefail
rm -rf ${MACHINE_HOSTING}
install -d -m 0700 ${MACHINE_HOSTING}
base64 -d <<'OPENBOT_HOSTING' | tar -xz --no-same-owner --strip-components=1 -C ${MACHINE_HOSTING}
${archive.toString("base64")}
OPENBOT_HOSTING
`;
  }

  /**
   * Installs `release` on a free machine, disabled, runs the bootstrap with the operator keys, and
   * restarts the machine. The service user gets the IDs 1000:1000 of the boat image; `move` compares
   * them with the sandbox before it changes the row.
   */
  async #prepareMachine(machine: Vps, release: Release) {
    const keys = this.#operatorKeys();
    const password = this.#machineState(machine) === null ? await this.#rootPassword(machine) : undefined;
    if (password !== undefined)
      logger.info(`VPS ${machine.id} has no key of this computer. Sign in one time with the root password.`);
    const authApi = this.#testDatabase ? AUTH_API_URL.test : AUTH_API_URL.production;
    const script = `${this.#hostingCopy()}
bash ${MACHINE_HOSTING}/move-from-boat.sh prepare lsw-${machine.id} 1000 1000 '${release.url}' ${release.sha256} '${authApi}'
bash ${MACHINE_HOSTING}/leaseweb-bootstrap.sh '${keys}'
`;
    this.#remote(machine, "bash -s", { input: script, password });
    await this.#restartMachine(machine);
  }

  /** Installs a newer release on a prepared machine with no data. A disabled OpenBot does not update. */
  #upgradeMachine(machine: Vps, release: Release) {
    const authApi = this.#testDatabase ? AUTH_API_URL.test : AUTH_API_URL.production;
    const script = `${this.#hostingCopy()}
bash ${MACHINE_HOSTING}/move-from-boat.sh upgrade '${release.url}' ${release.sha256} '${authApi}'
`;
    this.#remote(machine, "bash -s", { input: script });
  }

  /** Restarts the machine one time after the bootstrap, as the docs say, and waits for the new boot. */
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
      } catch {
        // The machine restarts.
      }
    }
    throw new Error(`VPS ${machine.id} did not start again in ${REINSTALL_WAIT_MS / 60_000} minutes.`);
  }

  async prepare(ids: string[]) {
    const release = await this.#release();
    for (const id of ids) {
      const machine = await this.#freeMachine(id);
      const state = this.#machineState(machine);
      if (state?.user) {
        if (state.data || !isOlder(state.version, release.version)) {
          logger.info(`VPS ${id} has OpenBot ${state.version || "of no known version"} already.`);
        } else {
          logger.info(`VPS ${id}: install OpenBot ${release.version} over ${state.version}.`);
          if (this.#apply) this.#upgradeMachine(machine, release);
        }
        continue;
      }
      logger.info(`VPS ${id}: install OpenBot ${release.version}, run the bootstrap, and restart.`);
      if (!this.#apply) continue;
      const started = Date.now();
      await this.#prepareMachine(machine, release);
      logger.info(`VPS ${id} is prepared in ${seconds(Date.now() - started)} s.`);
    }
    if (!this.#apply) logger.info("Nothing changed. Run again with --apply.");
  }

  /** True when the hosted pool has the VPS. A pool machine is never a custom server. */
  #inPool(id: string) {
    const host = literal(`leaseweb:${id}`, HOST_ID_PATTERN);
    return (
      this.#rows(
        `SELECT host_id FROM operator_hosts WHERE host_id = ${host} AND removed_at IS NULL`,
        z.object({ host_id: z.string() }),
      ).length > 0
    );
  }

  /**
   * The references of all VPS on all Leaseweb accounts. Each account must answer: a missing account
   * could hide the highest `custom-<NN>`, and a number must never be used again.
   */
  async #allReferences() {
    const missing = LEASEWEB_ACCOUNTS.filter(
      (account) => !this.#keys.some(({ name }) => name === `LEASEWEB_API_KEY_${account}`),
    );
    if (missing.length > 0) throw new Error(`The environment has no LEASEWEB_API_KEY_${missing.join(", _")}.`);
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
    }[] = [];
    for (const account of this.#keys) {
      for (let offset = 0; ; offset += 50) {
        // The list of the US and AU accounts can take more than 30 seconds (2026-11-12).
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
          });
        if (page.vps.length === 0 || offset + page.vps.length >= page._metadata.totalCount) break;
      }
    }
    return references;
  }

  /** Read only. Each VPS with no reference on all accounts: a new VPS that an operator can take. */
  async free() {
    const free = (await this.#allReferences()).filter(({ reference }) => reference === "");
    if (free.length === 0) logger.info("No VPS on the four Leaseweb accounts is without a reference.");
    for (const vps of free)
      logger.info(
        `VPS ${vps.id} has no reference: account ${vps.account}, ${vps.location}, ${vps.product}, ${vps.state}, address ${vps.address || "none"}.`,
      );
  }

  /** The next `custom-<NN>`: one more than the highest number on all accounts. */
  async #nextCustomNumber() {
    let highest = 0;
    for (const { reference } of await this.#allReferences()) {
      const number = Number(CUSTOM_NUMBER_PATTERN.exec(reference)?.[1] ?? 0);
      if (number > highest) highest = number;
    }
    return String(highest + 1).padStart(2, "0");
  }

  /** The state of a custom server, with a key of this computer, else with `password`. Null when neither signs in. */
  #customState(machine: Vps, password?: string): CustomState | null {
    try {
      return toCustomState(
        this.#remote(machine, "bash -s", { input: CUSTOM_STATE, capture: true, quiet: true, password }),
      );
    } catch {
      return null;
    }
  }

  /** A one-time claim for `owner` (docs/self-hosted-server.md#sign-in-with-a-server-claim). It works for 15 minutes. */
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

  /** Checks in D1 that `owner` owns one OpenBot server of the machine, with an active owner membership. */
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

  /** Waits until `openbot status` shows the server online. */
  async #waitOnline(machine: Vps) {
    const deadline = Date.now() + ONLINE_WAIT_MS;
    for (;;) {
      const state = this.#customState(machine);
      if (state?.online) return state;
      if (Date.now() > deadline) throw new Error(`OpenBot on VPS ${machine.id} is not online after 5 minutes.`);
      await delay(10_000);
    }
  }

  /**
   * Sets up a VPS with no reference as a custom server of one customer, as
   * docs/hosted-servers.md#leaseweb-vps says. The customer is the owner: the server signs in with a
   * server claim for the owner's email. A second run continues the work of a run that stopped.
   */
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
    // A reference that this command set: the run continues the work of a run that stopped.
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
      // `add` can take the same VPS at the same time: it reads the reference again before its D1 row.
      if (this.#inPool(id)) {
        throw new Error(`VPS ${id} went in the hosted pool at the same time. Check its reference by hand.`);
      }
      logger.info(`VPS ${id} has the reference ${label} <owner>.`);
      // A new VPS can have the address of a deleted one, with other host keys.
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
    const script = `${this.#hostingCopy()}
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

    // `openbot login` and `openbot status` show the email, so the install output goes through sed, and
    // pipefail keeps the exit code of the install.
    // A new bootstrap writes GRUB again, and a new hostname needs a new start of OpenBot.
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

  /** Shows the state of a custom server with a key of this computer, with no email. */
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

  async #sandboxState(sandbox: string) {
    return sandboxSchema.parse(await this.#boat("GET", `/sandboxes/${sandbox}`)).state;
  }

  /** Waits until `done` accepts the state of the sandbox. */
  async #waitForSandbox(sandbox: string, done: (state: string) => boolean, what: string) {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const state = await this.#sandboxState(sandbox);
      if (done(state)) return state;
      await delay(3_000);
    }
    throw new Error(`Sandbox ${sandbox} did not ${what} in 10 minutes.`);
  }

  /**
   * Runs a script as root in the sandbox and returns its output. The script goes in a file first, so it
   * does not read the standard input of the command.
   */
  async #sandboxRun(sandbox: string, script: string, timeoutSeconds = 120) {
    const command = `f=$(mktemp)
${writeFileCommand("$f", script).replace("'$f'", '"$f"')}sudo -n bash "$f"
status=$?
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
    return result.stdout ?? "";
  }

  async move(serverId: string, vpsId: string) {
    if (!SERVER_ID_PATTERN.test(serverId)) throw new Error(`Not a server ID: ${serverId}`);
    const started = Date.now();
    let last = started;
    const lap = (step: string) => {
      const now = Date.now();
      logger.info(`${step}: ${seconds(now - last)} s (total ${seconds(now - started)} s).`);
      last = now;
    };
    const [row] = this.#rows(
      `SELECT h.plan, h.desired_state, h.observed_state, h.observed_error, h.provider_sandbox_id, h.operator_host,
         u.email FROM hosted_servers h JOIN users u ON u.id = h.owner_user_id
       WHERE h.server_id = ${literal(serverId, SERVER_ID_PATTERN)}`,
      moveRowSchema,
    );
    if (!row) throw new Error(`There is no server ${serverId}.`);
    const product = PRODUCT_OF_PLAN[row.plan];
    if (!product) throw new Error(`Server ${serverId} has the plan ${row.plan}. Only Standard and Pro servers move.`);
    if (row.desired_state !== "running" && row.desired_state !== "idle") {
      throw new Error(`Server ${serverId} is ${row.desired_state}. Move only a server that is running or idle.`);
    }
    if (row.operator_host !== null) throw new Error(`Server ${serverId} is on ${row.operator_host} already.`);
    const sandbox = row.provider_sandbox_id;
    if (!sandbox || !SANDBOX_PATTERN.test(sandbox)) throw new Error(`Server ${serverId} has no boat sandbox.`);
    const machine = await this.#freeMachine(vpsId, product);
    if (!machine.address) throw new Error(`VPS ${vpsId} has no public IPv4 address.`);
    const release = await this.#release();
    let state = this.#machineState(machine);
    logger.info(
      `Move server ${serverId} (${row.plan}, ${row.desired_state}, sandbox ${await this.#sandboxState(sandbox)}) to VPS ${vpsId} ` +
        `(${machine.location} ${machine.product}, ${state?.user ? `OpenBot ${state.version}` : "not prepared"}).`,
    );
    if (!this.#apply) {
      logger.info("Nothing changed. Run again with --apply.");
      return;
    }

    // 1. The machine, while the customer still uses the sandbox.
    if (!state?.user) {
      await this.#prepareMachine(machine, release);
      state = this.#machineState(machine);
    } else if (!state.data && isOlder(state.version, release.version)) {
      logger.info(`Install OpenBot ${release.version} over ${state.version}.`);
      this.#upgradeMachine(machine, release);
      state = this.#machineState(machine);
    } else {
      this.#remote(machine, "bash -s", { input: this.#hostingCopy() });
    }
    if (state?.user !== "user" || state.data || state.enabled === "enabled") {
      throw new Error(`VPS ${vpsId} is not a prepared machine with no data and with OpenBot disabled.`);
    }
    if (!/^ssh-ed25519 [A-Za-z0-9+/]+=*$/u.test(state.hostKey))
      throw new Error(`VPS ${vpsId} has no ed25519 host key.`);
    const machineState = state;
    lap("Machine prepared");

    // 2. The row. From here the Worker sends no call to boat for the server.
    const host = literal(`leaseweb:${vpsId}`, HOST_ID_PATTERN);
    const server = literal(serverId, SERVER_ID_PATTERN);
    const changes = this.#write(
      `UPDATE hosted_servers SET operator_host = ${host}, retired_sandbox_id = provider_sandbox_id,
         provider_sandbox_id = NULL, desired_state = 'running', observed_state = 'running', observed_error = NULL,
         updated_at = ${literal(Date.now())}
       WHERE server_id = ${server} AND provider_sandbox_id = ${literal(sandbox, SANDBOX_PATTERN)} AND operator_host IS NULL
         AND plan IN ('standard', 'pro') AND desired_state IN ('running', 'idle')`,
    );
    if (changes !== 1) throw new Error(`The row of server ${serverId} changed. Nothing moved.`);
    lap("Row written");

    // 3. Before the downtime: the sandbox runs, the move files are in it, and the machine has its packages.
    let packages: string[];
    try {
      const sandboxState = await this.#sandboxState(sandbox);
      if (!SANDBOX_USABLE.has(sandboxState)) {
        logger.info(`Sandbox ${sandbox} is ${sandboxState}. Start it.`);
        await this.#boat("POST", `/sandboxes/${sandbox}/resume`, { ttlSeconds: 7200 }, 120_000);
        await this.#waitForSandbox(sandbox, (value) => SANDBOX_USABLE.has(value), "start");
      } else {
        // The Worker does not extend the lease any more. boat would stop the sandbox at its end.
        await this.#boat("PATCH", `/sandboxes/${sandbox}`, { ttlSeconds: 7200 });
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
bash "$d/move-from-boat.sh" packages`,
      );
      const values = keyValues(output);
      packages = output.split("\n").filter((line) => /^apt=[a-z0-9][a-z0-9+.-]+$/u.test(line));
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
      // The key of the sandbox can only write the archive, and goes away after the export.
      this.#remote(
        machine,
        "install -d -m 0700 /root/.ssh && touch /root/.ssh/authorized_keys && sed -i '/ openbot-move$/d' /root/.ssh/authorized_keys && cat >>/root/.ssh/authorized_keys",
        { input: `restrict,command="umask 077; cat >${MACHINE_ARCHIVE}" ${key}\n` },
      );
      // An ssh that fails after the export starts makes a downtime. This one writes an empty archive.
      await this.#sandboxRun(sandbox, `d=${SANDBOX_MOVE}\n${SANDBOX_SSH} "root@${machine.address}" </dev/null`);
      lap("SSH from the sandbox to the machine");
    } catch (error) {
      await this.#undoRow(serverId, vpsId, sandbox, row, machine);
      throw error;
    }

    // 4. The downtime: export from the sandbox, straight to the machine.
    const downtime = Date.now();
    try {
      await this.#sandboxRun(
        sandbox,
        `systemctl reset-failed openbot-move-export.service 2>/dev/null || true
systemd-run --quiet --collect --unit=openbot-move-export bash ${SANDBOX_MOVE}/run-export.sh ${machine.address}`,
      );
      const deadline = Date.now() + EXPORT_WAIT_MS;
      let status = "";
      let shown = Date.now();
      let leased = Date.now();
      let failures = 0;
      while (status === "" && Date.now() < deadline) {
        await delay(5_000);
        // The lease of 2 hours is shorter than the longest export. boat would stop the sandbox at its end.
        // A failed call does not stop the export, so try again; stop only after 2 minutes of failures.
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
          // Only a progress line: a failed read must not stop the move.
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

      // 5. The sandbox stops while the machine imports. The export stopped OpenBot in the sandbox, and
      // `archiving` is a machine that boat saves and that runs nothing, so OpenBot can then start here.
      await this.#boat("POST", `/sandboxes/${sandbox}/stop`, {});
      this.#remote(machine, `bash ${MACHINE_HOSTING}/move-from-boat.sh import ${MACHINE_ARCHIVE}`);
      lap("Import");
      const stopped = await this.#waitForSandbox(
        sandbox,
        (value) => value === "archiving" || value === "archived",
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
      // The key of the sandbox must not write to the machine after a failure. An agent can get root there.
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
    // The reference names the owner, for the Leaseweb panel. It is not in the log.
    await this.#setReference(machine, `${row.email} ${serverId.slice(0, 8)}`);
    logger.info(
      `Server ${serverId} runs on VPS ${vpsId}. Check in a client that the server is online and that an agent answers.`,
    );
  }

  /** Gives the row back to the sandbox after a failure before the export. The sandbox still has the data. */
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
  "Usage: leaseweb-pool.ts status | free | add <VPS ID>... | remove <VPS ID>... | sync | prepare <VPS ID>... --keys=<file> | move <server ID> <VPS ID> [--keys=<file>] | custom <VPS ID> --owner=<email> --customer=<word> --name=<server name> --keys=<file> [--apply] [--env=test]";

async function main(args: string[]) {
  const [command, ...operands] = args.filter((arg) => !arg.startsWith("--"));
  const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const keys = option("keys");
  const pool = new Pool(args.includes("--apply"), args.includes("--env=test"), process.env, keys);
  if (command === "status") pool.status();
  else if (command === "free") await pool.free();
  else if (command === "add" && operands.length > 0) await pool.add(operands);
  else if (command === "remove" && operands.length > 0) pool.remove(operands);
  else if (command === "sync") await pool.sync();
  else if (command === "prepare" && operands.length > 0) await pool.prepare(operands);
  else if (command === "move" && operands.length === 2 && operands[0] && operands[1])
    await pool.move(operands[0], operands[1]);
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
