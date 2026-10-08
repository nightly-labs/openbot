import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeHostTailscaleSetup } from "@openbot/contracts/ipc";
import { HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { optionalRouteCodec } from "@openbot/contracts/team-protocol/optional-routes";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TailscaleCli, TailscaleCommandError, type TailscaleExec, WSL_WINDOWS_TAILSCALE } from "./tailscale-cli";
import { TailscaleDirectService } from "./tailscale-direct-service";
import {
  HOSTED_MODE_PATH,
  OS_RELEASE_PATH,
  parseWslNetworking,
  signInIssueFor,
  TailscaleHostSetup,
  type TailscaleHostSetupOptions,
} from "./tailscale-host-setup";

const DNS = "home-server.tail4b2c1.ts.net";
const LOGIN = "https://login.tailscale.com/a/1a2b3c4d5e6f";
const running = {
  BackendState: "Running",
  CurrentTailnet: { Name: "owner@example.com" },
  CertDomains: [DNS],
  Self: { HostName: "home-server", DNSName: `${DNS}.` },
  Peer: {},
};

interface Fake {
  /** Every program run, with its argument list. */
  runs: { file: string; args: string[] }[];
  status: object;
  /** What `tailscale up` does: start a sign-in, connect, or fail with this detail. */
  up: "sign-in" | "connect" | { fail: string };
  wslinfo: string | null;
}

function fake(overrides: Partial<Fake> = {}): Fake {
  return { runs: [], status: running, up: "sign-in", wslinfo: null, ...overrides };
}

function exec(state: Fake): TailscaleExec {
  return (file, args) =>
    Effect.suspend(() => {
      state.runs.push({ file, args: [...args] });
      if (file.endsWith("wslinfo")) {
        return state.wslinfo === null
          ? Effect.fail(new TailscaleCommandError({ reason: "not-installed", detail: "" }))
          : Effect.succeed(state.wslinfo);
      }
      const line = args.join(" ");
      if (line === "status --json") return Effect.succeed(JSON.stringify(state.status));
      if (line === "serve status --json") return Effect.succeed("{}");
      if (args[0] === "up") {
        if (typeof state.up === "object")
          return Effect.fail(new TailscaleCommandError({ reason: "failed", detail: state.up.fail }));
        state.status = state.up === "connect" ? running : { BackendState: "NeedsLogin", AuthURL: LOGIN };
        // Tailscale stops `up` at its timeout while it waits for the sign-in.
        return state.up === "connect"
          ? Effect.succeed("")
          : Effect.fail(new TailscaleCommandError({ reason: "failed", detail: "timeout waiting for Tailscale" }));
      }
      return Effect.fail(new TailscaleCommandError({ reason: "failed", detail: `unexpected: ${line}` }));
    });
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-tailscale-setup-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup(
  state: Fake,
  options: Partial<TailscaleHostSetupOptions> & { files?: Record<string, string>; command?: string | null } = {},
) {
  const run = exec(state);
  const command = options.command === undefined ? "/usr/bin/tailscale" : options.command;
  const cli = new TailscaleCli({ locate: () => Effect.succeed(command), exec: run });
  const files = options.files ?? { [OS_RELEASE_PATH]: "6.8.0-45-generic\n", [HOSTED_MODE_PATH]: "self\n" };
  return new TailscaleHostSetup({
    direct: new TailscaleDirectService({ settingsPath: join(directory, "tailscale-direct.json"), cli }),
    cli,
    platform: "linux",
    serverMode: true,
    readText: async (path) => files[path] ?? null,
    exec: run,
    ...options,
  });
}

/** The host sends exactly what the frozen codec accepts, so the owner's client never fails closed. */
function wire(value: unknown) {
  const codec = optionalRouteCodec(HOST_TAILSCALE_ROUTES.status);
  if (!codec) throw new Error("No codec.");
  return codec.response(200, value);
}

describe("TailscaleHostSetup", () => {
  it("reports a connected self-hosted Linux server with its tailnet and certificates", async () => {
    const status = await Effect.runPromise(setup(fake()).status());
    expect(status).toEqual({
      state: "connected",
      tailnet: "owner@example.com",
      deviceName: "home-server",
      dnsName: DNS,
      httpsCertificates: true,
      enabled: false,
      url: null,
      issue: null,
      issueDetail: null,
      loginUrl: null,
      environment: "linux",
      wslNetworking: null,
      setupCommand: true,
      signInIssue: null,
    });
    expect(wire(status)).toEqual(status);
    expect(decodeHostTailscaleSetup(wire(status))).toEqual(status);
  });

  it("offers the setup command only on a self-hosted server", async () => {
    const desktop = await Effect.runPromise(setup(fake(), { serverMode: false }).status());
    expect(desktop.setupCommand).toBe(false);
    const container = await Effect.runPromise(
      setup(fake(), { files: { [OS_RELEASE_PATH]: "6.8.0\n", [HOSTED_MODE_PATH]: "container\n" } }).status(),
    );
    expect(container.setupCommand).toBe(false);
    const mac = await Effect.runPromise(setup(fake(), { platform: "darwin" }).status());
    expect(mac).toMatchObject({ environment: "other", setupCommand: false, wslNetworking: null });
  });

  it("reads WSL and its networking mode with a fixed command, for the Windows app only", async () => {
    const files = { [OS_RELEASE_PATH]: "5.15.153.1-microsoft-standard-WSL2\n", [HOSTED_MODE_PATH]: "self\n" };
    const state = fake({ wslinfo: "nat\n" });
    const windows = await Effect.runPromise(setup(state, { files, command: WSL_WINDOWS_TAILSCALE }).status());
    expect(windows).toMatchObject({ environment: "wsl", wslNetworking: "nat", setupCommand: false });
    expect(state.runs.filter((run) => run.file.endsWith("wslinfo"))).toEqual([
      { file: "/usr/bin/wslinfo", args: ["--networking-mode"] },
    ]);
    // A Tailscale installed inside WSL serves the loopback listener without mirrored networking.
    const inside = await Effect.runPromise(setup(fake({ wslinfo: "nat" }), { files }).status());
    expect(inside.wslNetworking).toBeNull();
    // No `wslinfo` (an older WSL): the owner is asked to check.
    const old = await Effect.runPromise(setup(fake(), { files, command: null }).status());
    expect(old).toMatchObject({ state: "not-installed", wslNetworking: "unknown" });
  });

  it("starts a sign-in with `tailscale up` only, and reports the sign-in page", async () => {
    const state = fake({ status: { BackendState: "NeedsLogin" } });
    const status = await Effect.runPromise(setup(state).signIn());
    expect(status).toMatchObject({ state: "signed-out", loginUrl: LOGIN, signInIssue: null });
    const tailscaleRuns = state.runs.filter((run) => run.file === "/usr/bin/tailscale").map((run) => run.args);
    expect(tailscaleRuns.filter((args) => args[0] === "up")).toEqual([["up", "--timeout=6s"]]);
    expect(tailscaleRuns.flat().join(" ")).not.toMatch(/auth-?key|funnel|operator/iu);
    expect(wire(status)).toEqual(status);
  });

  it("runs nothing when Tailscale is connected or already waits for a sign-in", async () => {
    const connected = fake();
    await Effect.runPromise(setup(connected).signIn());
    const waiting = fake({ status: { BackendState: "NeedsLogin", AuthURL: LOGIN } });
    const status = await Effect.runPromise(setup(waiting).signIn());
    expect(status.loginUrl).toBe(LOGIN);
    for (const state of [connected, waiting]) expect(state.runs.some((run) => run.args[0] === "up")).toBe(false);
  });

  it("asks for the setup command when Tailscale is missing or refuses the OpenBot user", async () => {
    const missing = fake();
    const notInstalled = await Effect.runPromise(setup(missing, { command: null }).signIn());
    expect(notInstalled).toMatchObject({ state: "not-installed", signInIssue: "needs-setup" });
    expect(missing.runs.some((run) => run.args[0] === "up")).toBe(false);

    const denied = fake({
      status: { BackendState: "Stopped" },
      up: { fail: "Access denied: prefs write access denied" },
    });
    expect(await Effect.runPromise(setup(denied).signIn())).toMatchObject({
      state: "stopped",
      signInIssue: "needs-setup",
    });

    const broken = fake({ status: { BackendState: "Stopped" }, up: { fail: "backend error: no route" } });
    expect((await Effect.runPromise(setup(broken).signIn())).signInIssue).toBe("failed");
  });

  it("sends a sign-in page of another control server as null, so the client opens nothing", async () => {
    const state = fake({ status: { BackendState: "NeedsLogin", AuthURL: "https://headscale.example.com/register/x" } });
    expect((await Effect.runPromise(setup(state).status())).loginUrl).toBeNull();
  });

  it("drops a MagicDNS name the contract does not accept", async () => {
    const state = fake({ status: { ...running, Self: { HostName: "x", DNSName: "a.b.tail4b2c1.ts.net." } } });
    const status = await Effect.runPromise(setup(state).status());
    expect(status.dnsName).toBeNull();
    expect(wire(status)).toEqual(status);
  });

  it("turns the direct path on through the owner's switch", async () => {
    const state = fake();
    const host = setup(state);
    const status = await Effect.runPromise(host.setEnabled(true));
    // The host is not online in this test, so the switch is kept and the path waits for it.
    expect(status).toMatchObject({ enabled: true, url: null, issue: "host-offline" });
  });
});

describe("Tailscale host setup parsers", () => {
  it("reads the WSL networking mode and the reason of a refused sign-in", () => {
    expect(parseWslNetworking("mirrored\n")).toBe("mirrored");
    expect(parseWslNetworking("NAT")).toBe("nat");
    expect(parseWslNetworking("virtioproxy")).toBe("unknown");
    expect(signInIssueFor("Access denied: watch IPN bus access denied")).toBe("needs-setup");
    expect(signInIssueFor("timeout waiting for Tailscale service to enter a Running state")).toBe("failed");
  });
});
