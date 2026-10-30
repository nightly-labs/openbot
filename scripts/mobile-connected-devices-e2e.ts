// Runs the real desktop account client against the real account service on a migrated SQLite database
// (#2356). The desktop signs in with an email code, a joined server ("contabo-bot") shows a Mobile
// Connect code, and a phone redeems it. The Connected devices list of the local computer must not show
// that phone while the local computer is not in the account directory, because the phone cannot open
// it. The list must show the phone for the joined server and after the local computer is published, and
// the desktop must still revoke it.
//
// Run: bun run test:mobile-connected-devices
// It writes .openbot-build/mobile-connected-devices-e2e/report.json and exits non-zero on a failure.
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { type MobileConnectHostBinding, parseMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-connected-devices-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SERVER = join(ROOT, "apps", "auth-api", "scripts", "mobile-connected-devices-server.ts");
const START_LIMIT_MS = 20_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

/** The session IDs of a device list answer. */
function sessionIdsOf(body: unknown): string[] {
  if (!isDynamicRecord(body) || !Array.isArray(body.devices)) return [];
  return body.devices.flatMap((device) =>
    isDynamicRecord(device) && isString(device.sessionId) ? [device.sessionId] : [],
  );
}

/** A string field of a JSON object, or an empty string. */
function stringField(value: unknown, key: string): string {
  if (!isDynamicRecord(value)) return "";
  const field = value[key];
  return isString(field) ? field : "";
}

/** The error code of an error answer. */
function errorCodeOf(body: unknown): string | null {
  return isDynamicRecord(body) && isDynamicRecord(body.error) && isString(body.error.code) ? body.error.code : null;
}

/** A host identity as the desktop keeps it: the fingerprint is the SHA-256 of the device public key. */
function hostIdentity(deviceKey: string): MobileConnectHostBinding {
  return { hostId: randomUUID(), fingerprint: createHash("sha256").update(deviceKey).digest("base64url") };
}

/** Adds a host to the account directory, as a publish does: an active owner membership and a key. */
function publishHost(database: DatabaseSync, input: { hostId: string; deviceKey: string; userId: string }) {
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET device_public_key = excluded.device_public_key`,
    )
    .run(input.hostId, input.userId, input.hostId, input.deviceKey, now, now);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 'active', ?, ?)
       ON CONFLICT(host_id, user_id) DO UPDATE SET status = 'active'`,
    )
    .run(randomUUID(), input.hostId, input.userId, now, now);
}

/** Starts the account service over the database file and resolves with its port. */
function startAccountServer(databasePath: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, [SERVER, databasePath], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("The account server did not start.")), START_LIMIT_MS);
    child.once("exit", (code) => reject(new Error(`The account server stopped with code ${code}.`)));
    if (!child.stdout) return reject(new Error("The account server has no output."));
    createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      const port = Number(JSON.parse(line).port);
      if (!Number.isInteger(port)) return reject(new Error("The account server has no port."));
      resolvePort({ child, port });
    });
  });
}

const root = await mkdtemp(join(tmpdir(), "openbot-mobile-connected-devices-"));
const databasePath = join(root, "auth.db");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");
for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));

let server: ChildProcess | undefined;
let error: string | undefined;
try {
  const started = await startAccountServer(databasePath);
  server = started.child;
  const apiUrl = `http://127.0.0.1:${started.port}`;
  const desktop = new CentralAuthManager({
    apiUrl,
    storagePath: join(root, "session.bin"),
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  try {
    await runCauseEffect(desktop.initialize());
    const sent = await runCauseEffect(desktop.requestEmailCode("owner@example.com"));
    if (sent.status !== "code_sent" || !sent.developmentCode) throw new Error("The desktop got no sign-in code.");
    const signedIn = await runCauseEffect(desktop.verifyEmailCode(sent.challengeId, sent.developmentCode));
    if (signedIn.status !== "signed_in") throw new Error("The desktop did not sign in.");
    const userId = signedIn.user.id;

    // The joined server is in the account directory. The local computer has a host identity, but it is
    // not published, so the phone cannot open it.
    const joinedKey = "joined-device-public-key";
    const localKey = "local-device-public-key";
    const joined = hostIdentity(joinedKey);
    const local = hostIdentity(localKey);
    publishHost(database, { hostId: joined.hostId, deviceKey: joinedKey, userId });

    // The joined server shows a code that is bound to its host key, with the account session of this
    // account. The phone redeems it as the phone app does.
    const code = await runCauseEffect(desktop.createMobileConnect(joined));
    const ticket = parseMobileConnectUrl(code.qrData)?.ticket;
    if (!ticket) throw new Error("The Mobile Connect code has no ticket.");
    const redeem = await fetch(`${apiUrl}/v1/mobile-auth/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, deviceId: randomUUID(), deviceName: "iPhone", platform: "ios" }),
    });
    const phoneToken = stringField(await redeem.json(), "sessionToken");
    if (redeem.status !== 200 || !phoneToken)
      throw new Error(`The phone could not redeem the code (${redeem.status}).`);
    const phoneSessionId = database
      .prepare("SELECT session_id FROM mobile_auth_sessions WHERE user_id = ?")
      .get(userId)?.session_id;
    if (!isString(phoneSessionId)) throw new Error("The phone session is missing in the database.");

    const ids = async (host: MobileConnectHostBinding | null) =>
      (await runCauseEffect(desktop.listMobileConnectedDevices(host))).map((device) => device.sessionId);
    const accountToken = async () => {
      // The desktop keeps its token in the session file; the identity encryption above makes it readable.
      const stored = Buffer.from(await readFile(join(root, "session.bin"), "utf8"), "base64").toString();
      return stringField(JSON.parse(stored), "sessionToken");
    };

    const onLocal = await ids(local);
    check("a phone on the joined server only is not listed on the local computer", onLocal.length === 0, onLocal);

    const onJoined = await ids(joined);
    check("the phone is listed for the joined server", onJoined.includes(phoneSessionId), onJoined);

    const noIdentity = await ids(null);
    check("a computer with no host identity lists no phones", noIdentity.length === 0, noIdentity);

    // An earlier desktop sends no host and still gets every phone of the account.
    const token = await accountToken();
    const earlier = await fetch(`${apiUrl}/v1/mobile-auth/devices`, { headers: { Authorization: `Bearer ${token}` } });
    const earlierIds = sessionIdsOf(await earlier.json());
    check(
      "a request with no host keeps the earlier account-wide list",
      earlier.status === 200 && earlierIds.includes(phoneSessionId),
      { status: earlier.status, devices: earlierIds },
    );

    const invalid = await fetch(`${apiUrl}/v1/mobile-auth/devices?host=${encodeURIComponent("not a host")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const invalidCode = errorCodeOf(await invalid.json());
    check("an invalid host ID gets a 400 answer", invalid.status === 400 && invalidCode === "invalid_mobile_host", {
      status: invalid.status,
      code: invalidCode,
    });

    // A host with a key but a revoked membership is not in the directory of this account.
    database
      .prepare("UPDATE remote_memberships SET status = 'revoked' WHERE host_id = ? AND user_id = ?")
      .run(joined.hostId, userId);
    const revokedMembership = await ids(joined);
    check("a host with a revoked membership lists no phones", revokedMembership.length === 0, revokedMembership);
    database
      .prepare("UPDATE remote_memberships SET status = 'active' WHERE host_id = ? AND user_id = ?")
      .run(joined.hostId, userId);

    // A registered host with an owner membership but no key is not in the directory yet.
    publishHost(database, { hostId: local.hostId, deviceKey: localKey, userId });
    database.prepare("UPDATE remote_hosts SET device_public_key = NULL WHERE host_id = ?").run(local.hostId);
    const noKey = await ids(local);
    check("a local host with no device key lists no phones", noKey.length === 0, noKey);

    // After the local computer is published, the phone can open it, so the list shows it.
    publishHost(database, { hostId: local.hostId, deviceKey: localKey, userId });
    const published = await ids(local);
    check(
      "the phone is listed on the local computer after it is published",
      published.includes(phoneSessionId),
      published,
    );

    await runCauseEffect(desktop.revokeMobileConnectedDevice(phoneSessionId));
    const afterLocal = await ids(local);
    const afterJoined = await ids(joined);
    const revokedAt = database
      .prepare("SELECT revoked_at FROM auth_sessions WHERE id = ?")
      .get(phoneSessionId)?.revoked_at;
    check(
      "the desktop revokes the phone, and the phone leaves the list of each host",
      afterLocal.length === 0 && afterJoined.length === 0 && isNumber(revokedAt),
      { local: afterLocal, joined: afterJoined, revokedAt: revokedAt ?? null },
    );
    const phoneMe = await fetch(`${apiUrl}/v1/me`, { headers: { Authorization: `Bearer ${phoneToken}` } });
    check("the revoked phone cannot use its session", phoneMe.status === 401, phoneMe.status);
  } finally {
    await runCauseEffect(desktop.dispose());
  }
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  // Stop only the account server that this script started.
  if (server && server.exitCode === null) {
    const stopped = new Promise((done) => server?.once("exit", done));
    server.kill("SIGTERM");
    await stopped;
  }
  database.close();
  await rm(root, { recursive: true, force: true });
}

const passed = !error && checks.length > 0 && checks.every((item) => item.passed);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks, error }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "PASS" : "FAIL"} ${item.name}\n`);
process.stdout.write(
  `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
);
if (!passed) process.exitCode = 1;
