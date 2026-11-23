import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { z } from "zod";
import { developmentChildEnvironment } from "./development-environment";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, ".openbot-build", "owner-transfer-e2e.json");
const DAY = 86_400_000;
const PREFIX = "e2e-owner-transfer";
const ACCOUNT_NAMES = ["owner", "admin", "recipient", "stranger"] as const;

const d1ResultSchema = z.array(z.object({ results: z.array(z.unknown()) }));
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const transferSchema = z.object({
  transferId: z.string(),
  hostId: z.string(),
  hostName: z.string(),
  fromEmail: z.string(),
  toEmail: z.string(),
  expiresAt: z.number(),
});
const hostsSchema = z.object({
  hosts: z.array(z.object({ hostId: z.string(), role: z.string(), memberLimit: z.number() })),
});
const sessionSchema = z.object({ sessionToken: z.string(), user: z.object({ id: z.string(), email: z.string() }) });

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
  step: string;
  result: "pass" | "fail";
  detail: string;
}
const steps: Step[] = [];

function record(step: string, passed: boolean, detail: string) {
  steps.push({ step, result: passed ? "pass" : "fail", detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${step} (${detail})\n`);
}

class Account {
  readonly token = randomBytes(24).toString("base64url");
  readonly id: string;
  readonly email: string;

  constructor(
    readonly name: string,
    readonly api: string,
  ) {
    this.id = `${PREFIX}-${name}`;
    this.email = `${this.id}@example.com`;
  }

  create() {
    const now = Date.now();
    d1(
      `INSERT INTO users(id, identity_key, email, name, created_at, updated_at)
       VALUES (${quote(this.id)}, ${quote(`e2e:${this.id}`)}, ${quote(this.email)}, ${quote(this.name)}, ${now}, ${now});
       INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
       VALUES (${quote(crypto.randomUUID())}, ${quote(this.id)}, ${quote(hash(this.token))}, ${now + DAY}, ${now}, ${now})`,
      z.unknown(),
    );
    return this;
  }

  request(path: string, init: RequestInit = {}, token = this.token): Promise<Response> {
    return fetch(new URL(path, this.api), {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
  }
}

interface Server {
  id: string;
  token: string;
}

function clear() {
  const users = `(SELECT id FROM users WHERE id LIKE '${PREFIX}-%')`;
  const hosts = `(SELECT host_id FROM remote_hosts WHERE host_id LIKE '${PREFIX}-%')`;
  d1(
    [
      `DELETE FROM remote_owner_transfers WHERE host_id LIKE '${PREFIX}-%'`,
      `DELETE FROM hosted_servers WHERE server_id LIKE '${PREFIX}-%'`,
      `DELETE FROM remote_auth_events WHERE payload LIKE '%${PREFIX}-%'`,
      `DELETE FROM remote_sessions WHERE host_id IN ${hosts}`,
      `DELETE FROM remote_invites WHERE host_id IN ${hosts}`,
      `DELETE FROM remote_memberships WHERE host_id IN ${hosts}`,
      `DELETE FROM webhook_routes WHERE host_id IN ${hosts}`,
      `DELETE FROM billing_subscriptions WHERE user_id IN ${users}`,
      `DELETE FROM remote_hosts WHERE host_id LIKE '${PREFIX}-%'`,
      `DELETE FROM auth_sessions WHERE user_id IN ${users}`,
      `DELETE FROM auth_rate_limits WHERE key_hash IN (${ACCOUNT_NAMES.flatMap((name) => [
        quote(hash(`invite:user:${PREFIX}-${name}`)),
        quote(hash(`invite:email:${PREFIX}-${name}@example.com`)),
      ]).join(", ")})`,
      `DELETE FROM users WHERE id LIKE '${PREFIX}-%'`,
    ].join("; "),
    z.unknown(),
  );
}

function addServer(owner: Account, admin: Account): Server {
  const now = Date.now();
  const server = { id: `${PREFIX}-host`, token: randomBytes(24).toString("base64url") };
  d1(
    `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, auth_epoch, created_at, updated_at)
     VALUES (${quote(server.id)}, ${quote(owner.id)}, 'Transfer e2e', ${quote(hash(server.token))}, 1, ${now}, ${now});
     INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
     VALUES (${quote(`${server.id}:owner`)}, ${quote(server.id)}, ${quote(owner.id)}, 'owner', 'active', ${now}, ${now}),
            (${quote(`${server.id}:admin`)}, ${quote(server.id)}, ${quote(admin.id)}, 'admin', 'active', ${now}, ${now});
     INSERT INTO webhook_routes(route_id, host_id, account_id, connected_at)
     VALUES (${quote(`${server.id}-route`)}, ${quote(server.id)}, ${quote(owner.id)}, ${now});
     INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan,
       interval, currency, amount, status, current_period_end, updated_at)
     VALUES (${quote(`sub_${server.id}`)}, ${quote(owner.id)}, ${quote(`cus_${owner.id}`)}, ${quote(server.id)},
       'pro', 'month', 'eur', 1000, 'active', ${now + 30 * DAY}, ${now})`,
    z.unknown(),
  );
  return server;
}

async function errorCode(response: Response): Promise<string> {
  if (response.ok) return `HTTP ${response.status}`;
  return errorSchema.parse(await response.json()).error.code;
}

async function hostOf(account: Account, hostId: string, token = account.token) {
  const response = await account.request("/v2/remote/hosts/", {}, token);
  if (!response.ok) return null;
  const { hosts } = hostsSchema.parse(await response.json());
  return hosts.find((host) => host.hostId === hostId) ?? null;
}

async function run(api: string) {
  const owner = new Account("owner", api).create();
  const admin = new Account("admin", api).create();
  const recipient = new Account("recipient", api).create();
  const stranger = new Account("stranger", api).create();
  const server = addServer(owner, admin);
  const planLimit = (await hostOf(owner, server.id))?.memberLimit ?? 0;
  record("the plan of the owner sets the member limit", planLimit > DEFAULT_TEAM_MEMBER_LIMIT, String(planLimit));

  const transferPath = `/v2/remote/hosts/${server.id}/owner-transfer`;
  const byAdmin = await admin.request(transferPath, {
    method: "POST",
    body: JSON.stringify({ email: recipient.email }),
  });
  record(
    "an admin cannot transfer the server",
    (await errorCode(byAdmin)) === "remote_permission_denied",
    String(byAdmin.status),
  );

  const toSelf = await owner.request(transferPath, { method: "POST", body: JSON.stringify({ email: owner.email }) });
  record(
    "the owner cannot transfer to own email",
    (await errorCode(toSelf)) === "owner_transfer_self",
    String(toSelf.status),
  );

  const now = Date.now();
  d1(
    `INSERT INTO hosted_servers(server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state,
       observed_state, idempotency_key, created_at, updated_at)
     VALUES (${quote(server.id)}, ${quote(owner.id)}, 'Transfer e2e', 'default', 'pro', 'month', 'eur', 'running',
       'running', ${quote(`${PREFIX}-hosted`)}, ${now}, ${now})`,
    z.unknown(),
  );
  const hosted = await owner.request(transferPath, {
    method: "POST",
    body: JSON.stringify({ email: recipient.email }),
  });
  record(
    "a server that OpenBot hosts cannot be transferred",
    (await errorCode(hosted)) === "owner_transfer_hosted",
    String(hosted.status),
  );
  d1(`DELETE FROM hosted_servers WHERE server_id = ${quote(server.id)}`, z.unknown());

  const first = await owner.request(transferPath, { method: "POST", body: JSON.stringify({ email: stranger.email }) });
  const firstTransfer = transferSchema.parse(await first.json());
  const second = await owner.request(transferPath, {
    method: "POST",
    body: JSON.stringify({ email: recipient.email.toUpperCase() }),
  });
  const transfer = transferSchema.parse(await second.json());
  record(
    "a new request replaces the pending one",
    second.status === 201 && transfer.toEmail === recipient.email && transfer.transferId !== firstTransfer.transferId,
    transfer.toEmail,
  );
  const staleAccept = await stranger.request(`/v2/remote/owner-transfers/${firstTransfer.transferId}/accept`, {
    method: "POST",
  });
  record(
    "the replaced request cannot be accepted",
    (await errorCode(staleAccept)) === "owner_transfer_invalid",
    String(staleAccept.status),
  );

  const pending = z
    .object({ transfer: transferSchema.nullable() })
    .parse(await (await admin.request(transferPath)).json());
  record(
    "an admin sees the pending request",
    pending.transfer?.transferId === transfer.transferId,
    String(pending.transfer?.toEmail),
  );

  const incoming = z
    .object({ transfers: z.array(transferSchema) })
    .parse(await (await recipient.request("/v2/remote/owner-transfers/")).json());
  record(
    "the recipient sees the request in the app",
    incoming.transfers.some((entry) => entry.transferId === transfer.transferId && entry.fromEmail === owner.email),
    String(incoming.transfers.length),
  );
  const strangerIncoming = z
    .object({ transfers: z.array(transferSchema) })
    .parse(await (await stranger.request("/v2/remote/owner-transfers/")).json());
  record(
    "another account does not see the request",
    strangerIncoming.transfers.length === 0,
    String(strangerIncoming.transfers.length),
  );

  const wrongAccept = await stranger.request(`/v2/remote/owner-transfers/${transfer.transferId}/accept`, {
    method: "POST",
  });
  record(
    "another account cannot accept",
    (await errorCode(wrongAccept)) === "owner_transfer_invalid",
    String(wrongAccept.status),
  );

  const accepted = await recipient.request(`/v2/remote/owner-transfers/${transfer.transferId}/accept`, {
    method: "POST",
  });
  record("the recipient accepts", accepted.status === 200, String(accepted.status));
  const again = await recipient.request(`/v2/remote/owner-transfers/${transfer.transferId}/accept`, { method: "POST" });
  record("the request works once", (await errorCode(again)) === "owner_transfer_invalid", String(again.status));

  const newOwnerHost = await hostOf(recipient, server.id);
  record("the recipient is the owner", newOwnerHost?.role === "owner", String(newOwnerHost?.role));
  record(
    "the plan of the previous owner still pays for the server",
    newOwnerHost?.memberLimit === planLimit,
    String(newOwnerHost?.memberLimit),
  );
  record("the previous owner lost access", (await hostOf(owner, server.id)) === null, "not listed");
  const adminHost = await hostOf(admin, server.id);
  record("the admin keeps the role", adminHost?.role === "admin", String(adminHost?.role));
  const rows = d1(
    `SELECT h.owner_user_id, h.auth_epoch, r.account_id FROM remote_hosts h
       JOIN webhook_routes r ON r.host_id = h.host_id WHERE h.host_id = ${quote(server.id)}`,
    z.object({ owner_user_id: z.string(), auth_epoch: z.number(), account_id: z.string() }),
  );
  record(
    "routes follow the owner and the epoch changes",
    rows[0]?.owner_user_id === recipient.id && rows[0]?.account_id === recipient.id && rows[0]?.auth_epoch === 2,
    JSON.stringify(rows[0] ?? null),
  );
  const oldOwnerMembers = await owner.request(`/v2/remote/hosts/${server.id}/members/`);
  record("the previous owner cannot read members", oldOwnerMembers.status === 403, String(oldOwnerMembers.status));

  const sessionPath = `/v2/remote/hosts/${server.id}/owner-session`;
  const badHost = await fetch(new URL(sessionPath, api), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineToken: "wrong", previousSessionToken: owner.token }),
  });
  record(
    "a wrong host credential gets no session",
    (await errorCode(badHost)) === "host_unauthorized",
    String(badHost.status),
  );
  const handoff = await fetch(new URL(sessionPath, api), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineToken: server.token, previousSessionToken: owner.token }),
  });
  const session = sessionSchema.parse(await handoff.json());
  record("the server gets a session of the new owner", session.user.id === recipient.id, session.user.email);
  const serverView = await hostOf(recipient, server.id, session.sessionToken);
  record("the server session works for the new owner", serverView?.role === "owner", String(serverView?.role));
  const oldSession = await owner.request("/v2/remote/hosts/");
  record(
    "the session of the previous owner on the server is revoked",
    oldSession.status === 401,
    String(oldSession.status),
  );

  const retry = await fetch(new URL(sessionPath, api), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineToken: server.token, previousSessionToken: session.sessionToken }),
  });
  const retried = sessionSchema.parse(await retry.json());
  const replaced = await recipient.request("/v2/remote/hosts/", {}, session.sessionToken);
  record(
    "a retry replaces the earlier server session",
    retried.user.id === recipient.id && replaced.status === 401,
    String(replaced.status),
  );

  const decline = await stranger.request(`/v2/remote/owner-transfers/${transfer.transferId}/decline`, {
    method: "POST",
  });
  record(
    "a finished request cannot be declined",
    (await errorCode(decline)) === "owner_transfer_invalid",
    String(decline.status),
  );

  const nextPath = `/v2/remote/hosts/${server.id}/owner-transfer`;
  const back = transferSchema.parse(
    await (
      await recipient.request(nextPath, { method: "POST", body: JSON.stringify({ email: stranger.email }) })
    ).json(),
  );
  const cancelled = await recipient.request(nextPath, { method: "DELETE" });
  const afterCancel = await stranger.request(`/v2/remote/owner-transfers/${back.transferId}/accept`, {
    method: "POST",
  });
  record(
    "a cancelled request cannot be accepted",
    cancelled.status === 204 && (await errorCode(afterCancel)) === "owner_transfer_invalid",
    String(afterCancel.status),
  );
  const declinedTransfer = transferSchema.parse(
    await (
      await recipient.request(nextPath, { method: "POST", body: JSON.stringify({ email: stranger.email }) })
    ).json(),
  );
  const declined = await stranger.request(`/v2/remote/owner-transfers/${declinedTransfer.transferId}/decline`, {
    method: "POST",
  });
  const stillOwner = await hostOf(recipient, server.id);
  record(
    "a declined request changes nothing",
    declined.status === 204 && stillOwner?.role === "owner",
    String(stillOwner?.role),
  );
}

async function main(args: string[]) {
  const api = args[args.indexOf("--api") + 1];
  if (!args.includes("--api") || !api) throw new Error("Pass --api <Worker origin>.");
  clear();
  try {
    await run(api);
  } catch (error) {
    record("scenario finished", false, error instanceof Error ? error.message : String(error));
  } finally {
    clear();
  }
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify({ run: new Date().toISOString(), api, steps }, null, 2)}\n`);
  process.stdout.write(`Report: ${REPORT}\n`);
  if (steps.some((step) => step.result === "fail")) process.exitCode = 1;
}

await main(process.argv.slice(2));
