// Runs the real membership change of the account server on a local D1 (workerd through Wrangler) with
// the real migrations. It checks the race between two admins: admin A removes a member while admin B
// changes that member's role from a read made before the removal. B's change must fail with 409
// `membership_changed`, and the member must stay removed, with no auth epoch, events or ended sessions
// from B. A role change with no race succeeds, and two removals of the same member, one from a read
// made before the other, both succeed and keep the time of the first removal. A removal from a read
// made before another admin's role change also succeeds: a role change cannot stop a removal.
//
// The race cannot be timed from outside, so the script orders it: a D1 wrapper runs admin A's whole
// removal when admin B's change starts its write batch. Then all of B's reads come before A's removal,
// and B's writes come after it.
//
// Run: bun apps/auth-api/scripts/remote-membership-race-e2e.ts
// It writes .openbot-build/remote-membership-race-e2e/report.json and exits non-zero on a failure.
// The local D1 lives in a temporary directory, so the worktree's own local D1 stays as it is. The
// control plane has no webhook URLs and a fetch stub, so it uses no network.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { getPlatformProxy } from "wrangler";
import { RemoteControlPlane } from "../src/server/remote-control-plane";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "remote-membership-race-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const HOUR = 60 * 60 * 1000;

interface MembershipRow {
  membership_id: string;
  role: string;
  status: string;
  removed_at: number | null;
}

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  steps.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

/** The error code and HTTP status of an operation, or null codes when it succeeds. */
async function outcome<A, E extends object>(operation: Effect.Effect<A, E>) {
  const result = await Effect.runPromise(Effect.result(operation));
  if (result._tag === "Success") return { code: null, status: null };
  return {
    code: "code" in result.failure ? String(result.failure.code) : result.failure.constructor.name,
    status: "status" in result.failure ? Number(result.failure.status) : null,
  };
}

/**
 * The D1 binding, except that `beforeNextBatch(hook)` runs `hook` to its end before the next batch
 * starts. The returned object holds the result of the hook once it ran.
 */
function interleavedDatabase(database: D1Database) {
  let pending: (() => Promise<void>) | null = null;
  const wrapped: D1Database = {
    prepare: (query) => database.prepare(query),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const hook = pending;
      pending = null;
      if (hook) await hook();
      return database.batch<T>(statements);
    },
    exec: (query) => database.exec(query),
    withSession: (constraintOrBookmark) => database.withSession(constraintOrBookmark),
    dump: () => database.dump(),
  };
  return {
    database: wrapped,
    beforeNextBatch<A>(hook: () => Promise<A>) {
      const ran: { result?: A } = {};
      pending = async () => {
        ran.result = await hook();
      };
      return ran;
    },
  };
}

const work = await mkdtemp(join(tmpdir(), "remote-membership-race-e2e-"));
const state = join(work, "state");
const config = join(work, "wrangler.jsonc");
await writeFile(
  config,
  JSON.stringify({
    name: "remote-membership-race-e2e",
    compatibility_date: "2026-08-18",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [
      {
        binding: "DB",
        database_name: "openbot-auth",
        database_id: "remote-membership-race-e2e",
        migrations_dir: MIGRATIONS,
      },
    ],
  }),
);
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
await run(WRANGLER, ["d1", "migrations", "apply", "openbot-auth", "--local", "--persist-to", state, "-c", config], {
  cwd: work,
  env,
});
// Wrangler keeps local state under `<persist-to>/v3`; the platform proxy takes that directory itself.
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: config,
  persist: { path: join(state, "v3") },
  envFiles: [],
});
const d1 = proxy.env.DB;

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);

let clock = Date.now();
/** Moves the clock of the control plane, so that each change has its own time. */
const tick = () => {
  clock += 1000;
};
const fetchCalls: string[] = [];
const interleave = interleavedDatabase(d1);
const plane = new RemoteControlPlane(
  {
    DB: interleave.database,
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
    REMOTE_TICKET_KEY_ID: "ticket-1",
  },
  {
    now: () => clock,
    schedule: () => undefined,
    fetch: async (input) => {
      fetchCalls.push(String(input));
      return new Response(null, { status: 200 });
    },
  },
);

/** A host with an owner, admins A and B and member M, all active, with room for more members. */
async function seed(hostId: string) {
  const now = clock;
  const user = (name: string) => `${hostId}-${name}`;
  const membership = (name: string) => `${hostId}:${name}`;
  const users = ["owner", "admin-a", "admin-b", "member"].map(user);
  const roles = { owner: "owner", "admin-a": "admin", "admin-b": "admin", member: "member" } as const;
  await d1.batch([
    ...users.map((id) =>
      d1
        .prepare(
          "INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(id, `email:${id}@example.test`, `${id}@example.test`, id, now, now),
    ),
    d1
      .prepare(
        "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, 'Host', ?, ?)",
      )
      .bind(hostId, user("owner"), now, now),
    d1
      .prepare(
        "INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at) VALUES (?, ?, 10, ?, ?)",
      )
      .bind(hostId, user("owner"), now, now),
    ...Object.entries(roles).map(([name, role]) =>
      d1
        .prepare(
          `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .bind(membership(name), hostId, user(name), role, now, now),
    ),
  ]);
  const memberId = membership("member");
  const read = async () => {
    const row = await d1
      .prepare("SELECT membership_id, role, status, removed_at FROM remote_memberships WHERE membership_id = ?")
      .bind(memberId)
      .first<MembershipRow>();
    if (!row) throw new Error(`The membership ${memberId} is missing.`);
    return row;
  };
  const epoch = async () =>
    Number(
      (await d1.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = ?").bind(hostId).first())?.auth_epoch,
    );
  const events = async () =>
    Number((await d1.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").first())?.count);
  const openSession = async () => {
    const sessionId = crypto.randomUUID();
    await d1
      .prepare(
        `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, ended_at, expires_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(sessionId, hostId, user("member"), memberId, clock, clock + HOUR)
      .run();
    return sessionId;
  };
  const sessionEnded = async (sessionId: string) =>
    (await d1.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = ?").bind(sessionId).first())?.ended_at ??
    null;
  return {
    hostId,
    adminA: user("admin-a"),
    adminB: user("admin-b"),
    memberId,
    read,
    epoch,
    events,
    openSession,
    sessionEnded,
  };
}

async function staleRoleChangeCannotBringBackARemovedMember() {
  const host = await seed("host-race");
  const removal = interleave.beforeNextBatch(async () => {
    // Admin B's change has made all its reads and is about to write.
    const seenByB = await host.read();
    tick();
    const revoke = await outcome(
      plane.changeMembership(host.adminA, { hostId: host.hostId, membershipId: host.memberId, revoke: true }),
    );
    const removed = await host.read();
    // A session row that is open after A's removal shows whether B's refused change still ends sessions.
    const session = await host.openSession();
    return { seenByB, revoke, removed, session, epoch: await host.epoch(), events: await host.events() };
  });
  tick();
  const change = await outcome(
    plane.changeMembership(host.adminB, { hostId: host.hostId, membershipId: host.memberId, role: "admin" }),
  );
  const after = await host.read();
  const during = removal.result;
  check("race: admin A's removal ran between admin B's reads and writes", during !== undefined);
  if (!during) return;
  check(
    "race: admin B read the member as active, before the removal",
    during.seenByB.status === "active",
    during.seenByB,
  );
  check("race: admin A removes the member", during.revoke.code === null && during.removed.status === "revoked", {
    outcome: during.revoke,
    removed: during.removed,
  });
  check(
    "race: admin B's stale role change fails with 409 membership_changed",
    change.code === "membership_changed" && change.status === 409,
    change,
  );
  check("race: the member stays revoked", after.status === "revoked", after);
  check(
    "race: the member keeps the removal time of admin A",
    after.removed_at !== null && after.removed_at === during.removed.removed_at,
    { removedByA: during.removed.removed_at, after: after.removed_at },
  );
  check("race: the member keeps the role from before", after.role === "member", after);
  const epoch = await host.epoch();
  check("race: admin B's refused change keeps the host auth epoch", epoch === during.epoch, {
    before: during.epoch,
    after: epoch,
  });
  const events = await host.events();
  check("race: admin B's refused change adds no auth events", events === during.events, {
    before: during.events,
    after: events,
  });
  const endedAt = await host.sessionEnded(during.session);
  check("race: admin B's refused change ends no session", endedAt === null, { endedAt });
}

async function roleChangeWithNoRaceSucceeds() {
  const host = await seed("host-plain");
  tick();
  const change = await outcome(
    plane.changeMembership(host.adminB, { hostId: host.hostId, membershipId: host.memberId, role: "admin" }),
  );
  const after = await host.read();
  check("plain: admin B's role change succeeds", change.code === null, change);
  check("plain: the member is an active admin", after.role === "admin" && after.status === "active", after);
  check("plain: the member has no removal time", after.removed_at === null, after);
}

async function twoRemovalsBothSucceed() {
  const host = await seed("host-double");
  const removal = interleave.beforeNextBatch(async () => {
    const seenByB = await host.read();
    tick();
    const revoke = await outcome(
      plane.changeMembership(host.adminA, { hostId: host.hostId, membershipId: host.memberId, revoke: true }),
    );
    return { seenByB, revoke, removed: await host.read() };
  });
  tick();
  // Admin B removes the member from a read made before admin A's removal.
  const raced = await outcome(
    plane.changeMembership(host.adminB, { hostId: host.hostId, membershipId: host.memberId, revoke: true }),
  );
  const afterRaced = await host.read();
  tick();
  // Admin B removes the member again, from a read made after the removal.
  const again = await outcome(
    plane.changeMembership(host.adminB, { hostId: host.hostId, membershipId: host.memberId, revoke: true }),
  );
  const after = await host.read();
  const during = removal.result;
  check("double: admin A's removal ran between admin B's reads and writes", during !== undefined);
  if (!during) return;
  check(
    "double: admin B read the member as active, before the removal",
    during.seenByB.status === "active",
    during.seenByB,
  );
  check("double: admin A's removal succeeds", during.revoke.code === null, during.revoke);
  check("double: admin B's removal from a stale read succeeds", raced.code === null, raced);
  check("double: a second removal from a fresh read succeeds", again.code === null, again);
  check("double: the member is revoked", afterRaced.status === "revoked" && after.status === "revoked", {
    afterRaced,
    after,
  });
  check(
    "double: the removal time stays the time of the first removal",
    during.removed.removed_at !== null &&
      afterRaced.removed_at === during.removed.removed_at &&
      after.removed_at === during.removed.removed_at,
    { first: during.removed.removed_at, afterRaced: afterRaced.removed_at, after: after.removed_at },
  );
}

async function removalWinsOverAConcurrentRoleChange() {
  const host = await seed("host-role-race");
  const promotion = interleave.beforeNextBatch(async () => {
    const seenByB = await host.read();
    tick();
    const change = await outcome(
      plane.changeMembership(host.adminA, { hostId: host.hostId, membershipId: host.memberId, role: "admin" }),
    );
    return { seenByB, change, promoted: await host.read(), epoch: await host.epoch() };
  });
  tick();
  // Admin B removes the member from a read made before admin A made the member an admin.
  const removal = await outcome(
    plane.changeMembership(host.adminB, { hostId: host.hostId, membershipId: host.memberId, revoke: true }),
  );
  const after = await host.read();
  const during = promotion.result;
  check("role race: admin A's role change ran between admin B's reads and writes", during !== undefined);
  if (!during) return;
  check(
    "role race: admin B read the member as a member, before the role change",
    during.seenByB.role === "member" && during.seenByB.status === "active",
    during.seenByB,
  );
  check(
    "role race: admin A makes the member an admin",
    during.change.code === null && during.promoted.role === "admin",
    { outcome: during.change, promoted: during.promoted },
  );
  check("role race: admin B's removal succeeds", removal.code === null, removal);
  check("role race: the member is revoked", after.status === "revoked" && after.removed_at !== null, after);
  check("role race: the removal keeps the newer role", after.role === "admin", after);
  const epoch = await host.epoch();
  check("role race: the removal bumps the host auth epoch", epoch === during.epoch + 1, {
    before: during.epoch,
    after: epoch,
  });
}

const scenarios = [
  staleRoleChangeCannotBringBackARemovedMember,
  roleChangeWithNoRaceSucceeds,
  twoRemovalsBothSucceed,
  removalWinsOverAConcurrentRoleChange,
];
try {
  for (const scenario of scenarios) {
    try {
      await scenario();
    } catch (error) {
      check(scenario.name, false, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  check("the control plane made no network request", fetchCalls.length === 0, { fetchCalls });
} finally {
  await proxy.dispose();
  await rm(work, { recursive: true, force: true });
}

await mkdir(OUT, { recursive: true });
const report = { passed: steps.length > 0 && steps.every((step) => step.passed), steps };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const step of steps) console.log(`${step.passed ? "PASS" : "FAIL"} ${step.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
