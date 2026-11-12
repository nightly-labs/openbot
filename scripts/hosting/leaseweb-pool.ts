// The operator side of the pool of Leaseweb machines for hosted servers
// (docs/hosted-servers.md#reuse-a-pool-machine). The Worker writes what each server must do
// (`desired_state`), and deletes a server 30 days after its plan ends. This script does the rest, on the
// machines and in D1:
//
//   bun scripts/hosting/leaseweb-pool.ts status
//       Read only. The machines of each location and product, and the work that `sync` does.
//   bun scripts/hosting/leaseweb-pool.ts add <VPS ID>... [--apply]
//       Adds machines to the pool, with the location and the product from the Leaseweb API. A machine
//       with no reference gets `pool-free`.
//   bun scripts/hosting/leaseweb-pool.ts remove <VPS ID>... [--apply]
//       Takes free machines out of the pool, before their Leaseweb contract ends.
//   bun scripts/hosting/leaseweb-pool.ts sync [--apply]
//       Stops OpenBot on each machine whose plan ended, starts it on each renewed one, and reinstalls each
//       machine whose server is deleted. Then it writes the result in D1. A reinstall erases the disk.
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
import { resolve } from "node:path";
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

  constructor(apply: boolean, testDatabase: boolean, environment: NodeJS.ProcessEnv) {
    this.#apply = apply;
    this.#testDatabase = testDatabase;
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

  #leaseweb(key: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${LEASEWEB_API}${path}`, {
      ...init,
      headers: { "X-LSW-Auth": key, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  }

  /** The machine now, from the Leaseweb account that has it. */
  async #vps(id: string): Promise<Vps> {
    if (!VPS_ID_PATTERN.test(id)) throw new Error(`Not a VPS ID: ${id}`);
    const known = this.#found.get(id);
    const accounts = known ? this.#keys.filter(({ key }) => key === known.key) : this.#keys;
    for (const account of accounts) {
      const response = await this.#leaseweb(account.key, `/${id}`);
      // A key that Leaseweb refuses (401) must not stop the work on the machines of the other accounts.
      if (response.status === 401 || response.status === 403 || response.status === 404) continue;
      if (!response.ok) throw new Error(`Leaseweb answered ${response.status} for VPS ${id} (${account.name}).`);
      const machine = toVps(await response.json(), account.key);
      this.#found.set(id, machine);
      return machine;
    }
    throw new Error(`No Leaseweb key in the environment has VPS ${id}.`);
  }

  async #setReference(machine: Vps, reference: string) {
    const response = await this.#leaseweb(machine.key, `/${machine.id}`, {
      method: "PUT",
      body: JSON.stringify({ reference }),
    });
    if (!response.ok) throw new Error(`Leaseweb refused the reference of VPS ${machine.id}: ${response.status}.`);
  }

  #ssh(machine: Vps, remoteCommand: string) {
    if (!machine.address) throw new Error(`VPS ${machine.id} has no public IPv4 address.`);
    // A machine of the pool is new to this computer, or has new host keys after its reinstall
    // (`#reinstall` removes the old ones), so ssh accepts a key that it does not know.
    execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=20",
        `root@${machine.address}`,
        remoteCommand,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
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
      if (machine.reference === null) await this.#setReference(machine, POOL_FREE);
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
    this.#ssh(machine, `systemctl ${state === "stopped" ? "disable" : "enable"} --now openbot.service`);
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
}

const USAGE = "Usage: leaseweb-pool.ts status | add <VPS ID>... | remove <VPS ID>... | sync [--apply] [--env=test]";

async function main(args: string[]) {
  const [command, ...operands] = args.filter((arg) => !arg.startsWith("--"));
  const pool = new Pool(args.includes("--apply"), args.includes("--env=test"), process.env);
  if (command === "status") pool.status();
  else if (command === "add" && operands.length > 0) await pool.add(operands);
  else if (command === "remove" && operands.length > 0) pool.remove(operands);
  else if (command === "sync") await pool.sync();
  else throw new Error(USAGE);
}

if (import.meta.main) {
  void main(process.argv.slice(2)).catch((error) => {
    logger.error("The pool command failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
