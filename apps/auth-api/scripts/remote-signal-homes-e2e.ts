import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REMOTE_TICKET_AUDIENCE } from "@openbot/contracts/signal-protocol/ticket";
import { Effect } from "effect";
import { jwtVerify } from "jose";
import { RemoteControlPlane, type SignalLocation } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "remote-signal-homes-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const ENTRY_URL = "wss://signal.test/v1/signal";
const HOME_URLS = { a: "wss://signal-a.test/v1/signal", b: "wss://signal-b.test/v1/signal" } as const;
const HOMES = `a=${HOME_URLS.a}, b=${HOME_URLS.b}`;
const REGION_URLS = {
  ...HOME_URLS,
  us: "wss://signal-us.test/v1/signal",
  au: "wss://signal-au.test/v1/signal",
} as const;
const REGION_HOMES = Object.entries(REGION_URLS)
  .map(([id, url]) => `${id}=${url}`)
  .join(",");
const REGION_LOCATIONS = "a=60.17:24.94, b=60.17:24.94, us=37.34:-121.89, au=-33.87:151.21";
const PLACES = {
  berlin: { latitude: 52.52, longitude: 13.4 },
  newYork: { latitude: 40.71, longitude: -74.01 },
  sydney: { latitude: -33.87, longitude: 151.21 },
  tokyo: { latitude: 35.68, longitude: 139.69 },
  beijing: { latitude: 39.9, longitude: 116.4 },
};
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

const ticketKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.publicKey)), kid: "ticket-1" };
const privateJwk = { ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.privateKey)), kid: "ticket-1" };
const ticketKeys = {
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify(privateJwk),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
  REMOTE_TICKET_KEY_ID: "ticket-1",
};

async function signalClaim(ticket: string): Promise<string> {
  const { payload } = await jwtVerify(ticket, ticketKeyPair.publicKey, { audience: REMOTE_TICKET_AUDIENCE });
  return typeof payload.signal === "string" ? payload.signal : "none";
}

function rendezvousOf<Id extends string>(hostId: string, ids: readonly Id[]): Id {
  const score = (id: string) => createHash("sha256").update(`${id}\n${hostId}`).digest().readBigUInt64BE(0);
  return ids.reduce((best, id) => (score(id) > score(best) ? id : best));
}

function rendezvous(hostId: string): keyof typeof HOME_URLS {
  return rendezvousOf(hostId, ["a", "b"] as const);
}

function machineToken(hostId: string): string {
  return `machine-token-${hostId}`;
}

async function hostsWithSessions(hostIds: string[]) {
  const database = await migratedDatabase();
  database
    .prepare(
      "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner', ?, 1, 1)",
    )
    .run("owner@example.test");
  for (const hostId of hostIds) {
    database
      .prepare(
        `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, created_at, updated_at)
         VALUES (?, 'owner', 'Host', ?, 1, 1)`,
      )
      .run(hostId, createHash("sha256").update(machineToken(hostId)).digest("base64url"));
    database
      .prepare(
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
         VALUES (?, ?, 'owner', 'owner', 'active', 1, 1)`,
      )
      .run(`membership-${hostId}`, hostId);
    database
      .prepare(
        `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at)
         VALUES (?, ?, 'owner', ?, 1, ?)`,
      )
      .run(`session-${hostId}`, hostId, `membership-${hostId}`, Date.now() + 60 * 60 * 1_000);
  }
  return database;
}

function storedHome(database: DatabaseSync, hostId: string): string {
  const row = database.prepare("SELECT signal_home FROM remote_hosts WHERE host_id = ?").get(hostId);
  return row?.signal_home === null || row?.signal_home === undefined ? "none" : String(row.signal_home);
}

const downMachines = new Set<string>();
const healthRequests: string[] = [];
async function healthFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname !== "/health/ready") throw new Error(`Unexpected request: ${url.pathname}`);
  healthRequests.push(url.href);
  if (downMachines.has(url.hostname)) throw new TypeError("fetch failed");
  return new Response("{}", { status: 200 });
}

function plane(
  database: D1Database | DatabaseSync,
  homes: string,
  entryUrl = ENTRY_URL,
  locations = "",
  countries = "",
) {
  return new RemoteControlPlane(
    {
      DB: database instanceof DatabaseSync ? sqliteD1(database) : database,
      ...ticketKeys,
      REMOTE_SIGNAL_URL: entryUrl,
      REMOTE_SIGNAL_HOMES: homes,
      REMOTE_SIGNAL_HOME_LOCATIONS: locations,
      REMOTE_SIGNAL_HOME_COUNTRIES: countries,
    },
    { fetch: healthFetch },
  );
}

async function hostTicket(
  remote: RemoteControlPlane,
  hostId: string,
  placement?: {
    signalHome: boolean | null;
    failedSignalUrl: string | null;
    location?: SignalLocation | null;
    country?: string | null;
  },
) {
  const answer = await Effect.runPromise(remote.issueHostTicket(hostId, machineToken(hostId), placement));
  return { signalUrl: answer.signalUrl, signal: await signalClaim(answer.ticket) };
}

async function sessionTicket(remote: RemoteControlPlane, hostId: string) {
  const answer = await Effect.runPromise(remote.issueSessionTicket("owner", `session-${hostId}`, "client-public-key"));
  return { signalUrl: answer.signalUrl, signal: await signalClaim(answer.ticket) };
}

async function outcome<A, E>(operation: Effect.Effect<A, E>): Promise<string> {
  return Effect.runPromise(
    operation.pipe(
      Effect.match({
        onSuccess: () => "ok",
        onFailure: (error) =>
          typeof error === "object" && error !== null && "code" in error ? String(error.code) : "failure",
      }),
    ),
  );
}

const asks = (failedSignalUrl: string | null = null) => ({ signalHome: true, failedSignalUrl });
const asksFrom = (location: SignalLocation | null, failedSignalUrl: string | null = null) => ({
  signalHome: true,
  failedSignalUrl,
  location,
});
const asksFromCountry = (location: SignalLocation | null, country: string, failedSignalUrl: string | null = null) => ({
  signalHome: true,
  failedSignalUrl,
  location,
  country,
});

async function aHostGetsKeepsAndMovesItsHome() {
  const database = await hostsWithSessions(["host-1"]);
  const remote = plane(database, HOMES);
  const expected = rendezvous("host-1");
  const other = expected === "a" ? "b" : "a";
  const first = await hostTicket(remote, "host-1", asks());
  check(
    "a host that asks for a home gets the rendezvous home URL and its signal claim",
    first.signal === expected && first.signalUrl === HOME_URLS[expected] && storedHome(database, "host-1") === expected,
    { first, expected, stored: storedHome(database, "host-1") },
  );
  const again = await hostTicket(remote, "host-1", asks());
  check("the host keeps its home", again.signal === expected && again.signalUrl === HOME_URLS[expected], { again });
  const otherFailed = await hostTicket(remote, "host-1", asks(HOME_URLS[other]));
  check(
    "a failure of another Signal keeps the home",
    otherFailed.signal === expected && storedHome(database, "host-1") === expected,
    { otherFailed },
  );
  const plain = await hostTicket(remote, "host-1", { signalHome: false, failedSignalUrl: null });
  check(
    "a host ticket with signalHome false names the entry Signal, no claim, and keeps the stored home",
    plain.signal === "none" && plain.signalUrl === ENTRY_URL && storedHome(database, "host-1") === expected,
    { plain, stored: storedHome(database, "host-1") },
  );
  const member = await sessionTicket(remote, "host-1");
  check(
    "a session ticket of the host names its home and claim",
    member.signal === expected && member.signalUrl === HOME_URLS[expected],
    { member },
  );
  const moved = await hostTicket(remote, "host-1", asks(HOME_URLS[expected]));
  check(
    "a failure of the home moves the host to the other home",
    moved.signal === other && moved.signalUrl === HOME_URLS[other] && storedHome(database, "host-1") === other,
    { moved, stored: storedHome(database, "host-1") },
  );
  const followed = await sessionTicket(remote, "host-1");
  check("the session ticket follows the new home", followed.signal === other, { followed });

  const oneHome = plane(database, `${other}=${HOME_URLS[other]}`);
  const onlyHome = await hostTicket(oneHome, "host-1", asks(HOME_URLS[other]));
  check(
    "when the failed URL excludes each home, the host keeps one of them",
    onlyHome.signal === other && onlyHome.signalUrl === HOME_URLS[other],
    { onlyHome },
  );

  const removed = plane(database, `${expected}=${HOME_URLS[expected]}`);
  const removedSession = await sessionTicket(removed, "host-1");
  check(
    "a session ticket of a host whose home is no longer configured names the entry Signal and no claim",
    removedSession.signal === "none" && removedSession.signalUrl === ENTRY_URL,
    { removedSession },
  );
  const replaced = await hostTicket(removed, "host-1", asks());
  check(
    "a host whose home is no longer configured gets a configured home",
    replaced.signal === expected && storedHome(database, "host-1") === expected,
    { replaced, stored: storedHome(database, "host-1") },
  );

  const released = await hostTicket(remote, "host-1");
  const releasedMember = await sessionTicket(remote, "host-1");
  check(
    "a released host build that sends no signalHome removes the stored home, and its members use the entry Signal",
    released.signal === "none" &&
      released.signalUrl === ENTRY_URL &&
      storedHome(database, "host-1") === "none" &&
      releasedMember.signal === "none" &&
      releasedMember.signalUrl === ENTRY_URL,
    { released, releasedMember, stored: storedHome(database, "host-1") },
  );
}

async function noHomesKeepsTheEntrySignal() {
  const database = await hostsWithSessions(["host-1"]);
  const remote = plane(database, "");
  const host = await hostTicket(remote, "host-1", asks());
  const member = await sessionTicket(remote, "host-1");
  check(
    "with no homes, a host that asks for one gets the entry Signal, no claim and no stored home",
    host.signal === "none" && host.signalUrl === ENTRY_URL && storedHome(database, "host-1") === "none",
    { host, stored: storedHome(database, "host-1") },
  );
  check(
    "with no homes, a session ticket names the entry Signal and no claim",
    member.signal === "none" && member.signalUrl === ENTRY_URL,
    { member },
  );
  database.prepare("UPDATE remote_hosts SET signal_home = 'a' WHERE host_id = 'host-1'").run();
  const homedMember = await sessionTicket(remote, "host-1");
  check(
    "with no homes, a stored home is not used",
    homedMember.signal === "none" && homedMember.signalUrl === ENTRY_URL,
    { homedMember },
  );
}

async function anInvalidHomeListFailsClosed() {
  const database = await hostsWithSessions(["host-1"]);
  const invalid = {
    "an ID with capitals": `A=${HOME_URLS.a}`,
    "a duplicate ID": `a=${HOME_URLS.a},a=${HOME_URLS.b}`,
    "an entry with no URL": "a",
    "a ws URL beside a wss entry": "a=ws://signal-a.test/v1/signal",
    "an https URL": "a=https://signal-a.test/v1/signal",
  };
  for (const [name, homes] of Object.entries(invalid)) {
    const remote = plane(database, homes);
    const host = await outcome(remote.issueHostTicket("host-1", machineToken("host-1"), asks()));
    const member = await outcome(remote.issueSessionTicket("owner", "session-host-1", "client-public-key"));
    check(
      `${name} fails each ticket with remote_not_configured`,
      host === "remote_not_configured" && member === "remote_not_configured",
      { host, member },
    );
  }
  const invalidEntry = await outcome(
    plane(database, `a=${HOME_URLS.a}`, "signal.test").issueHostTicket("host-1", machineToken("host-1"), asks()),
  );
  check("an entry URL that does not parse fails with remote_not_configured", invalidEntry === "remote_not_configured", {
    invalidEntry,
  });
  const wrongToken = await outcome(plane(database, "a").issueHostTicket("host-1", "wrong", asks()));
  check("a wrong host credential still fails first", wrongToken === "host_unauthorized", { wrongToken });
  const local = plane(database, "a=ws://127.0.0.1:8082/v1/signal", "ws://127.0.0.1:8081/v1/signal");
  const localHost = await hostTicket(local, "host-1", asks());
  check(
    "a ws home is valid beside a ws entry Signal",
    localHost.signal === "a" && localHost.signalUrl === "ws://127.0.0.1:8082/v1/signal",
    { localHost },
  );
}

async function racingRequestsStoreOneHome() {
  const database = await hostsWithSessions(["host-1"]);
  const d1 = sqliteD1(database);
  let arrived = 0;
  let openGate = () => {};
  const gate = new Promise<void>((done) => {
    openGate = done;
  });
  const deadline = setTimeout(openGate, WAIT_LIMIT_MS);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (query: string) => {
    const prepared = prepare(query);
    if (!query.startsWith("UPDATE remote_hosts SET signal_home")) return prepared;
    const bind = prepared.bind.bind(prepared);
    prepared.bind = (...values: unknown[]) => {
      const bound = bind(...values);
      const run = bound.run.bind(bound);
      bound.run = async <T>() => {
        arrived += 1;
        if (arrived === 2) openGate();
        await gate;
        return run<T>();
      };
      return bound;
    };
    return prepared;
  };
  const remote = plane(d1, HOMES);
  const [first, second] = await Promise.all([
    hostTicket(remote, "host-1", asks(HOME_URLS.a)),
    hostTicket(remote, "host-1", asks(HOME_URLS.b)),
  ]);
  clearTimeout(deadline);
  const stored = storedHome(database, "host-1");
  check(
    "two racing requests both write, and both answers name the one stored home",
    arrived === 2 && first.signal === stored && second.signal === stored && first.signalUrl === second.signalUrl,
    { arrived, first, second, stored },
  );
}

async function hostsSpreadOverTheHomes() {
  const hostIds = Array.from({ length: 40 }, (_, index) => `spread-${index}`);
  const remote = plane(await hostsWithSessions(hostIds), HOMES);
  const homes: string[] = [];
  for (const hostId of hostIds) homes.push((await hostTicket(remote, hostId, asks())).signal);
  const mismatches = hostIds.filter((hostId, index) => homes[index] !== rendezvous(hostId));
  const counts = { a: homes.filter((home) => home === "a").length, b: homes.filter((home) => home === "b").length };
  check("each host gets its rendezvous home", mismatches.length === 0, { mismatches });
  check("40 hosts use both homes", counts.a > 0 && counts.b > 0, counts);
}

async function hostsGetANearHome() {
  const hostIds = ["near-1", "near-2", "near-3", "near-4", "near-5", "near-6", "near-7"];
  const database = await hostsWithSessions(hostIds);
  const remote = plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS);
  const newYork = await hostTicket(remote, "near-1", asksFrom(PLACES.newYork));
  check(
    "a host in New York gets the San Jose home",
    newYork.signal === "us" && newYork.signalUrl === REGION_URLS.us && storedHome(database, "near-1") === "us",
    { newYork },
  );
  const sydney = await hostTicket(remote, "near-2", asksFrom(PLACES.sydney));
  check("a host in Sydney gets the Sydney home", sydney.signal === "au" && sydney.signalUrl === REGION_URLS.au, {
    sydney,
  });
  const berlin = await hostTicket(remote, "near-3", asksFrom(PLACES.berlin));
  check(
    "a host in Berlin gets the rendezvous choice of the two Helsinki homes",
    berlin.signal === rendezvousOf("near-3", ["a", "b"] as const),
    { berlin, expected: rendezvousOf("near-3", ["a", "b"] as const) },
  );
  const unknown = await hostTicket(remote, "near-4", asksFrom(null));
  const allIds: string[] = Object.keys(REGION_URLS);
  check(
    "a host request with no place gets the rendezvous choice of each home",
    unknown.signal === rendezvousOf("near-4", allIds),
    { unknown, expected: rendezvousOf("near-4", allIds) },
  );

  database.prepare("UPDATE remote_hosts SET signal_home = 'a' WHERE host_id = 'near-5'").run();
  const before = await sessionTicket(remote, "near-5");
  const moved = await hostTicket(remote, "near-5", asksFrom(PLACES.sydney));
  const followed = await sessionTicket(remote, "near-5");
  check(
    "a host in Sydney with a stored Helsinki home moves to the Sydney home, and its members follow",
    before.signal === "a" &&
      moved.signal === "au" &&
      storedHome(database, "near-5") === "au" &&
      followed.signal === "au" &&
      followed.signalUrl === REGION_URLS.au,
    { before, moved, followed },
  );
  const other = rendezvousOf("near-3", ["a", "b"] as const) === "a" ? "b" : "a";
  database.prepare("UPDATE remote_hosts SET signal_home = ? WHERE host_id = 'near-3'").run(other);
  const kept = await hostTicket(remote, "near-3", asksFrom(PLACES.berlin));
  check(
    "a host in Berlin keeps a stored Helsinki home that the hash would not choose",
    kept.signal === other && storedHome(database, "near-3") === other,
    { kept, other },
  );
  database.prepare("UPDATE remote_hosts SET signal_home = 'us' WHERE host_id = 'near-6'").run();
  const unplaced = await hostTicket(remote, "near-6", asksFrom(null));
  check("a host request with no place keeps any stored home", unplaced.signal === "us", { unplaced });

  const failed = await hostTicket(remote, "near-2", asksFrom(PLACES.sydney, REGION_URLS.au));
  check(
    "a host in Sydney whose home failed gets the next nearest home, San Jose",
    failed.signal === "us" && storedHome(database, "near-2") === "us",
    { failed },
  );
  downMachines.add("signal-au.test");
  healthRequests.length = 0;
  const stillDown = await hostTicket(remote, "near-2", asksFrom(PLACES.sydney));
  check(
    "while its Sydney home does not answer, the host keeps the San Jose home and its members stay",
    stillDown.signal === "us" &&
      storedHome(database, "near-2") === "us" &&
      (await sessionTicket(remote, "near-2")).signal === "us" &&
      healthRequests.includes("https://signal-au.test/health/ready"),
    { stillDown, healthRequests: [...healthRequests] },
  );
  downMachines.delete("signal-au.test");
  const back = await hostTicket(remote, "near-2", asksFrom(PLACES.sydney));
  check(
    "when its Sydney home answers again, the host goes back to it",
    back.signal === "au" && storedHome(database, "near-2") === "au",
    { back },
  );
  downMachines.add("signal-us.test");
  healthRequests.length = 0;
  const firstHome = await hostTicket(remote, "near-7", asksFrom(PLACES.newYork));
  const failedAway = await hostTicket(remote, "near-1", asksFrom(PLACES.newYork, REGION_URLS.us));
  downMachines.delete("signal-us.test");
  check(
    "a host with no stored home, or whose home failed, gets its home with no health request",
    firstHome.signal === "us" && failedAway.signal !== "us" && healthRequests.length === 0,
    { firstHome, failedAway, healthRequests: [...healthRequests] },
  );
  database.prepare("UPDATE remote_hosts SET signal_home = 'us' WHERE host_id = 'near-1'").run();
  const tokyo = await hostTicket(remote, "near-1", asksFrom(PLACES.tokyo));
  check(
    "a host whose stored home is within the margin of the nearest home keeps it (Tokyo: Sydney 7,800 km, San Jose 8,200 km)",
    tokyo.signal === "us",
    { tokyo },
  );
}

async function invalidLocationsFailClosed() {
  const database = await hostsWithSessions(["host-1"]);
  const invalid = {
    "a location list that misses a home": "a=60.17:24.94, b=60.17:24.94",
    "a location of an ID that is not a home": `${REGION_LOCATIONS}, eu=50:10`,
    "a latitude out of range": "a=91:24.94, b=60.17:24.94, us=37.34:-121.89, au=-33.87:151.21",
    "a location with no longitude": "a=60.17, b=60.17:24.94, us=37.34:-121.89, au=-33.87:151.21",
    "a location that is not a number": "a=north:east, b=60.17:24.94, us=37.34:-121.89, au=-33.87:151.21",
    "a duplicate location": `${REGION_LOCATIONS}, a=60.17:24.94`,
  };
  for (const [name, locations] of Object.entries(invalid)) {
    const remote = plane(database, REGION_HOMES, ENTRY_URL, locations);
    const host = await outcome(remote.issueHostTicket("host-1", machineToken("host-1"), asksFrom(PLACES.berlin)));
    const member = await outcome(remote.issueSessionTicket("owner", "session-host-1", "client-public-key"));
    check(
      `${name} fails each ticket with remote_not_configured`,
      host === "remote_not_configured" && member === "remote_not_configured",
      { host, member },
    );
  }
  const rolledBack = await hostTicket(
    plane(database, "", ENTRY_URL, REGION_LOCATIONS),
    "host-1",
    asksFrom(PLACES.berlin),
  );
  check(
    "an empty home list with locations still set rolls back to the entry Signal",
    rolledBack.signal === "none" && rolledBack.signalUrl === ENTRY_URL,
    { rolledBack },
  );
}

async function hostsInAListedCountryGetItsHomes() {
  const hostIds = ["cn-1", "cn-2", "cn-3", "cn-4", "cn-5", "cn-6", "cn-7", "cn-8", "de-1"];
  const database = await hostsWithSessions(hostIds);
  const remote = plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS, "CN=us+au");
  const chinaHomes = ["us", "au"] as const;
  const withoutRule = await hostTicket(
    plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS),
    "cn-8",
    asksFromCountry(PLACES.beijing, "CN"),
  );
  check("with no country rule, a host in Beijing gets a Helsinki home", ["a", "b"].includes(withoutRule.signal), {
    withoutRule,
  });
  const placed: Record<string, string> = {};
  for (const hostId of ["cn-1", "cn-2", "cn-3", "cn-4", "cn-5"])
    placed[hostId] = (await hostTicket(remote, hostId, asksFromCountry(PLACES.beijing, "CN"))).signal;
  check(
    "hosts in Beijing get the rendezvous choice of the homes of their country, and use both",
    Object.entries(placed).every(([hostId, home]) => home === rendezvousOf(hostId, chinaHomes)) &&
      new Set(Object.values(placed)).size === 2,
    { placed },
  );
  const noPlace = await hostTicket(remote, "cn-6", asksFromCountry(null, "CN"));
  check(
    "a host in a listed country with no known place gets a home of its country",
    noPlace.signal === rendezvousOf("cn-6", chinaHomes),
    { noPlace },
  );
  const berlin = await hostTicket(remote, "de-1", asksFromCountry(PLACES.berlin, "DE"));
  check("a host in a country that is not listed keeps the distance rule", ["a", "b"].includes(berlin.signal), {
    berlin,
  });

  database.prepare("UPDATE remote_hosts SET signal_home = 'a' WHERE host_id = 'cn-7'").run();
  const before = await sessionTicket(remote, "cn-7");
  const moved = await hostTicket(remote, "cn-7", asksFromCountry(PLACES.beijing, "CN"));
  const followed = await sessionTicket(remote, "cn-7");
  check(
    "a host in China with a stored Helsinki home moves to a home of its country, and its members follow",
    before.signal === "a" &&
      moved.signal === rendezvousOf("cn-7", chinaHomes) &&
      storedHome(database, "cn-7") === moved.signal &&
      followed.signal === moved.signal,
    { before, moved, followed },
  );
  const other = rendezvousOf("cn-1", chinaHomes) === "us" ? "au" : "us";
  database.prepare("UPDATE remote_hosts SET signal_home = ? WHERE host_id = 'cn-1'").run(other);
  const kept = await hostTicket(remote, "cn-1", asksFromCountry(PLACES.beijing, "CN"));
  check("a host in China keeps a stored home of its country that the hash would not choose", kept.signal === other, {
    kept,
    other,
  });
  const failed = await hostTicket(remote, "cn-1", asksFromCountry(PLACES.beijing, "CN", REGION_URLS[other]));
  check(
    "a host in China whose home failed gets the other home of its country",
    failed.signal === (other === "us" ? "au" : "us") && storedHome(database, "cn-1") === failed.signal,
    { failed },
  );
  const usOnly = plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS, "CN=us");
  const fallback = await hostTicket(usOnly, "cn-2", asksFromCountry(PLACES.beijing, "CN", REGION_URLS.us));
  check(
    "when the only home of its country failed, the distance rule chooses again (Helsinki for Beijing)",
    ["a", "b"].includes(fallback.signal),
    { fallback },
  );
  const placedInChina = await hostTicket(remote, "cn-3", asksFromCountry(PLACES.beijing, "CN"));
  const reverted = plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS, "");
  const movedBack = await hostTicket(reverted, "cn-3", asksFromCountry(PLACES.beijing, "CN"));
  const membersBack = await sessionTicket(reverted, "cn-3");
  check(
    "after the country rule is set to empty, a host in China moves back to a Helsinki home, and its members follow",
    ["us", "au"].includes(placedInChina.signal) &&
      ["a", "b"].includes(movedBack.signal) &&
      storedHome(database, "cn-3") === movedBack.signal &&
      membersBack.signal === movedBack.signal,
    { placedInChina, movedBack, membersBack },
  );
}

async function invalidCountriesFailClosed() {
  const database = await hostsWithSessions(["host-1"]);
  const invalid = {
    "a country rule with a home that is not configured": "CN=us+hk",
    "a country rule with no home": "CN=",
    "a lower-case country code": "cn=us",
    "a country code with three letters": "CHN=us",
    "a duplicate country": "CN=us, CN=au",
    "a duplicate home in one country": "CN=us+us",
    "a country rule with no equals sign": "CN",
  };
  for (const [name, countries] of Object.entries(invalid)) {
    const remote = plane(database, REGION_HOMES, ENTRY_URL, REGION_LOCATIONS, countries);
    const host = await outcome(
      remote.issueHostTicket("host-1", machineToken("host-1"), asksFromCountry(PLACES.beijing, "CN")),
    );
    const member = await outcome(remote.issueSessionTicket("owner", "session-host-1", "client-public-key"));
    check(
      `${name} fails each ticket with remote_not_configured`,
      host === "remote_not_configured" && member === "remote_not_configured",
      { host, member },
    );
  }
  const rolledBack = await hostTicket(
    plane(database, "", ENTRY_URL, REGION_LOCATIONS, "CN=us+au"),
    "host-1",
    asksFromCountry(PLACES.beijing, "CN"),
  );
  check(
    "an empty home list with a country rule still set rolls back to the entry Signal",
    rolledBack.signal === "none" && rolledBack.signalUrl === ENTRY_URL,
    { rolledBack },
  );
}

const scenarios = [
  aHostGetsKeepsAndMovesItsHome,
  noHomesKeepsTheEntrySignal,
  anInvalidHomeListFailsClosed,
  racingRequestsStoreOneHome,
  hostsSpreadOverTheHomes,
  hostsGetANearHome,
  invalidLocationsFailClosed,
  hostsInAListedCountryGetItsHomes,
  invalidCountriesFailClosed,
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
