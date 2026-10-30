// Runs the real central auth manager against a local account server. A stored session that the
// Keychain cannot decrypt at startup, or a later write that fails, must leave the session file on
// disk: before this, both deleted it and the app was signed out after the next restart. A failed
// write after an email sign-in must still remove a file that holds the previous session.
//
// Run: bun scripts/central-auth-session-file-e2e.ts
// It writes .openbot-build/central-auth-session-file-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { teeLogLines } from "@openbot/logging";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "central-auth-session-file-e2e");
const SESSION_TOKEN = "s".repeat(48);
const NEW_SESSION_TOKEN = "n".repeat(48);
const HOST_ID = "00000000-0000-4000-8000-000000000001";

const server = createServer((request, response) => {
  const answer = (status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/health/live") return answer(200, { status: "ok" });
  if (request.url === "/v1/auth/email/verify") {
    return answer(200, {
      sessionToken: NEW_SESSION_TOKEN,
      user: { id: "user-2", email: "b@example.com", name: null, avatarUrl: null },
    });
  }
  if (request.headers.authorization !== `Bearer ${SESSION_TOKEN}`) return answer(401, { error: "unauthorized" });
  if (request.url === "/v1/me")
    return answer(200, { id: "user-1", email: "a@example.com", name: null, avatarUrl: null });
  if (request.url === "/v2/remote/hosts/register") {
    return answer(200, {
      hostId: HOST_ID,
      name: "Host",
      membershipId: "m-1",
      authEpoch: 2,
      machineToken: "m".repeat(40),
    });
  }
  answer(404, { error: "not_found" });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const root = await mkdtemp(join(tmpdir(), "openbot-central-auth-file-"));
const storagePath = join(root, "session.bin");
const stored = Buffer.from(JSON.stringify({ version: 2, sessionToken: SESSION_TOKEN })).toString("base64");
const logLines: string[] = [];
const stopLog = teeLogLines(["central-auth"], (line) => logLines.push(line));

function manager(options: { decrypt?: () => string; encrypt?: () => Buffer } = {}) {
  return new CentralAuthManager({
    apiUrl: `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`,
    storagePath,
    encrypt: options.encrypt ?? ((value) => Buffer.from(value)),
    decrypt: options.decrypt ?? ((value) => value.toString()),
  });
}

const results: Record<string, string> = {};
let passed = false;
let error: string | undefined;
try {
  await writeFile(storagePath, stored);

  // 1. The Keychain cannot decrypt the file at startup.
  const locked = manager({
    decrypt: () => {
      throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
    },
  });
  results.decryptFailure = (await runCauseEffect(locked.initialize())).status;
  await runCauseEffect(locked.dispose());
  assert.equal(results.decryptFailure, "signed_out");
  assert.equal(await readFile(storagePath, "utf8"), stored, "a failed decrypt must keep the session file");

  // 2. The next start can decrypt it again.
  const unlocked = manager();
  results.nextStart = (await runCauseEffect(unlocked.initialize())).status;
  assert.equal(results.nextStart, "signed_in");

  // 3. A write after sign-in fails, as the host registration write does.
  let failWrites = false;
  const failing = manager({
    encrypt: () => {
      if (failWrites) throw new Error("Error while encrypting the text provided to safeStorage.encryptString.");
      return Buffer.from(JSON.stringify({ version: 2, sessionToken: SESSION_TOKEN }));
    },
  });
  results.beforeWriteFailure = (await runCauseEffect(failing.initialize())).status;
  failWrites = true;
  const registered = await runCauseEffect(
    failing.registerRemoteHost({ hostId: HOST_ID, name: "Host", ownerMembershipId: "m-1" }),
  );
  await runCauseEffect(failing.dispose());
  await runCauseEffect(unlocked.dispose());
  assert.equal(registered.authEpoch, 2);
  assert.equal(await readFile(storagePath, "utf8"), stored, "a failed write must keep the session file");

  // 4. The restart after the failed write is still signed in.
  const restarted = manager();
  results.afterWriteFailure = (await runCauseEffect(restarted.initialize())).status;
  await runCauseEffect(restarted.dispose());
  assert.equal(results.afterWriteFailure, "signed_in");

  // 5. An email sign-in cannot store its new session. The file holds the previous one, which the next
  // start must not sign in to.
  const switching = manager({
    encrypt: () => {
      throw new Error("Error while encrypting the text provided to safeStorage.encryptString.");
    },
  });
  results.beforeSignIn = (await runCauseEffect(switching.initialize())).status;
  results.signIn = (await runCauseEffect(switching.verifyEmailCode("challenge-1", "123456"))).status;
  await runCauseEffect(switching.dispose());
  assert.equal(results.signIn, "signed_in");
  await assert.rejects(readFile(storagePath), { code: "ENOENT" }, "the previous session must not stay on disk");
  const afterSignIn = manager();
  results.afterFailedSignInWrite = (await runCauseEffect(afterSignIn.initialize())).status;
  await runCauseEffect(afterSignIn.dispose());
  assert.equal(results.afterFailedSignInWrite, "signed_out");

  // 6. The account log names each failed stage and holds no token.
  assert.ok(
    logLines.some((line) => line.includes('"decrypt"')),
    "the decrypt failure must be logged",
  );
  assert.ok(
    logLines.some((line) => line.includes('"encrypt"')),
    "the write failure must be logged",
  );
  assert.ok(
    !logLines.some((line) => line.includes(SESSION_TOKEN) || line.includes(NEW_SESSION_TOKEN)),
    "the log must not hold a session token",
  );
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  stopLog();
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, results, logLines, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}
