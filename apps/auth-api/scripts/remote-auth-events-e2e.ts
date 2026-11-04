// Runs the real account server delivery of the remote auth event outbox on a migrated SQLite database,
// with a fake Signal (#2243). Drains that run at the same time must send each event once, one drain
// sends at most 6 events at a time, a failed send waits with the backoff, a stopped drain keeps the
// events that it sent, and the hosted server cron
// sends the events of its deletes once, after the deletes, not inside each one. With two Signals,
// each one gets each event once, and only the Signal that failed gets it again.
//
// Run: bun run test:remote-auth-events
// It writes .openbot-build/remote-auth-events-e2e/report.json and exits non-zero on a failure.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Fiber } from "effect";
import { deliverPendingRemoteAuthEvents, verifyRemoteServiceSignature } from "../src/server/remote-control-plane";
import { createWorkerHandler } from "../src/server/worker-handler";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "remote-auth-events-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SIGNAL_URL = "https://signal.test/internal/auth-events";
const SECOND_SIGNAL_URL = "https://signal-b.test/internal/auth-events";
const SECRET = "webhook-secret";
const WAIT_LIMIT_MS = 10_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  return database;
}

function seedProfileEvents(database: DatabaseSync, count: number, now: number) {
  const insert = database.prepare(
    "INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?)",
  );
  for (let index = 0; index < count; index += 1) {
    insert.run(
      `event-${index}`,
      JSON.stringify({ type: "account-profile-changed", userId: `user-${index}` }),
      now - count + index,
      now,
    );
  }
}

/** Resolves when the condition holds, and fails after a limit so a wrong delivery cannot hang the run. */
async function waitFor(condition: () => boolean): Promise<boolean> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setImmediate(done));
  }
  return true;
}

/** Signal's auth event endpoint at `now`. It holds each answer until `release`, and keeps each body it gets. */
function fakeSignal(now: number, answer: (body: string) => number = () => 204) {
  let release = () => {};
  const released = new Promise<void>((done) => {
    release = done;
  });
  const bodies: string[] = [];
  const state = { bodies, inFlight: 0, maxInFlight: 0, badSignatures: 0, held: true };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (input !== SIGNAL_URL) throw new Error("Unexpected request");
    const body = String(init?.body);
    const headers = new Headers(init?.headers);
    const signed = await Effect.runPromise(
      verifyRemoteServiceSignature(
        SECRET,
        body,
        headers.get("OpenBot-Timestamp") ?? "",
        headers.get("OpenBot-Signature") ?? "",
        now,
      ),
    );
    if (!signed) state.badSignatures += 1;
    state.bodies.push(body);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    if (state.held) await released;
    state.inFlight -= 1;
    return new Response(null, { status: answer(body) });
  };
  return {
    state,
    fetch,
    release: () => {
      state.held = false;
      release();
    },
  };
}

/** Counts the queries that read the next events to send, so a check can wait until each drain read. */
function countingD1(database: DatabaseSync) {
  const d1 = sqliteD1(database);
  const counter = { reads: 0 };
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (query: string) => {
    if (/FROM remote_auth_events\s+WHERE next_attempt_at <= \?/u.test(query)) counter.reads += 1;
    return prepare(query);
  };
  return { d1, counter };
}

function duplicates(bodies: string[]) {
  const seen = new Map<string, number>();
  for (const body of bodies) seen.set(body, (seen.get(body) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([body, count]) => ({ body, count }));
}

function remaining(database: DatabaseSync) {
  return database
    .prepare("SELECT event_id, attempts, next_attempt_at FROM remote_auth_events ORDER BY event_id")
    .all()
    .map((row) => ({
      event_id: String(row.event_id),
      attempts: Number(row.attempts),
      next_attempt_at: Number(row.next_attempt_at),
    }));
}

async function parallelDrainsSendEachEventOnce() {
  const database = await migratedDatabase();
  const now = Date.UTC(2026, 9, 16, 12);
  seedProfileEvents(database, 60, now);
  const { d1, counter } = countingD1(database);
  const signal = fakeSignal(now);
  const bindings = { DB: d1, REMOTE_AUTH_WEBHOOK_URL: SIGNAL_URL, REMOTE_AUTH_WEBHOOK_SECRET: SECRET };
  const drains = Promise.all(
    [0, 1, 2].map(() => Effect.runPromise(deliverPendingRemoteAuthEvents(bindings, now, signal.fetch))),
  );
  const allRead = await waitFor(() => counter.reads === 3);
  signal.release();
  await drains;
  check("three drains read the outbox before Signal answers", allRead, { reads: counter.reads });
  check("parallel drains send each event once", duplicates(signal.state.bodies).length === 0, {
    duplicates: duplicates(signal.state.bodies).length,
    sends: signal.state.bodies.length,
  });
  check("parallel drains send all 60 events", new Set(signal.state.bodies).size === 60, {
    distinct: new Set(signal.state.bodies).size,
  });
  check("parallel drains delete every sent event", remaining(database).length === 0, {
    remaining: remaining(database).length,
  });
}

async function oneDrainSendsSixAtATimeAndBacksOff() {
  const database = await migratedDatabase();
  const now = Date.UTC(2026, 9, 16, 12);
  seedProfileEvents(database, 50, now);
  const failing = (body: string) => Number(JSON.parse(body).userId.slice("user-".length)) % 5 === 0;
  const signal = fakeSignal(now, (body) => (failing(body) ? 503 : 204));
  const drain = Effect.runPromise(
    deliverPendingRemoteAuthEvents(
      { DB: sqliteD1(database), REMOTE_AUTH_WEBHOOK_URL: SIGNAL_URL, REMOTE_AUTH_WEBHOOK_SECRET: SECRET },
      now,
      signal.fetch,
    ),
  );
  const sixInFlight = await waitFor(() => signal.state.inFlight === 6);
  signal.release();
  await drain;
  check("one drain sends 6 events at a time", sixInFlight && signal.state.maxInFlight === 6, {
    maxInFlight: signal.state.maxInFlight,
  });
  check("each send has a valid Signal signature", signal.state.badSignatures === 0, {
    badSignatures: signal.state.badSignatures,
  });
  const rows = remaining(database);
  const failedIds = new Set(
    Array.from({ length: 50 }, (_, index) => index)
      .filter((index) => index % 5 === 0)
      .map((index) => `event-${index}`),
  );
  check(
    "a drain keeps only the failed events, with one attempt and the first backoff",
    rows.length === failedIds.size &&
      rows.every((row) => failedIds.has(row.event_id) && row.attempts === 1 && row.next_attempt_at === now + 60_000),
    { rows },
  );
}

async function aStoppedDrainKeepsTheSentEvents() {
  const database = await migratedDatabase();
  const now = Date.UTC(2026, 9, 16, 12);
  seedProfileEvents(database, 10, now);
  let answered = 0;
  // Signal answers each event except `user-9`, and the Worker stops the drain while it waits for that one.
  const signalFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    if (JSON.parse(String(init?.body)).userId === "user-9") return new Promise<Response>(() => {});
    answered += 1;
    return new Response(null, { status: 204 });
  };
  const fiber = Effect.runFork(
    deliverPendingRemoteAuthEvents(
      { DB: sqliteD1(database), REMOTE_AUTH_WEBHOOK_URL: SIGNAL_URL, REMOTE_AUTH_WEBHOOK_SECRET: SECRET },
      now,
      signalFetch,
    ),
  );
  const nineDeleted = await waitFor(() => answered === 9 && remaining(database).length === 1);
  await Effect.runPromise(Fiber.interrupt(fiber));
  const rows = remaining(database);
  check(
    "a stopped drain deletes each event that Signal accepted",
    nineDeleted && rows.length === 1 && rows[0]?.event_id === "event-9",
    { answered, rows },
  );
}

async function cronSendsTheEventsOfItsDeletesOnceAfterThem() {
  const database = await migratedDatabase();
  // Before the events of the check, so that the cron's own drain does not read them.
  const now = Date.now() - 1_000;
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run("owner", "email:owner@example.test", "owner@example.test");
  for (const index of [1, 2]) {
    const serverId = `server-${index}`;
    const memberId = `member-${index}`;
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(memberId, `email:${memberId}@example.test`, `${memberId}@example.test`);
    database
      .prepare(
        "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, 'owner', 'Cloud server', 1, 1)",
      )
      .run(serverId);
    database
      .prepare(
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, ?, 'member', 1, 1)`,
      )
      .run(`membership-${index}`, serverId, memberId);
    database
      .prepare(
        `INSERT INTO hosted_servers(
           server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
           desired_state, observed_state, idempotency_key, created_at, updated_at
         ) VALUES (?, 'owner', 'Cloud server', ?, 'default', 'standard', 'month', 'eur', 'deleted', 'running', ?, 1, 1)`,
      )
      .run(serverId, `bx_${index}`, `key-${index}`);
  }
  // Events of earlier requests, which the cron's own drain reads beside the hosted server check.
  seedProfileEvents(database, 5, now);

  const order: string[] = [];
  const signal = fakeSignal(now);
  signal.release();
  const originalFetch = globalThis.fetch;
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SIGNAL_URL) {
      order.push(`signal ${JSON.parse(String(init?.body)).type}`);
      return signal.fetch(url, init ?? {});
    }
    if (url.startsWith("https://boat.dev/")) {
      order.push(`boat ${init?.method ?? "GET"} ${new URL(url).pathname}`);
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  globalThis.fetch = Object.assign(routedFetch, { preconnect: originalFetch.preconnect });
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  try {
    await createWorkerHandler(() => new Response(null, { status: 404 })).scheduled(
      // Not midnight, so the daily retention does not run.
      { scheduledTime: now },
      {
        DB: sqliteD1(database),
        REMOTE_AUTH_WEBHOOK_URL: SIGNAL_URL,
        REMOTE_AUTH_WEBHOOK_SECRET: SECRET,
        BOAT_API_KEY: "boat-key",
        REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
        REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
        REMOTE_TICKET_KEY_ID: "ticket-1",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const lastBoatDelete = order.findLastIndex((entry) => entry.startsWith("boat DELETE"));
  const firstHostEvent = order.findIndex((entry) => entry.startsWith("signal") && !entry.endsWith("profile-changed"));
  check("the cron deletes both sandboxes", order.filter((entry) => entry.startsWith("boat DELETE")).length === 2, {
    order,
  });
  check(
    "the cron sends the events of its deletes only after the last delete",
    firstHostEvent > lastBoatDelete && lastBoatDelete >= 0,
    { order },
  );
  check("the cron sends each event once", duplicates(signal.state.bodies).length === 0, {
    duplicates: duplicates(signal.state.bodies),
  });
  // Per server: one auth epoch event and one servers event for its member.
  check("the cron sends the 5 earlier events and the 4 events of its deletes", signal.state.bodies.length === 9, {
    sends: signal.state.bodies.length,
  });
  check("the cron leaves no event in the outbox", remaining(database).length === 0, { remaining: remaining(database) });
  const states = database
    .prepare("SELECT observed_state FROM hosted_servers")
    .all()
    .map((row) => row.observed_state);
  check(
    "the cron finishes both deletes",
    states.every((state) => state === "deleted"),
    { states },
  );
}

function pendingTargets(database: DatabaseSync) {
  return database
    .prepare("SELECT event_id, attempts, next_attempt_at, pending_targets FROM remote_auth_events ORDER BY event_id")
    .all()
    .map((row) => ({
      event_id: String(row.event_id),
      attempts: Number(row.attempts),
      next_attempt_at: Number(row.next_attempt_at),
      pending_targets: row.pending_targets === null ? null : String(row.pending_targets),
    }));
}

async function eachSignalGetsEachEventAndOnlyTheFailedOneRetries() {
  const database = await migratedDatabase();
  const now = Date.UTC(2026, 9, 31, 12);
  seedProfileEvents(database, 3, now);
  const received = new Map<string, string[]>([
    [SIGNAL_URL, []],
    [SECOND_SIGNAL_URL, []],
  ]);
  const unexpected: string[] = [];
  const state = { secondUp: false, badSignatures: 0, sentAt: now };
  const signalFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const bodies = received.get(url);
    if (!bodies) {
      unexpected.push(url);
      throw new Error("Unexpected request");
    }
    const body = String(init?.body);
    const headers = new Headers(init?.headers);
    const signed = await Effect.runPromise(
      verifyRemoteServiceSignature(
        SECRET,
        body,
        headers.get("OpenBot-Timestamp") ?? "",
        headers.get("OpenBot-Signature") ?? "",
        state.sentAt,
      ),
    );
    if (!signed) state.badSignatures += 1;
    bodies.push(body);
    return new Response(null, { status: url === SECOND_SIGNAL_URL && !state.secondUp ? 503 : 204 });
  };
  // The list replaces the single URL, which this fake Signal refuses.
  const bindings = {
    DB: sqliteD1(database),
    REMOTE_AUTH_WEBHOOK_URL: "https://old-signal.test/internal/auth-events",
    REMOTE_AUTH_WEBHOOK_URLS: ` ${SIGNAL_URL}, ${SECOND_SIGNAL_URL},`,
    REMOTE_AUTH_WEBHOOK_SECRET: SECRET,
  };
  await Effect.runPromise(deliverPendingRemoteAuthEvents(bindings, now, signalFetch));
  const afterFailure = pendingTargets(database);
  check(
    "the working Signal gets each event once while the other Signal fails",
    received.get(SIGNAL_URL)?.length === 3 &&
      new Set(received.get(SIGNAL_URL)).size === 3 &&
      received.get(SECOND_SIGNAL_URL)?.length === 3,
    { first: received.get(SIGNAL_URL)?.length, second: received.get(SECOND_SIGNAL_URL)?.length },
  );
  check(
    "each event stays with only the failed Signal as its target, one attempt and the first backoff",
    afterFailure.length === 3 &&
      afterFailure.every(
        (row) =>
          row.attempts === 1 &&
          row.next_attempt_at === now + 60_000 &&
          row.pending_targets === JSON.stringify([SECOND_SIGNAL_URL]),
      ),
    { rows: afterFailure },
  );

  state.secondUp = true;
  state.sentAt = now + 60_000;
  await Effect.runPromise(deliverPendingRemoteAuthEvents(bindings, state.sentAt, signalFetch));
  check(
    "the retry sends only to the failed Signal",
    received.get(SIGNAL_URL)?.length === 3 && received.get(SECOND_SIGNAL_URL)?.length === 6,
    { first: received.get(SIGNAL_URL)?.length, second: received.get(SECOND_SIGNAL_URL)?.length },
  );
  check("the outbox deletes each event after both Signals accepted it", pendingTargets(database).length === 0, {
    rows: pendingTargets(database),
  });

  // An event whose only target is no longer configured needs no send.
  database
    .prepare(
      `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at, pending_targets)
       VALUES ('removed-target', ?, ?, 2, ?, ?)`,
    )
    .run(
      JSON.stringify({ type: "account-profile-changed", userId: "user-removed" }),
      state.sentAt,
      state.sentAt,
      JSON.stringify(["https://removed-signal.test/internal/auth-events"]),
    );
  await Effect.runPromise(deliverPendingRemoteAuthEvents(bindings, state.sentAt, signalFetch));
  check(
    "an event whose targets are no longer configured is deleted with no send",
    pendingTargets(database).length === 0 &&
      received.get(SIGNAL_URL)?.length === 3 &&
      received.get(SECOND_SIGNAL_URL)?.length === 6,
    { rows: pendingTargets(database) },
  );
  check(
    "each send to two Signals has a valid signature and goes only to a listed URL",
    state.badSignatures === 0 && unexpected.length === 0,
    { badSignatures: state.badSignatures, unexpected },
  );
}

const scenarios = [
  parallelDrainsSendEachEventOnce,
  oneDrainSendsSixAtATimeAndBacksOff,
  aStoppedDrainKeepsTheSentEvents,
  cronSendsTheEventsOfItsDeletesOnceAfterThem,
  eachSignalGetsEachEventAndOnlyTheFailedOneRetries,
];
for (const scenario of scenarios) {
  try {
    await scenario();
  } catch (error) {
    check(scenario.name, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.every((entry) => entry.passed), checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
