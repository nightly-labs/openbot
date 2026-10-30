// Runs the real `SignInRelayHost` replay against a fake loopback sign-in that acts as `codex login`
// does (#3864): its callback saves the sign-in and redirects to its own `/success` page, and the
// process ends only when that page loads. The replay must load it, so a second Codex account on a
// joined server finishes. A success page that fails does not undo the callback, and a redirect to a
// different address must not be followed.
// `bun run test:sign-in-relay-replay`. Writes .openbot-build/sign-in-relay-replay-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import type { McpTestResult } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { SignInRelayHost } from "../src/main/sign-in-relay-host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sign-in-relay-replay-e2e");
const MEMBER = "member-1";
const STATE = "relay-state";

interface FakeLogin {
  port: number;
  paths: string[];
  /** True when the success page loaded, as when `codex login` exits. */
  exited: () => boolean;
  close: () => Promise<void>;
}

/** A loopback sign-in whose callback redirects to `successAt(port)`, and that ends on `/success`. */
async function fakeLogin(successAt: (port: number) => string): Promise<FakeLogin> {
  const paths: string[] = [];
  let exited = false;
  let port = 0;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    paths.push(url.pathname);
    if (url.pathname === "/auth/callback" && url.searchParams.get("state") === STATE) {
      response.writeHead(302, { Location: successAt(port) }).end();
      return;
    }
    if (url.pathname === "/success") {
      exited = true;
      response.writeHead(200, { "Content-Type": "text/html" }).end("Signed in");
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address !== null && typeof address === "object") port = address.port;
  return {
    port,
    paths,
    exited: () => exited,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

interface CaseResult {
  name: string;
  loginPaths: string[];
  loginExited: boolean;
  otherPaths: string[];
  result: McpTestResult | null;
}

/** One relayed sign-in: the host replays the client's callback to `login`. */
async function runCase(name: string, successAt: (port: number, otherPort: number) => string): Promise<CaseResult> {
  const other = await fakeLogin(() => "/");
  const login = await fakeLogin((port) => successAt(port, other.port));
  try {
    const redirectUri = `http://127.0.0.1:${login.port}/auth/callback`;
    const pageUrl = `https://auth.example/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${STATE}`;
    // A replay flow uses none of these: the sign-in that it relays to is the one in `startReplay`.
    const unused = () => Effect.die(new Error("A replay does not start a sign-in."));
    const noPage = () => ({ pageUrl: null, result: null });
    const host = new SignInRelayHost({
      mcp: { startRelay: unused, relayStatus: noPage, cancel: () => undefined },
      providers: { startRelay: unused, relayStatus: noPage, cancel: unused },
      accounts: { startRelay: unused, relayStatus: noPage, cancelSignIn: unused },
      receiveMcpGrant: () => false,
      printedLink: () => false,
    });
    const { flowId } = host.startReplay(MEMBER, {
      key: "account\ncodex",
      // The account sign-in ends when its `codex login` exits.
      status: () => ({
        pageUrl: login.exited() ? null : pageUrl,
        result: login.exited() ? { toolCount: 0, error: null } : null,
      }),
      cancel: () => Effect.void,
    });
    const view = await Effect.runPromise(host.complete(MEMBER, flowId, `code=grant&state=${STATE}`));
    return {
      name,
      loginPaths: [...login.paths],
      loginExited: login.exited(),
      otherPaths: [...other.paths],
      result: view.result,
    };
  } finally {
    await login.close();
    await other.close();
  }
}

const report: { passed: boolean; cases: CaseResult[] } = { passed: false, cases: [] };
try {
  const codex = await runCase(
    "codex login redirects to its own success page",
    (port) => `http://127.0.0.1:${port}/success?id_token=fake&needs_setup=false`,
  );
  report.cases.push(codex);
  assert.deepEqual(codex.loginPaths, ["/auth/callback", "/success"], "The replay loads the success page.");
  assert.equal(codex.loginExited, true, "The sign-in ends after the replay.");
  assert.deepEqual(codex.result, { toolCount: 0, error: null }, "The host's result arrives.");

  // A success page that fails does not make `complete` fail: `runCase` would throw.
  const missing = await runCase("success page that fails", (port) => `http://127.0.0.1:${port}/missing`);
  report.cases.push(missing);
  assert.deepEqual(missing.loginPaths, ["/auth/callback", "/missing"], "The replay loads the redirect once.");
  assert.equal(missing.result, null, "The sign-in has no result yet.");

  for (const [name, successAt] of [
    ["redirect to a hosted page", () => "https://chatgpt.example/codex/success"],
    [
      "redirect to another loopback port",
      (_port: number, otherPort: number) => `http://127.0.0.1:${otherPort}/success`,
    ],
  ] as const) {
    const result = await runCase(name, successAt);
    report.cases.push(result);
    assert.deepEqual(result.loginPaths, ["/auth/callback"], `${name}: only the callback goes to the sign-in.`);
    assert.deepEqual(result.otherPaths, [], `${name}: nothing goes to another address.`);
  }
  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
