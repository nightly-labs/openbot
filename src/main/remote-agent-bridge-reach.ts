import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  REMOTE_AGENT_BRIDGE_ROUTES,
  type RemoteAgentBridgeReachStatus,
} from "@openbot/contracts/team-protocol/remote-agent-bridge-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { RemoteAgentBridge } from "../backend/remote-agent-bridge";
import { isTailscaleConnected } from "./private-network-detection";

const execFileAsync = promisify(execFile);

const BRIDGE_SERVE_PATHS = [
  REMOTE_AGENT_BRIDGE_ROUTES.accept,
  REMOTE_AGENT_BRIDGE_ROUTES.agents,
  REMOTE_AGENT_BRIDGE_ROUTES.message,
  REMOTE_AGENT_BRIDGE_ROUTES.peerRevoke,
] as const;

export class RemoteAgentBridgeReachError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ServeHandler = { Proxy?: string };
type ServeWebEntry = { Handlers?: Record<string, ServeHandler> };
export type TailscaleServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, ServeWebEntry>;
};

function stripTrailingDot(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

export function tailscaleWebKey(dnsName: string): string {
  return `${stripTrailingDot(dnsName)}:443`;
}

export function mergeBridgeServeConfig(
  existing: TailscaleServeConfig | null,
  webKey: string,
  teamApiPort: number,
): TailscaleServeConfig {
  const proxy = `http://127.0.0.1:${teamApiPort}`;
  const base: TailscaleServeConfig = existing
    ? structuredClone(existing)
    : { TCP: { "443": { HTTPS: true } }, Web: {} };
  if (!base.TCP) base.TCP = { "443": { HTTPS: true } };
  if (!base.TCP["443"]) base.TCP["443"] = { HTTPS: true };
  if (!base.Web) base.Web = {};
  const entry = base.Web[webKey] ?? { Handlers: {} };
  if (!entry.Handlers) entry.Handlers = {};
  for (const path of BRIDGE_SERVE_PATHS) entry.Handlers[path] = { Proxy: proxy };
  base.Web[webKey] = entry;
  return base;
}

export function bridgeServeConfigured(
  config: TailscaleServeConfig | null,
  webKey: string,
  teamApiPort: number,
): boolean {
  const proxy = `http://127.0.0.1:${teamApiPort}`;
  const handlers = config?.Web?.[webKey]?.Handlers;
  if (!handlers) return false;
  return BRIDGE_SERVE_PATHS.every((path) => handlers[path]?.Proxy === proxy);
}

function isTailscaleStatusJson(value: unknown): value is { Self?: { DNSName?: string } } {
  return typeof value === "object" && value !== null;
}

function isServeConfig(value: unknown): value is TailscaleServeConfig {
  return typeof value === "object" && value !== null;
}

async function runTailscale(args: readonly string[]): Promise<string> {
  const command = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  try {
    const { stdout } = await execFileAsync(command, [...args], { windowsHide: true });
    return stdout;
  } catch {
    throw new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgeReachFailed"));
  }
}

async function readTailscaleDnsName(): Promise<string> {
  try {
    const stdout = await runTailscale(["status", "--json"]);
    const parsed = JSON.parse(stdout);
    if (!isTailscaleStatusJson(parsed)) {
      throw new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgeReachFailed"));
    }
    const dns = parsed.Self?.DNSName;
    if (typeof dns !== "string" || !dns.length) {
      throw new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgeTailscaleOffline"));
    }
    return dns;
  } catch (error) {
    if (error instanceof RemoteAgentBridgeReachError) throw error;
    throw new RemoteAgentBridgeReachError(
      503,
      sourceText(
        isTailscaleConnected()
          ? "error.backend.remoteAgentBridgeTailscaleOffline"
          : "error.backend.remoteAgentBridgeReachFailed",
      ),
    );
  }
}

async function readServeConfig(): Promise<TailscaleServeConfig | null> {
  try {
    const stdout = await runTailscale(["serve", "status", "--json"]);
    const value = JSON.parse(stdout);
    return isServeConfig(value) ? value : null;
  } catch {
    return null;
  }
}

export class RemoteAgentBridgeReach {
  readonly #bridge: RemoteAgentBridge;
  readonly #teamApiPort: () => number | null;

  constructor(options: { bridge: RemoteAgentBridge; teamApiPort: () => number | null }) {
    this.#bridge = options.bridge;
    this.#teamApiPort = options.teamApiPort;
  }

  buildStatus(input: {
    tailscaleConnected: boolean;
    dnsName: string;
    serveConfigured: boolean;
    reach: string;
  }): RemoteAgentBridgeReachStatus {
    const ready =
      input.tailscaleConnected &&
      input.serveConfigured &&
      input.reach.startsWith("https://") &&
      !input.reach.includes("127.0.0.1");
    return {
      ready,
      reach: input.reach,
      tailscaleConnected: input.tailscaleConnected,
      serveConfigured: input.serveConfigured,
      dnsName: input.dnsName,
    };
  }

  async status(): Promise<RemoteAgentBridgeReachStatus> {
    const tailscaleConnected = isTailscaleConnected();
    const reach = this.#bridge.reach();
    const port = this.#teamApiPort();
    if (!tailscaleConnected || port === null) {
      return this.buildStatus({ tailscaleConnected, dnsName: "", serveConfigured: false, reach });
    }
    try {
      const dnsName = await readTailscaleDnsName();
      const webKey = tailscaleWebKey(dnsName);
      const config = await readServeConfig();
      const serveConfigured = bridgeServeConfigured(config, webKey, port);
      return this.buildStatus({ tailscaleConnected, dnsName: stripTrailingDot(dnsName), serveConfigured, reach });
    } catch {
      return this.buildStatus({
        tailscaleConnected,
        dnsName: "",
        serveConfigured: false,
        reach: this.#bridge.reach(),
      });
    }
  }

  prepare = Effect.fn("RemoteAgentBridgeReach.prepare")(function* (this: RemoteAgentBridgeReach) {
    if (!isTailscaleConnected()) {
      return yield* Effect.fail({
        cause: new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgeTailscaleMissing")),
      });
    }
    const port = this.#teamApiPort();
    if (port === null) {
      return yield* Effect.fail({
        cause: new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgePeerDown")),
      });
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const dnsName = await readTailscaleDnsName();
        const proxy = `http://127.0.0.1:${port}`;
        for (const path of BRIDGE_SERVE_PATHS) {
          await runTailscale(["serve", "--bg", `--set-path=${path}`, proxy]);
        }
        const reach = `https://${stripTrailingDot(dnsName)}`;
        this.#bridge.setReach(reach);
        return this.buildStatus({
          tailscaleConnected: true,
          dnsName: stripTrailingDot(dnsName),
          serveConfigured: true,
          reach,
        });
      },
      catch: (cause) => ({
        cause:
          cause instanceof RemoteAgentBridgeReachError
            ? cause
            : new RemoteAgentBridgeReachError(503, sourceText("error.backend.remoteAgentBridgeReachFailed")),
      }),
    });
  });
}
