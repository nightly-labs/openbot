/**
 * End-to-end check of the active-site limits against a local account Worker. Each scenario gets its own
 * account with a session, registered servers with machine tokens, and the license, plan and custom-limit
 * rows that it needs, written into the local D1. The sites are real: the script creates, uploads and
 * activates them through `/v1/sites`, as a server does. Local development data only.
 *
 *   bun scripts/hosted-site-limits-e2e.ts --api http://127.0.0.1:<port> [scenario ...]
 *
 * Start the Worker with `bun run dev:api`, and pass the port that it reports. The report goes to
 * `.openbot-build/hosted-site-limits-e2e.json`.
 *
 * - `free-pool`: an account with no license shares 1 site between its servers with no plan. The
 *   unlinked bucket stays separate.
 * - `license-pool`: a Team license of 2 users shares 6 sites between two servers. A third user gives 3
 *   more. A license that lapses or ends gives the free pool again, and no site is deleted.
 * - `server-plan`: a server with a Starter plan has its own 3 sites outside the pool.
 * - `custom-limit`: a server with a custom row has its own limit, outside the pool and the account cap.
 * - `race`: two creates at the same time for the last slot of the pool. Exactly one succeeds.
 * - `account-cap`: an account with 300 active sites gets no more on its pool or plan servers, but its
 *   custom-limit server still gets sites.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTED_SITE_HOST_ID_HEADER, HOSTED_SITE_HOST_TOKEN_HEADER } from "@openbot/contracts/hosted-sites";
import { z } from "zod";
import { developmentChildEnvironment } from "./development-environment";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, ".openbot-build", "hosted-site-limits-e2e.json");
const DAY = 86_400_000;
const SCENARIOS = ["free-pool", "license-pool", "server-plan", "custom-limit", "race", "account-cap"] as const;
type Scenario = (typeof SCENARIOS)[number];

const d1ResultSchema = z.array(z.object({ results: z.array(z.unknown()) }));
const listSchema = z.object({
  sites: z.array(z.object({ id: z.string(), status: z.string(), serverId: z.string().nullable() })),
  limit: z.number(),
  used: z.number(),
  limitReason: z.enum(["shared", "account"]).optional(),
});
const uploadSchema = z.object({ uploadId: z.string(), site: z.object({ id: z.string() }) });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

function d1<T>(sql: string, schema: z.ZodType<T>): T[] {
  const result = spawnSync(
    join(ROOT, "node_modules/.bin/wrangler"),
    ["d1", "execute", "openbot-auth", "--local", "--json", "--command", sql],
    { cwd: join(ROOT, "apps/auth-api"), encoding: "utf8", env: developmentChildEnvironment(process.env, "app") },
  );
  if (result.status !== 0) {
    const detail = result.stderr?.slice(0, 400) || result.error?.message || `exit ${String(result.status)}`;
    throw new Error(`D1 failed: ${detail}`);
  }
  return d1ResultSchema
    .parse(JSON.parse(result.stdout))
    .flatMap((entry) => entry.results)
    .map((row) => schema.parse(row));
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

interface Step {
  scenario: Scenario;
  step: string;
  result: "pass" | "fail";
  detail: string;
}
const steps: Step[] = [];

function print(line: string) {
  process.stdout.write(`${line}\n`);
}

function record(scenario: Scenario, step: string, passed: boolean, detail: string) {
  steps.push({ scenario, step, result: passed ? "pass" : "fail", detail });
  print(`${passed ? "PASS" : "FAIL"} ${scenario}: ${step} (${detail})`);
}

/** A server that the account registered. `null` is the unlinked bucket of a desktop. */
interface Server {
  id: string;
  token: string;
}

type Publish = { ok: true; siteId: string } | { ok: false; status: number; code: string; message: string };

class Account {
  readonly token = randomBytes(24).toString("base64url");
  readonly id: string;

  constructor(
    readonly scenario: Scenario,
    readonly api: string,
  ) {
    this.id = `e2e-site-limits-${scenario}`;
  }

  setUp(): this {
    this.clear();
    const now = Date.now();
    const id = quote(this.id);
    d1(
      [
        `INSERT INTO users(id, identity_key, email, name, created_at, updated_at)
         VALUES (${id}, ${quote(`e2e:${this.id}`)}, ${quote(`${this.id}@example.com`)}, 'Site limits e2e', ${now}, ${now})`,
        `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
         VALUES (${quote(crypto.randomUUID())}, ${id}, ${quote(hash(this.token))}, ${now + DAY}, ${now}, ${now})`,
      ].join("; "),
      z.unknown(),
    );
    return this;
  }

  /** Deletes the account and every row that it owns. The local R2 objects stay. */
  clear() {
    const id = quote(this.id);
    d1(
      [
        `DELETE FROM site_hostname_reservations WHERE hostname IN (SELECT hostname FROM hosted_sites WHERE user_id = ${id})`,
        `DELETE FROM site_deployments WHERE user_id = ${id}`,
        `DELETE FROM hosted_sites WHERE user_id = ${id}`,
        `DELETE FROM site_creation_events WHERE user_id = ${id}`,
        `DELETE FROM server_site_limits WHERE owner_user_id = ${id}`,
        `DELETE FROM billing_subscriptions WHERE user_id = ${id}`,
        `DELETE FROM licenses WHERE user_id = ${id}`,
        `DELETE FROM remote_hosts WHERE owner_user_id = ${id}`,
        `DELETE FROM auth_sessions WHERE user_id = ${id}`,
        `DELETE FROM users WHERE id = ${id}`,
      ].join("; "),
      z.unknown(),
    );
  }

  /** A self-hosted server with a machine token, as registration makes it. */
  addServer(name: string): Server {
    const now = Date.now();
    const server = { id: `${this.id}-${name}`, token: randomBytes(24).toString("base64url") };
    d1(
      `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, created_at, updated_at)
       VALUES (${quote(server.id)}, ${quote(this.id)}, ${quote(name)}, ${quote(hash(server.token))}, ${now}, ${now})`,
      z.unknown(),
    );
    return server;
  }

  /** Sets the account's one license. A status other than `active` stands for a lapsed or ended license. */
  setLicense(users: number, status: "active" | "past_due" | "canceled", periodEnd: number) {
    const now = Date.now();
    d1(
      `DELETE FROM licenses WHERE user_id = ${quote(this.id)};
       INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status,
         current_period_end, updated_at, tier, billing_interval)
       VALUES (${quote(`sub_${this.id}`)}, ${quote(this.id)}, ${quote(`cus_${this.id}`)}, ${users}, 'eur',
         ${quote(status)}, ${periodEnd}, ${now}, 'team', 'month')`,
      z.unknown(),
    );
  }

  setPlan(server: Server, plan: "starter" | "standard" | "pro") {
    const now = Date.now();
    d1(
      `INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan,
         interval, currency, amount, status, current_period_end, updated_at)
       VALUES (${quote(`sub_${server.id}`)}, ${quote(this.id)}, ${quote(`cus_${this.id}`)}, ${quote(server.id)},
         ${quote(plan)}, 'month', 'eur', 1000, 'active', ${now + 30 * DAY}, ${now})`,
      z.unknown(),
    );
  }

  setCustomLimit(server: Server, limit: number) {
    const now = Date.now();
    d1(
      `INSERT INTO server_site_limits(server_id, owner_user_id, site_limit, created_at, updated_at)
       VALUES (${quote(server.id)}, ${quote(this.id)}, ${limit}, ${now}, ${now})
       ON CONFLICT(server_id) DO UPDATE SET site_limit = excluded.site_limit, updated_at = excluded.updated_at`,
      z.unknown(),
    );
  }

  /** Writes active sites directly, to fill a bucket past the creation rate limit. */
  insertActiveSites(server: Server, count: number) {
    const now = Date.now();
    const rows = Array.from({ length: count }, (_, index) => {
      const siteId = crypto.randomUUID();
      return `(${quote(siteId)}, ${quote(this.id)}, ${quote(server.id)}, ${quote(`e2e-cap-${index}-${siteId.slice(0, 8)}`)},
        'Filler', '', 'vanilla', 0, 'active', ${now}, ${now})`;
    });
    for (let start = 0; start < rows.length; start += 100) {
      d1(
        `INSERT INTO hosted_sites(id, user_id, server_id, hostname, title, description, framework, spa_fallback,
           status, created_at, updated_at) VALUES ${rows.slice(start, start + 100).join(", ")}`,
        z.unknown(),
      );
    }
  }

  private headers(server: Server | null, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, ...extra };
    if (server) {
      headers[HOSTED_SITE_HOST_ID_HEADER] = server.id;
      headers[HOSTED_SITE_HOST_TOKEN_HEADER] = server.token;
    }
    return headers;
  }

  async list(server: Server | null) {
    const response = await fetch(`${this.api}/v1/sites/${server ? "" : "?scope=unlinked"}`, {
      headers: this.headers(server),
    });
    if (!response.ok) throw new Error(`The list failed: ${response.status} ${await response.text()}`);
    return listSchema.parse(await response.json());
  }

  /** Starts an upload. A refusal returns its code; the upload is left for `finish`. */
  async start(server: Server | null) {
    const body = "<!doctype html><title>e2e</title>";
    const response = await fetch(`${this.api}/v1/sites/`, {
      method: "POST",
      headers: this.headers(server, {
        "Content-Type": "application/json",
        "Idempotency-Key": `e2e-${crypto.randomUUID()}`,
      }),
      body: JSON.stringify({
        title: "Site limits e2e",
        description: "A site that checks the limits",
        framework: "vanilla",
        spaFallback: false,
        files: [{ path: "index.html", size: Buffer.byteLength(body), mimeType: "text/html" }],
      }),
    });
    const json = z.unknown().parse(await response.json());
    if (response.status === 201) return { ok: true as const, upload: uploadSchema.parse(json), body };
    const { error } = errorSchema.parse(json);
    return { ok: false as const, status: response.status, code: error.code, message: error.message };
  }

  async finish(upload: z.infer<typeof uploadSchema>, body: string): Promise<Publish> {
    const put = await fetch(`${this.api}/v1/sites/uploads/${upload.uploadId}/file?path=index.html`, {
      method: "PUT",
      headers: this.headers(null, { "Content-Type": "text/html", "Content-Length": String(Buffer.byteLength(body)) }),
      body,
    });
    if (!put.ok) throw new Error(`The file upload failed: ${put.status} ${await put.text()}`);
    const activate = await fetch(`${this.api}/v1/sites/uploads/${upload.uploadId}/activate`, {
      method: "POST",
      headers: this.headers(null, { "Idempotency-Key": `e2e-${crypto.randomUUID()}` }),
    });
    if (activate.ok) return { ok: true, siteId: upload.site.id };
    const { error } = errorSchema.parse(await activate.json());
    return { ok: false, status: activate.status, code: error.code, message: error.message };
  }

  /** Creates, uploads and activates one site. */
  async publish(server: Server | null): Promise<Publish> {
    const started = await this.start(server);
    if (!started.ok) return started;
    return this.finish(started.upload, started.body);
  }

  async publishMany(server: Server | null, count: number) {
    for (let index = 0; index < count; index += 1) {
      const result = await this.publish(server);
      if (!result.ok) throw new Error(`Site ${index + 1} of ${count} was refused: ${result.code} ${result.message}`);
    }
  }
}

function expectRefused(scenario: Scenario, step: string, result: Publish, text: string) {
  const passed = !result.ok && result.status === 409 && result.code === "site_limit" && result.message.includes(text);
  record(
    scenario,
    step,
    passed,
    result.ok ? "a site was published" : `${result.status} ${result.code}: ${result.message}`,
  );
}

function expectPublished(scenario: Scenario, step: string, result: Publish) {
  record(scenario, step, result.ok, result.ok ? result.siteId : `${result.status} ${result.code}: ${result.message}`);
}

async function expectList(
  scenario: Scenario,
  step: string,
  account: Account,
  server: Server | null,
  expected: { limit: number; used: number; reason: "shared" | "account" | null; sites?: number },
) {
  const list = await account.list(server);
  const sites = list.sites.filter((site) => site.status === "active").length;
  const reason = list.limitReason ?? null;
  record(
    scenario,
    step,
    list.limit === expected.limit &&
      list.used === expected.used &&
      reason === expected.reason &&
      (expected.sites === undefined || sites === expected.sites),
    `limit ${list.limit}, used ${list.used}, reason ${reason}, active sites ${sites}`,
  );
}

const scenarios: Record<Scenario, (account: Account) => Promise<void>> = {
  async "free-pool"(account) {
    const first = account.addServer("first");
    const second = account.addServer("second");
    expectPublished("free-pool", "the first server gets the 1 free site", await account.publish(first));
    expectRefused("free-pool", "the second server shares it", await account.publish(second), "share 1 active site");
    await expectList("free-pool", "the first server shows its site", account, first, {
      limit: 1,
      used: 1,
      reason: "shared",
      sites: 1,
    });
    await expectList("free-pool", "the second server shows no free slot", account, second, {
      limit: 0,
      used: 0,
      reason: "shared",
      sites: 0,
    });
    expectPublished("free-pool", "the unlinked bucket stays separate", await account.publish(null));
  },

  async "license-pool"(account) {
    const first = account.addServer("first");
    const second = account.addServer("second");
    account.setLicense(2, "active", Date.now() + 30 * DAY);
    await account.publishMany(first, 4);
    await account.publishMany(second, 2);
    record("license-pool", "2 users give 6 sites on two servers", true, "4 + 2 published");
    expectRefused("license-pool", "the 7th site is refused", await account.publish(first), "share 6 active sites");
    await expectList("license-pool", "the list shows the effective limit", account, first, {
      limit: 4,
      used: 4,
      reason: "shared",
      sites: 4,
    });
    account.setLicense(3, "active", Date.now() + 30 * DAY);
    expectPublished("license-pool", "a third user gives a 7th site", await account.publish(second));
    await expectList("license-pool", "the second server gets the free slots", account, second, {
      limit: 5,
      used: 3,
      reason: "shared",
      sites: 3,
    });
    account.setLicense(3, "past_due", Date.now() - DAY);
    expectRefused("license-pool", "a lapsed license gives the free pool", await account.publish(first), "share 1");
    // The server is over the pool now: it keeps its 4 sites, and the list shows them over the limit.
    await expectList("license-pool", "a lapsed license deletes no site", account, first, {
      limit: 1,
      used: 4,
      reason: "shared",
      sites: 4,
    });
    account.setLicense(3, "canceled", Date.now() + 30 * DAY);
    expectRefused("license-pool", "an ended license gives the free pool", await account.publish(second), "share 1");
  },

  async "server-plan"(account) {
    const pool = account.addServer("pool");
    const paid = account.addServer("paid");
    account.setLicense(1, "active", Date.now() + 30 * DAY);
    account.setPlan(paid, "starter");
    await account.publishMany(pool, 3);
    expectRefused("server-plan", "the pool of 1 user holds 3 sites", await account.publish(pool), "share 3");
    await account.publishMany(paid, 3);
    record("server-plan", "the Starter server has its own 3 sites", true, "3 published with a full pool");
    expectRefused("server-plan", "the Starter server stops at 3", await account.publish(paid), "3 active sites");
    await expectList("server-plan", "the Starter list shows its plan", account, paid, {
      limit: 3,
      used: 3,
      reason: null,
      sites: 3,
    });
  },

  async "custom-limit"(account) {
    const pool = account.addServer("pool");
    const custom = account.addServer("custom");
    account.setCustomLimit(custom, 2);
    expectPublished("custom-limit", "the pool gets its 1 free site", await account.publish(pool));
    await account.publishMany(custom, 2);
    record("custom-limit", "the custom server gets 2 sites with a full pool", true, "2 published");
    expectRefused("custom-limit", "the custom server stops at 2", await account.publish(custom), "2 active sites");
    account.setCustomLimit(custom, 3);
    expectPublished("custom-limit", "a higher custom limit gives a site", await account.publish(custom));
    await expectList("custom-limit", "the custom list shows its limit", account, custom, {
      limit: 3,
      used: 3,
      reason: null,
      sites: 3,
    });
  },

  async race(account) {
    const first = account.addServer("first");
    const second = account.addServer("second");
    const results = await Promise.all([account.start(first), account.start(second)]);
    const accepted = results.filter((result) => result.ok).length;
    const refused = results.filter((result) => !result.ok && result.code === "site_limit").length;
    record("race", "one of two creates gets the last slot", accepted === 1 && refused === 1, `${accepted} accepted`);
    for (const result of results) if (result.ok) await account.finish(result.upload, result.body);
    const lists = await Promise.all([account.list(first), account.list(second)]);
    const used = lists.reduce((sum, list) => sum + list.used, 0);
    record("race", "the pool holds 1 site", used === 1, `${used} used`);
  },

  async "account-cap"(account) {
    const pool = account.addServer("pool");
    const custom = account.addServer("custom");
    account.setLicense(200, "active", Date.now() + 30 * DAY);
    account.setCustomLimit(custom, 1);
    account.insertActiveSites(pool, 300);
    expectRefused("account-cap", "the 301st site is refused", await account.publish(pool), "limit of 300");
    // The list shows only sites with a deployment, so the filler rows count but do not show.
    await expectList("account-cap", "the list stops at the cap", account, pool, {
      limit: 300,
      used: 300,
      reason: "account",
    });
    await expectList("account-cap", "the unlinked bucket stops at the cap", account, null, {
      limit: 0,
      used: 0,
      reason: "account",
    });
    expectPublished("account-cap", "a custom server is outside the cap", await account.publish(custom));
  },
};

async function main(args: string[]) {
  const api = args[args.indexOf("--api") + 1];
  if (!args.includes("--api") || !api) throw new Error("Pass --api <Worker origin>.");
  const chosen = SCENARIOS.filter((scenario) => args.includes(scenario));
  for (const scenario of chosen.length > 0 ? chosen : SCENARIOS) {
    const account = new Account(scenario, api);
    try {
      await scenarios[scenario](account.setUp());
    } catch (error) {
      record(scenario, "scenario finished", false, error instanceof Error ? error.message : String(error));
    } finally {
      account.clear();
    }
  }
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify({ run: new Date().toISOString(), api, steps }, null, 2)}\n`);
  print(`Report: ${REPORT}`);
  if (steps.some((step) => step.result === "fail")) process.exitCode = 1;
}

await main(process.argv.slice(2));
