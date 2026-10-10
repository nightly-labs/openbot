import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAcpAuthentication } from "./acp-sign-in";
import { CliLoginFlow } from "./agent/cli-login-flow";
import { runCauseEffect } from "./effect-boundary";

let root: string;
let scope: Scope.Closeable;
const link = "https://accounts.google.com/o/oauth2/v2/auth?state=private-state&code_challenge=private-challenge";
const browserError =
  "Gemini could not open the sign-in page. Install a browser and xdg-utils, then connect from a desktop session on this host. A server with no desktop cannot complete this sign-in.";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-acp-sign-in-"));
  scope = Scope.makeUnsafe();
});
afterEach(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  await rm(root, { recursive: true, force: true });
});

// Failure modes are recorded in TASKS.md and the PR: lost links, unsafe links, opener failures,
// and a login process that survives cancellation. The child speaks the real ACP sign-in flow.
async function authentication(url: string, openGoogleSignIn: (url: string) => Promise<void>) {
  const script = join(root, "server.cjs");
  await writeFile(
    script,
    `
    const readline = require("node:readline");
    const send = (value) => console.log(JSON.stringify({ jsonrpc: "2.0", ...value }));
    readline.createInterface({ input: process.stdin }).on("line", (line) => {
      const request = JSON.parse(line);
      if (request.method === "initialize") send({ id: request.id, result: { protocolVersion: 1 } });
      if (request.method === "authenticate") {
        if (process.env.BROWSER !== "true") process.exit(5);
        process.stderr.write("Open the following link to authenticate the ACP server: " + ${JSON.stringify(url)} + "\\n");
      }
      if (request.method === "finish") send({ id: 2, result: {} });
    });
  `,
  );
  return startAcpAuthentication({
    executable: process.execPath,
    argv: [script],
    env: {},
    methodId: "oauth-personal",
    timeoutMs: 5_000,
    openGoogleSignIn,
  });
}

async function start(url: string, openGoogleSignIn: (url: string) => Promise<void>) {
  return runCauseEffect((await authentication(url, openGoogleSignIn)).pipe(Effect.provideService(Scope.Scope, scope)));
}

describe("Gemini browser sign-in", () => {
  it("clears a cancelled ACP login and permits the next connection command", async () => {
    const open = vi.fn(async () => undefined);
    const clear = vi.fn();
    const failure = vi.fn();
    const attempt = await authentication(link, open);
    const flow = new CliLoginFlow({
      scope: () => scope,
      resolveCli: () => Effect.succeed({ executable: process.execPath, version: "1.3.0", source: "system" }),
      authenticate: () => Effect.die("A cancelled login must not authenticate a client."),
      activate: () => Effect.void,
      setConnecting: vi.fn(),
      clearConnectionState: clear,
      setFailure: failure,
    });
    try {
      await runCauseEffect(flow.start("antigravity", () => attempt));
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
      await runCauseEffect(flow.cancel("antigravity", null));
      expect(clear).toHaveBeenCalledWith("antigravity");
      expect(flow.has("antigravity")).toBe(false);
      await runCauseEffect(flow.start("antigravity", () => attempt));
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
      expect(failure).not.toHaveBeenCalled();
    } finally {
      await runCauseEffect(flow.dispose());
    }
  });

  it("opens the Google link and completes authentication", async () => {
    const open = vi.fn(async () => undefined);
    const login = await start(link, open);
    await vi.waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(link));
    login.child.stdin?.write(`${JSON.stringify({ method: "finish" })}\n`);
    await expect(runCauseEffect(login.done)).resolves.toBeUndefined();
  });

  it("reports a missing browser without leaking the link or the opener error", async () => {
    const login = await start(link, async () => {
      throw new Error(`Cannot open ${link}`);
    });
    await expect(runCauseEffect(login.done)).rejects.toMatchObject({ message: browserError });
    await vi.waitFor(() => expect(login.child.exitCode !== null || login.child.signalCode !== null).toBe(true));
  });

  it.each([
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com.attacker.test/o/oauth2/v2/auth",
    "https://accounts.google.com/other",
    "https://secret@accounts.google.com/o/oauth2/v2/auth",
    "file:///tmp/sign-in",
  ])("refuses an unexpected sign-in URL: %s", async (url) => {
    const open = vi.fn(async () => undefined);
    const login = await start(url, open);
    await expect(runCauseEffect(login.done)).rejects.toMatchObject({ message: browserError });
    expect(open).not.toHaveBeenCalled();
  });

  it("stops a pending sign-in on cancellation and permits a fresh attempt", async () => {
    const open = vi.fn(async () => undefined);
    const login = await start(link, open);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await vi.waitFor(() => expect(login.child.exitCode !== null || login.child.signalCode !== null).toBe(true));
    scope = Scope.makeUnsafe();
    const retry = await start(link, open);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    retry.child.stdin?.write(`${JSON.stringify({ method: "finish" })}\n`);
    await expect(runCauseEffect(retry.done)).resolves.toBeUndefined();
  });
});
