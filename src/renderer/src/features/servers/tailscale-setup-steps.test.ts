import type { HostTailscaleSetup, TailscaleSetupStatus } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  tailscaleServerActions,
  tailscaleSetupComplete,
  tailscaleSetupSteps,
  tailscaleWslHint,
} from "./tailscale-setup-steps";

const connectedHost: HostTailscaleSetup = {
  state: "connected",
  tailnet: "owner@example.com",
  deviceName: "home-server",
  dnsName: "home-server.tail4b2c1.ts.net",
  httpsCertificates: true,
  enabled: true,
  url: "https://home-server.tail4b2c1.ts.net",
  issue: null,
  issueDetail: null,
  loginUrl: null,
  environment: "linux",
  wslNetworking: null,
  setupCommand: true,
  signInIssue: null,
};

function status(
  host: Partial<HostTailscaleSetup> = {},
  rest: Partial<TailscaleSetupStatus> = {},
): TailscaleSetupStatus {
  return {
    client: { state: "connected", tailnet: "owner@example.com", deviceName: "Studio Mac" },
    host: { ...connectedHost, ...host },
    network: "same",
    ...rest,
  };
}

const states = (value: TailscaleSetupStatus) => tailscaleSetupSteps(value).map((step) => `${step.id}:${step.state}`);

describe("tailscaleSetupSteps", () => {
  it("is complete when both are in one tailnet, certificates are on and the path serves", () => {
    expect(states(status())).toEqual(["client:done", "server:done", "network:done", "https:done", "direct:done"]);
    expect(tailscaleSetupComplete(status())).toBe(true);
    expect(tailscaleSetupComplete(status({}, { network: "shared" }))).toBe(true);
  });

  it("waits with the later steps until the server runs Tailscale", () => {
    const fresh = status(
      { state: "not-installed", tailnet: null, dnsName: null, httpsCertificates: false, enabled: false, url: null },
      { client: { state: "signed-out", tailnet: null, deviceName: null }, network: null },
    );
    expect(states(fresh)).toEqual([
      "client:action",
      "server:action",
      "network:waiting",
      "https:waiting",
      "direct:waiting",
    ]);
    expect(tailscaleSetupComplete(fresh)).toBe(false);
  });

  it("asks for each missing step on its own", () => {
    expect(states(status({}, { network: "other" }))[2]).toBe("network:action");
    expect(states(status({ httpsCertificates: false, enabled: false, url: null })).slice(3)).toEqual([
      "https:action",
      "direct:waiting",
    ]);
    // The switch is on but Tailscale does not serve yet: the step is not done.
    expect(states(status({ enabled: true, url: null, issue: "port-in-use" }))[4]).toBe("direct:action");
  });
});

describe("tailscaleServerActions", () => {
  it("offers the setup command on a self-hosted server until OpenBot may start Tailscale", () => {
    expect(tailscaleServerActions(status({ state: "not-installed" }))).toEqual(["setup-command"]);
    expect(tailscaleServerActions(status({ state: "signed-out" }))).toEqual(["sign-in", "setup-command"]);
    expect(tailscaleServerActions(status({ state: "stopped", signInIssue: "needs-setup" }))).toEqual(["setup-command"]);
    expect(tailscaleServerActions(status())).toEqual([]);
  });

  it("sends a server in WSL to the Windows app, and another server to the download page", () => {
    const wsl = { environment: "wsl" as const, setupCommand: false };
    expect(tailscaleServerActions(status({ ...wsl, state: "not-installed" }))).toEqual(["windows-app"]);
    expect(tailscaleServerActions(status({ ...wsl, state: "signed-out" }))).toEqual(["windows-app", "sign-in"]);
    expect(
      tailscaleServerActions(status({ environment: "other", setupCommand: false, state: "not-installed" })),
    ).toEqual(["download"]);
  });

  it("asks for mirrored networking only while WSL does not report it", () => {
    expect(tailscaleWslHint(status({ environment: "wsl", wslNetworking: "nat" }))).toBe("mirrored-required");
    expect(tailscaleWslHint(status({ environment: "wsl", wslNetworking: "unknown" }))).toBe("mirrored-check");
    expect(tailscaleWslHint(status({ environment: "wsl", wslNetworking: "mirrored" }))).toBeNull();
    expect(tailscaleWslHint(status({ environment: "wsl", wslNetworking: null }))).toBeNull();
  });
});
