import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  execTailscale,
  parseServePort,
  parseTailscaleStatus,
  TAILSCALE_COMMANDS,
  TailscaleCli,
  TailscaleCommandError,
  tailscaleCandidates,
} from "./tailscale-cli";

const running = {
  BackendState: "Running",
  CurrentTailnet: { Name: "owner@example.com", MagicDNSSuffix: "tail4b2c1.ts.net", MagicDNSEnabled: true },
  CertDomains: ["studio-mac.tail4b2c1.ts.net"],
  Self: { HostName: "Studio Mac", DNSName: "studio-mac.tail4b2c1.ts.net.", OS: "macOS" },
  Peer: {
    a: { HostName: "pc", DNSName: "pc.tail4b2c1.ts.net." },
    b: { HostName: "shared", DNSName: "laptop.other-tailnet.ts.net." },
    c: { HostName: "odd", DNSName: 7 },
  },
};

describe("tailscale status", () => {
  it("reads a connected device, its tailnet and the devices it can reach", () => {
    expect(parseTailscaleStatus(JSON.stringify(running))).toEqual({
      kind: "connected",
      tailnet: "owner@example.com",
      deviceName: "Studio Mac",
      dnsName: "studio-mac.tail4b2c1.ts.net",
      httpsCertificates: true,
      peerDnsNames: ["pc.tail4b2c1.ts.net", "laptop.other-tailnet.ts.net"],
    });
  });

  it("reads the other backend states and fails closed on bad output", () => {
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "NeedsLogin" }))).toEqual({ kind: "signed-out" });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "NeedsMachineAuth" }))).toEqual({
      kind: "signed-out",
    });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped" }))).toEqual({ kind: "stopped" });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Starting" }))).toEqual({ kind: "not-running" });
    expect(parseTailscaleStatus("failed to connect to local tailscaled")).toEqual({ kind: "not-running" });
    expect(parseTailscaleStatus("[]")).toEqual({ kind: "not-running" });
  });

  it("does not offer HTTPS without certificate domains, and drops a name outside ts.net", () => {
    const state = parseTailscaleStatus(
      JSON.stringify({ ...running, CertDomains: null, Self: { HostName: "x", DNSName: "x.example.com." } }),
    );
    expect(state).toMatchObject({ kind: "connected", httpsCertificates: false, dnsName: null });
  });
});

describe("tailscale serve status", () => {
  const dns = "studio-mac.tail4b2c1.ts.net";
  it("finds what one port serves", () => {
    const status = {
      TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
      Web: {
        [`${dns}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:4100" } } },
        [`${dns}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" }, "/api": { Proxy: "x" } } },
      },
      AllowFunnel: { [`${dns}:8443`]: true },
    };
    const text = JSON.stringify(status);
    expect(parseServePort(text, dns, 443)).toEqual({
      rootProxy: "http://127.0.0.1:4100",
      otherHandlers: false,
      funnel: false,
    });
    expect(parseServePort(text, dns, 8443)).toEqual({
      rootProxy: "http://127.0.0.1:3000",
      otherHandlers: true,
      funnel: true,
    });
    expect(parseServePort(text, dns, 10000)).toBeNull();
    expect(parseServePort("{}", dns, 443)).toBeNull();
  });

  it("counts a TCP forward and unreadable output as a port in use", () => {
    expect(parseServePort(JSON.stringify({ TCP: { "443": { TCPForward: "127.0.0.1:22" } } }), dns, 443)).toEqual({
      rootProxy: null,
      otherHandlers: true,
      funnel: false,
    });
    expect(parseServePort("not json", dns, 443)?.otherHandlers).toBe(true);
  });
});

describe("tailscale commands", () => {
  it("are fixed lists with only numeric ports, and never Funnel", () => {
    expect(TAILSCALE_COMMANDS.serveOn(443, 51234)).toEqual(["serve", "--bg", "--https=443", "http://127.0.0.1:51234"]);
    expect(TAILSCALE_COMMANDS.serveOff(8443)).toEqual(["serve", "--https=8443", "off"]);
    expect(TAILSCALE_COMMANDS.serveRootOff(8443)).toEqual(["serve", "--https=8443", "--set-path=/", "off"]);
    for (const args of [
      TAILSCALE_COMMANDS.status(),
      TAILSCALE_COMMANDS.serveStatus(),
      TAILSCALE_COMMANDS.serveOn(443, 1),
      TAILSCALE_COMMANDS.serveOff(443),
      TAILSCALE_COMMANDS.serveRootOff(443),
    ]) {
      expect(args.join(" ")).not.toMatch(/funnel/iu);
    }
    expect(() => TAILSCALE_COMMANDS.serveOn(443, Number.NaN)).toThrow();
    expect(() => TAILSCALE_COMMANDS.serveOn(443, 70_000)).toThrow();
    expect(() => TAILSCALE_COMMANDS.serveOff(1.5)).toThrow();
  });

  it("looks in each platform's install places and on the search path", () => {
    expect(tailscaleCandidates("darwin", { PATH: "/usr/bin:relative" })).toEqual([
      "/Applications/Tailscale.app/Contents/MacOS/tailscale",
      "/opt/homebrew/bin/tailscale",
      "/usr/local/bin/tailscale",
      "/usr/bin/tailscale",
    ]);
    expect(tailscaleCandidates("linux", { PATH: "" })).toContain("/usr/bin/tailscale");
    // A host in WSL uses the Windows installation, after any Linux one.
    expect(tailscaleCandidates("linux", { PATH: "/opt/bin" }).at(-1)).toBe(
      "/mnt/c/Program Files/Tailscale/tailscale.exe",
    );
    expect(tailscaleCandidates("win32", { PATH: "", ProgramFiles: "C:\\Program Files" })[0]).toMatch(
      /Tailscale\\tailscale\.exe$/u,
    );
  });

  it("reports a missing command as not installed", async () => {
    const cli = new TailscaleCli({ locate: () => Effect.succeed(null) });
    await expect(Effect.runPromise(cli.status())).resolves.toEqual({ kind: "not-installed" });
    await expect(Effect.runPromise(cli.run(["status"]))).rejects.toMatchObject({ reason: "not-installed" });
  });

  it("reads a command that fails as not running", async () => {
    const cli = new TailscaleCli({
      locate: () => Effect.succeed("/usr/bin/tailscale"),
      exec: () => Effect.fail(new TailscaleCommandError({ reason: "failed", detail: "tailscaled is not running" })),
    });
    await expect(Effect.runPromise(cli.status())).resolves.toEqual({ kind: "not-running" });
  });
});

// A real child process, so these show what the operating system receives.
describe("execTailscale", () => {
  it("passes each argument as it is, with no shell", async () => {
    const text = "$(touch /tmp/openbot-never); `id` && echo x | cat";
    const output = await Effect.runPromise(
      execTailscale(process.execPath, ["-e", "process.stdout.write(process.argv[1])", text], 10_000),
    );
    expect(output).toBe(text);
  });

  it("stops a command at its deadline", async () => {
    await expect(
      Effect.runPromise(execTailscale(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 200)),
    ).rejects.toMatchObject({ reason: "failed" });
  });

  it("does not wait on standard input", async () => {
    const output = await Effect.runPromise(
      execTailscale(
        process.execPath,
        ["-e", "process.stdin.on('end', () => process.stdout.write('eof')).resume()"],
        10_000,
      ),
    );
    expect(output).toBe("eof");
  });
});
