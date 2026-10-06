import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CentralAuthState, HostStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import { ServerMode, takeServerModeEnvironment } from "./server-mode";

const SESSION_TOKEN = "session-token-that-must-stay-in-main";

let directory: string;
let server: ServerMode | null = null;

beforeEach(async () => {
  // Short: a Unix socket path holds at most 103 characters on macOS.
  directory = await mkdtemp(join(tmpdir(), "ob-"));
  await chmod(directory, 0o700);
});

afterEach(async () => {
  if (server) await Effect.runPromise(server.close());
  server = null;
  await rm(directory, { recursive: true, force: true });
});

function fixture() {
  let state: CentralAuthState = { status: "signed_out" };
  let hostStatus: HostStatus = {
    phase: "unconfigured",
    configured: false,
    enabledOnLaunch: false,
    serverId: null,
    serverName: null,
    apiUrl: null,
    logoUrl: null,
    apiOnline: false,
    remoteDesktopReady: false,
    remoteDesktopScreenRecordingDenied: false,
    remoteDesktopUnattended: false,
    remoteDesktopActiveSessions: 0,
    remoteDesktopMaxSessions: 0,
    message: null,
  };
  const centralAuth = {
    getState: () => state,
    requestEmailCode: vi.fn((email: string) =>
      Effect.sync(() => {
        state = { status: "code_sent", challengeId: "challenge-1", email, expiresAt: 1, resendAvailableAt: 1 };
        return state;
      }),
    ),
    verifyEmailCode: vi.fn(() =>
      Effect.sync(() => {
        state = { status: "signed_in", user: { id: "u1", email: "owner@example.com", name: null, avatarUrl: null } };
        // The real manager keeps the token to itself; a leak would come from echoing what it holds.
        const held = { ...state, sessionToken: SESSION_TOKEN };
        return held;
      }),
    ),
    logout: vi.fn(() =>
      Effect.sync(() => {
        state = { status: "signed_out" };
        return state;
      }),
    ),
  };
  const host = {
    getStatus: () => hostStatus,
    configure: vi.fn(({ serverName }: { serverName: string }) =>
      remoteCall(async () => {
        await Promise.resolve();
        hostStatus = { ...hostStatus, phase: "idle", configured: true, serverName };
        return hostStatus;
      }),
    ),
    start: vi.fn(() =>
      remoteCall(async () => {
        hostStatus = { ...hostStatus, phase: "online" };
        return hostStatus;
      }),
    ),
    updateIdentity: vi.fn(({ serverName }: { serverName?: string }) =>
      remoteCall(async () => {
        hostStatus = { ...hostStatus, serverName: serverName ?? null };
        return hostStatus;
      }),
    ),
  };
  const mode = new ServerMode({
    environment: { controlSocketPath: join(directory, "control.sock") },
    version: "9.9.9",
    centralAuth,
    host,
    onError: () => undefined,
  });
  return { mode, centralAuth, host };
}

function send(method: string, path: string, body = ""): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath: join(directory, "control.sock"),
        method,
        path,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

describe("takeServerModeEnvironment", () => {
  it("is off outside a packaged Linux server and on a hosted server", () => {
    const environment = { OPENBOT_SERVER: "1", XDG_RUNTIME_DIR: "/run/openbot" };
    expect(takeServerModeEnvironment(environment, true, "linux")).toEqual({
      controlSocketPath: "/run/openbot/control.sock",
    });
    expect(takeServerModeEnvironment(environment, false, "linux")).toBeNull();
    expect(takeServerModeEnvironment(environment, true, "darwin")).toBeNull();
    expect(takeServerModeEnvironment({ ...environment, OPENBOT_HOSTED_SERVER: "1" }, true, "linux")).toBeNull();
    expect(takeServerModeEnvironment({ ...environment, XDG_RUNTIME_DIR: "run" }, true, "linux")).toBeNull();
  });
});

describe("ServerMode control socket", () => {
  it("refuses a runtime directory that another user can enter", async () => {
    await chmod(directory, 0o750);
    server = fixture().mode;
    await expect(runCauseEffect(server.listen())).rejects.toThrow("private directory");
  });

  it("keeps a file at the socket path that is not a socket", async () => {
    await writeFile(join(directory, "control.sock"), "not ours");
    server = fixture().mode;
    await expect(runCauseEffect(server.listen())).rejects.toThrow("another file");
    expect((await stat(join(directory, "control.sock"))).isFile()).toBe(true);
  });

  it("makes a socket that only its owner can open", async () => {
    server = fixture().mode;
    await runCauseEffect(server.listen());
    expect((await stat(join(directory, "control.sock"))).mode & 0o777).toBe(0o600);
  });

  it("signs in with an email code, never sends the session back, and publishes once", async () => {
    const { mode, host, centralAuth } = fixture();
    server = mode;
    await runCauseEffect(server.listen());

    const started = await send("POST", "/v1/login/start", "email=owner%40example.com");
    expect(started).toEqual({ status: 200, text: "challenge=challenge-1\nexpires_at=1\n" });

    // The host refuses this name only when it publishes, after the sign-in. Nothing then says why.
    const short = await send("POST", "/v1/login/verify", "challenge=challenge-1&code=123456&name=Lab");
    expect(short).toEqual({
      status: 400,
      text: "error=invalid_name\nmessage=Server name must contain 6 to 32 characters.\n",
    });
    expect(centralAuth.verifyEmailCode).not.toHaveBeenCalled();

    const verified = await send("POST", "/v1/login/verify", "challenge=challenge-1&code=123456&name=Lab%20Server");
    expect(verified.status).toBe(200);
    expect(verified.text).not.toContain(SESSION_TOKEN);
    expect(verified.text).not.toContain("123456");
    expect(verified.text).toContain("account=signed_in\n");

    // The entry point and the start retry can both call this at the same time.
    await Promise.all([runCauseEffect(mode.publish()), runCauseEffect(mode.publish())]);
    expect(host.configure).toHaveBeenCalledOnce();
    const status = await send("GET", "/v1/status");
    expect(status.text).toContain("server=online\nserver_name=Lab Server\n");
  });

  it("shows why publishing failed, on one line", async () => {
    const { mode, host } = fixture();
    server = mode;
    await runCauseEffect(server.listen());
    await send("POST", "/v1/login/verify", "challenge=challenge-1&code=123456");
    host.configure.mockReturnValueOnce(
      Effect.fail(new RemoteWorkflowError({ cause: new Error("Refused.\naccount=x") })),
    );
    await expect(runCauseEffect(mode.publish())).rejects.toThrow("Refused.");

    // A message with a line break stays one line, so it cannot add a key.
    const status = await send("GET", "/v1/status");
    expect(status.text).toContain("server=unconfigured\nserver_message=Refused. account=x\n");
    expect(status.text.match(/^account=/gmu)).toHaveLength(1);
  });

  it("refuses a body that is too large and an unknown request", async () => {
    const { mode, centralAuth } = fixture();
    server = mode;
    await runCauseEffect(server.listen());
    const large = await send("POST", "/v1/login/start", `email=${"a".repeat(5000)}%40example.com`);
    expect(large).toEqual({ status: 413, text: "error=too_large\n" });
    expect(centralAuth.requestEmailCode).not.toHaveBeenCalled();
    expect((await send("DELETE", "/v1/status")).status).toBe(404);
  });
});
