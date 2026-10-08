import { Effect } from "effect";
// @vitest-environment node

import { type HostTailscaleSetup, IPC_ENDPOINTS, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { HOST_TAILSCALE_CAPABILITY, HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { describe, expect, it, vi } from "vitest";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { TailscaleLocalState } from "../tailscale-cli";
import { registerIpcGroup } from "./define-ipc-group";
import { hostAdminIpcHandlers } from "./host-admin-handlers";

type Invoke = (event: unknown, request: unknown) => unknown;

const { bound } = vi.hoisted(() => ({ bound: new Map<string, Invoke>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };
const LOGIN = "https://login.tailscale.com/a/1a2b3c4d";
const HOST_DNS = "home-server.tail4b2c1.ts.net";

function hostSetup(overrides: Partial<HostTailscaleSetup> = {}): HostTailscaleSetup {
  return {
    state: "connected",
    tailnet: "owner@example.com",
    deviceName: "home-server",
    dnsName: HOST_DNS,
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
    ...overrides,
  };
}

function connected(tailnet: string, peerDnsNames: string[] = []): TailscaleLocalState {
  return {
    kind: "connected",
    tailnet,
    deviceName: "Studio Mac",
    dnsName: "studio-mac.tail4b2c1.ts.net",
    httpsCertificates: true,
    peerDnsNames,
  };
}

function setup(options: { capable: boolean; host?: HostTailscaleSetup; local?: TailscaleLocalState }) {
  bound.clear();
  const requests: { serverId: string; path: string; init?: RemoteRequestInit | undefined }[] = [];
  const opened: string[] = [];
  const remoteServers = {
    list: () => [],
    refreshIdentity: () => Effect.die("unused"),
    supportsCapability: (_serverId: string, capability: string) =>
      options.capable && capability === HOST_TAILSCALE_CAPABILITY,
    request: <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit) =>
      Effect.sync(() => {
        requests.push({ serverId, path, init });
        return decoder(options.host ?? hostSetup());
      }),
  };
  registerIpcGroup(
    "hostAdmin",
    hostAdminIpcHandlers({
      host: { updateIdentity: () => Effect.die("unused") },
      remoteServers,
      localTailscale: () => Effect.succeed(options.local ?? connected("owner@example.com")),
      openTailscaleSignIn: async (url) => {
        opened.push(url);
      },
    }).hostAdmin,
  );
  const invoke = async (channel: string, serverId: string, payload: unknown = null) => {
    const handler = bound.get(channel);
    if (!handler) throw new Error(`${channel} was not registered.`);
    return handler(TRUSTED_EVENT, { serverId, payload });
  };
  return { requests, opened, invoke };
}

const { getTailscaleSetup, setTailscaleDirect, startTailscaleSignIn } = IPC_ENDPOINTS.hostAdmin;

describe("hostAdminIpcHandlers Tailscale setup", () => {
  it("asks the owner to update a host without host-tailscale-v1, and sends nothing", async () => {
    const old = setup({ capable: false });
    for (const channel of [getTailscaleSetup.channel, startTailscaleSignIn.channel]) {
      await expect(old.invoke(channel, "remote-1")).rejects.toThrow(
        "Update this server to set up Tailscale from here.",
      );
    }
    await expect(old.invoke(setTailscaleDirect.channel, "remote-1", true)).rejects.toThrow(
      "Update this server to set up Tailscale from here.",
    );
    await expect(old.invoke(getTailscaleSetup.channel, LOCAL_SERVER_ID)).rejects.toThrow();
    expect(old.requests).toEqual([]);
  });

  it("compares this computer's tailnet with the host's", async () => {
    const same = setup({ capable: true });
    await expect(same.invoke(getTailscaleSetup.channel, "remote-1")).resolves.toMatchObject({
      client: { state: "connected", tailnet: "owner@example.com", deviceName: "Studio Mac" },
      network: "same",
    });
    expect(same.requests).toEqual([
      { serverId: "remote-1", path: HOST_TAILSCALE_ROUTES.status, init: { method: "POST", body: {} } },
    ]);
    const shared = setup({ capable: true, local: connected("member@example.com", [HOST_DNS]) });
    await expect(shared.invoke(getTailscaleSetup.channel, "remote-1")).resolves.toMatchObject({ network: "shared" });
    const other = setup({ capable: true, local: connected("member@example.com") });
    await expect(other.invoke(getTailscaleSetup.channel, "remote-1")).resolves.toMatchObject({ network: "other" });
    const signedOut = setup({ capable: true, local: { kind: "signed-out", authUrl: null } });
    await expect(signedOut.invoke(getTailscaleSetup.channel, "remote-1")).resolves.toMatchObject({
      client: { state: "signed-out", tailnet: null },
      network: null,
    });
  });

  it("sends the switch as the frozen request body", async () => {
    const owner = setup({ capable: true });
    await owner.invoke(setTailscaleDirect.channel, "remote-1", true);
    expect(owner.requests).toEqual([
      { serverId: "remote-1", path: HOST_TAILSCALE_ROUTES.direct, init: { method: "POST", body: { enabled: true } } },
    ]);
    await expect(owner.invoke(setTailscaleDirect.channel, "remote-1", "on")).rejects.toThrow();
  });

  it("opens the sign-in page the host reports, and nothing when there is none", async () => {
    const waiting = setup({ capable: true, host: hostSetup({ state: "signed-out", loginUrl: LOGIN }) });
    await waiting.invoke(startTailscaleSignIn.channel, "remote-1");
    expect(waiting.requests.map((request) => request.path)).toEqual([HOST_TAILSCALE_ROUTES.signIn]);
    expect(waiting.opened).toEqual([LOGIN]);

    const none = setup({ capable: true, host: hostSetup({ state: "not-installed", signInIssue: "needs-setup" }) });
    await expect(none.invoke(startTailscaleSignIn.channel, "remote-1")).resolves.toMatchObject({
      host: { signInIssue: "needs-setup" },
    });
    expect(none.opened).toEqual([]);
  });

  // The codec checks the address on the wire; main checks it again before a browser opens it.
  it("never opens an address that is not the Tailscale sign-in page", async () => {
    const evil = setup({
      capable: true,
      host: hostSetup({ state: "signed-out", loginUrl: "https://evil.example/a/1a2b" }),
    });
    await evil.invoke(startTailscaleSignIn.channel, "remote-1");
    expect(evil.opened).toEqual([]);
  });
});
