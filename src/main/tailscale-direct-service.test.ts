import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TailscaleCli, TailscaleCommandError, type TailscaleExec } from "./tailscale-cli";
import { TailscaleDirectService } from "./tailscale-direct-service";

const DNS = "studio-mac.tail4b2c1.ts.net";
const running = {
  BackendState: "Running",
  CurrentTailnet: { Name: "owner@example.com" },
  CertDomains: [DNS],
  Self: { HostName: "Studio Mac", DNSName: `${DNS}.` },
  Peer: {},
};

interface ServeState {
  TCP: Record<string, { HTTPS: boolean }>;
  Web: Record<string, { Handlers: Record<string, { Proxy: string }> }>;
  AllowFunnel: Record<string, boolean>;
}

/** A local Tailscale client that keeps a serve configuration, as the real one does. */
function fakeTailscale(options: { status?: object; serve?: ServeState; failServe?: string; funnelOnServe?: boolean }) {
  const calls: string[][] = [];
  const serve: ServeState = options.serve ?? { TCP: {}, Web: {}, AllowFunnel: {} };
  const exec: TailscaleExec = (_file, args) =>
    Effect.suspend(() => {
      calls.push([...args]);
      const line = args.join(" ");
      if (line === "status --json") return Effect.succeed(JSON.stringify(options.status ?? running));
      if (line === "serve status --json") return Effect.succeed(JSON.stringify(serve));
      const on = /^serve --bg --https=(\d+) (http:\/\/127\.0\.0\.1:\d+)$/u.exec(line);
      if (on?.[1] && on[2]) {
        if (options.failServe)
          return Effect.fail(new TailscaleCommandError({ reason: "failed", detail: options.failServe }));
        serve.TCP[on[1]] = { HTTPS: true };
        serve.Web[`${DNS}:${on[1]}`] = { Handlers: { "/": { Proxy: on[2] } } };
        if (options.funnelOnServe) serve.AllowFunnel[`${DNS}:${on[1]}`] = true;
        return Effect.succeed("");
      }
      const off = /^serve --https=(\d+) off$/u.exec(line);
      if (off?.[1]) {
        delete serve.TCP[off[1]];
        delete serve.Web[`${DNS}:${off[1]}`];
        delete serve.AllowFunnel[`${DNS}:${off[1]}`];
        return Effect.succeed("");
      }
      // As Tailscale does: one path goes, and the port goes with its last path.
      const pathOff = /^serve --https=(\d+) --set-path=\/ off$/u.exec(line);
      const web = pathOff?.[1] ? serve.Web[`${DNS}:${pathOff[1]}`] : undefined;
      if (pathOff?.[1] && web) {
        delete web.Handlers["/"];
        if (Object.keys(web.Handlers).length === 0) {
          delete serve.TCP[pathOff[1]];
          delete serve.Web[`${DNS}:${pathOff[1]}`];
          delete serve.AllowFunnel[`${DNS}:${pathOff[1]}`];
        }
        return Effect.succeed("");
      }
      return Effect.fail(new TailscaleCommandError({ reason: "failed", detail: `unexpected: ${line}` }));
    });
  return {
    calls,
    serve,
    cli: new TailscaleCli({ locate: () => Effect.succeed("/usr/bin/tailscale"), exec }),
  };
}

function listener(port = 51_234) {
  return { start: vi.fn(() => Effect.succeed(port)), stop: vi.fn(() => Effect.void) };
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-tailscale-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function service(fake: ReturnType<typeof fakeTailscale>) {
  return new TailscaleDirectService({ settingsPath: join(directory, "tailscale-direct.json"), cli: fake.cli });
}

describe("TailscaleDirectService", () => {
  it("serves the loopback listener on 443 inside the tailnet and takes it down again", async () => {
    const fake = fakeTailscale({});
    const direct = service(fake);
    const api = listener();
    direct.attach(api);
    await Effect.runPromise(direct.hostOnline());
    expect(direct.url()).toBeNull();
    expect(fake.calls.some((args) => args[1] === "--bg")).toBe(false);

    const on = await Effect.runPromise(direct.setEnabled(true));
    expect(on).toMatchObject({ state: "connected", enabled: true, url: `https://${DNS}`, issue: null });
    expect(fake.calls).toContainEqual(["serve", "--bg", "--https=443", "http://127.0.0.1:51234"]);
    expect(fake.calls.flat().join(" ")).not.toMatch(/funnel/iu);
    expect(api.start).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(directory, "tailscale-direct.json"), "utf8"))).toEqual({
      version: 1,
      enabled: true,
      httpsPort: 443,
      loopbackPort: 51_234,
    });

    const off = await Effect.runPromise(direct.setEnabled(false));
    expect(off).toMatchObject({ enabled: false, url: null });
    expect(fake.calls).toContainEqual(["serve", "--https=443", "off"]);
    expect(fake.serve.Web).toEqual({});
    expect(api.stop).toHaveBeenCalled();
  });

  it("keeps a path that the user adds on its port while it runs", async () => {
    const fake = fakeTailscale({});
    const direct = service(fake);
    direct.attach(listener());
    await Effect.runPromise(direct.hostOnline());
    await Effect.runPromise(direct.setEnabled(true));
    const own = fake.serve.Web[`${DNS}:443`];
    if (!own) throw new Error("Port 443 is not served.");
    own.Handlers["/grafana"] = { Proxy: "http://127.0.0.1:3000" };

    await Effect.runPromise(direct.setEnabled(false));
    expect(fake.calls).not.toContainEqual(["serve", "--https=443", "off"]);
    expect(fake.serve.Web[`${DNS}:443`]?.Handlers).toEqual({ "/grafana": { Proxy: "http://127.0.0.1:3000" } });
    expect(fake.serve.TCP["443"]).toEqual({ HTTPS: true });
  });

  it("keeps the user's own configuration on 443 and uses 8443", async () => {
    const fake = fakeTailscale({
      serve: {
        TCP: { "443": { HTTPS: true } },
        Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
        AllowFunnel: {},
      },
    });
    const direct = service(fake);
    direct.attach(listener());
    await Effect.runPromise(direct.hostOnline());
    const status = await Effect.runPromise(direct.setEnabled(true));
    expect(status.url).toBe(`https://${DNS}:8443`);
    await Effect.runPromise(direct.hostOffline());
    expect(fake.calls).not.toContainEqual(["serve", "--https=443", "off"]);
    expect(fake.serve.Web[`${DNS}:443`]).toBeDefined();
  });

  it("reports a port in use and starts nothing when both ports hold other configuration", async () => {
    const used = { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } };
    const fake = fakeTailscale({
      serve: {
        TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
        Web: { [`${DNS}:443`]: used, [`${DNS}:8443`]: used },
        AllowFunnel: {},
      },
    });
    const direct = service(fake);
    const api = listener();
    direct.attach(api);
    await Effect.runPromise(direct.hostOnline());
    const status = await Effect.runPromise(direct.setEnabled(true));
    expect(status).toMatchObject({ url: null, issue: "port-in-use" });
    expect(api.start).not.toHaveBeenCalled();
    expect(fake.calls.some((args) => args[1] === "--bg")).toBe(false);
  });

  it("requires HTTPS certificates in the tailnet", async () => {
    const fake = fakeTailscale({ status: { ...running, CertDomains: [] } });
    const direct = service(fake);
    direct.attach(listener());
    await Effect.runPromise(direct.hostOnline());
    expect(await Effect.runPromise(direct.setEnabled(true))).toMatchObject({
      issue: "https-certificates-off",
      url: null,
    });
    expect(fake.calls.some((args) => args[0] === "serve")).toBe(false);
  });

  it("takes the port down again when Funnel publishes it", async () => {
    const fake = fakeTailscale({ funnelOnServe: true });
    const direct = service(fake);
    const api = listener();
    direct.attach(api);
    await Effect.runPromise(direct.hostOnline());
    expect(await Effect.runPromise(direct.setEnabled(true))).toMatchObject({ issue: "funnel-on", url: null });
    expect(fake.calls).toContainEqual(["serve", "--https=443", "off"]);
    expect(api.stop).toHaveBeenCalled();
  });

  it("reports a failed serve command with its first line and closes the listener", async () => {
    const fake = fakeTailscale({ failServe: "Access denied: serve config denied" });
    const direct = service(fake);
    const api = listener();
    direct.attach(api);
    await Effect.runPromise(direct.hostOnline());
    expect(await Effect.runPromise(direct.setEnabled(true))).toMatchObject({
      issue: "serve-failed",
      issueDetail: "Access denied: serve config denied",
      url: null,
    });
    expect(api.stop).toHaveBeenCalled();
  });

  it("only remembers the switch while the host is offline, and starts with the host", async () => {
    const fake = fakeTailscale({});
    const direct = service(fake);
    direct.attach(listener());
    expect(await Effect.runPromise(direct.setEnabled(true))).toMatchObject({
      enabled: true,
      url: null,
      issue: "host-offline",
    });
    expect(fake.calls.some((args) => args[1] === "--bg")).toBe(false);
    await Effect.runPromise(direct.hostOnline());
    expect(direct.url()).toBe(`https://${DNS}`);
  });

  it("recognises the configuration a crash left behind as its own", async () => {
    await writeFile(
      join(directory, "tailscale-direct.json"),
      JSON.stringify({ version: 1, enabled: true, httpsPort: 443, loopbackPort: 40_000 }),
    );
    const fake = fakeTailscale({
      serve: {
        TCP: { "443": { HTTPS: true } },
        Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:40000" } } } },
        AllowFunnel: {},
      },
    });
    const direct = service(fake);
    await Effect.runPromise(direct.load());
    direct.attach(listener(41_000));
    await Effect.runPromise(direct.hostOnline());
    expect(direct.url()).toBe(`https://${DNS}`);
    expect(fake.serve.Web[`${DNS}:443`]?.Handlers["/"]?.Proxy).toBe("http://127.0.0.1:41000");
  });

  it("shows each local state and does not serve without a signed-in Tailscale", async () => {
    for (const [status, state] of [
      [{ BackendState: "NeedsLogin" }, "signed-out"],
      [{ BackendState: "Stopped" }, "stopped"],
    ] as const) {
      const fake = fakeTailscale({ status });
      const direct = service(fake);
      direct.attach(listener());
      await Effect.runPromise(direct.hostOnline());
      expect(await Effect.runPromise(direct.setEnabled(true))).toMatchObject({
        state,
        issue: "tailscale-unavailable",
      });
      expect(fake.calls.some((args) => args[0] === "serve")).toBe(false);
    }
    const missing = new TailscaleDirectService({
      settingsPath: join(directory, "missing.json"),
      cli: new TailscaleCli({ locate: () => Effect.succeed(null) }),
    });
    expect(await Effect.runPromise(missing.status())).toMatchObject({ state: "not-installed", url: null });
  });
});
