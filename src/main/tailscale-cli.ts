// The local Tailscale client, read and driven through its command line.
//
// OpenBot does not sign in to Tailscale and holds no Tailscale credential. It runs the `tailscale`
// program that the user installed, with a fixed argument list and no shell: no argument is ever built
// from text that another computer or the renderer sent. The only variable parts are a port number that
// this process chose and a loopback URL made from it. Each run has a deadline, and its output has a size
// limit. A run never reads standard input, so a command that would ask a question fails instead.
//
// The parsers below read `tailscale status --json` and `tailscale serve status --json`. Both are
// untrusted text from another program: a field that is missing or has the wrong type reads as absent.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

export const TAILSCALE_COMMAND_TIMEOUT_MS = 10_000;
const TAILSCALE_OUTPUT_LIMIT = 8 * 1024 * 1024;

export class TailscaleCommandError extends Schema.TaggedError<TailscaleCommandError>()("TailscaleCommandError", {
  reason: Schema.Literals(["not-installed", "failed"]),
  /** The first line of the program's error output, shortened. It holds no credential. */
  detail: Schema.String,
}) {}

/** Runs one program with a fixed argument list and answers its standard output. */
export type TailscaleExec = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Effect.Effect<string, TailscaleCommandError>;

/** Answers the first candidate that exists and can run, or null. */
export type TailscaleLocate = () => Effect.Effect<string | null>;

export type TailscalePlatform = "darwin" | "win32" | "linux";

/**
 * Where each platform installs the command. The macOS app keeps its command inside the bundle; the
 * standalone and Homebrew builds and the Linux packages put `tailscale` on the search path.
 */
export function tailscaleCandidates(platform: TailscalePlatform, env: NodeJS.ProcessEnv): string[] {
  const path = platform === "win32" ? win32 : posix;
  const name = platform === "win32" ? "tailscale.exe" : "tailscale";
  const fixed =
    platform === "darwin"
      ? [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
        ]
      : platform === "win32"
        ? [env.ProgramFiles, env["ProgramFiles(x86)"]]
            .filter((directory): directory is string => isString(directory) && path.isAbsolute(directory))
            .map((directory) => path.join(directory, "Tailscale", name))
        : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale", "/snap/bin/tailscale"];
  // Only absolute directories: a relative entry would run a program from the current directory.
  const searchPath = (env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .filter((directory) => path.isAbsolute(directory))
    .map((directory) => path.join(directory, name));
  return [...new Set([...fixed, ...searchPath])];
}

export function locateTailscale(platform: TailscalePlatform, env: NodeJS.ProcessEnv = process.env): TailscaleLocate {
  return () =>
    Effect.promise(async () => {
      for (const candidate of tailscaleCandidates(platform, env)) {
        try {
          await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
          return candidate;
        } catch {
          /* Try the next installation directory. */
        }
      }
      return null;
    });
}

/** `execFile` without a shell. Standard input is closed at once. */
export const execTailscale: TailscaleExec = (file, args, timeoutMs) =>
  Effect.callback<string, TailscaleCommandError>((resume) => {
    const child = execFile(
      file,
      [...args],
      { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: TAILSCALE_OUTPUT_LIMIT, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resume(Effect.succeed(stdout));
          return;
        }
        const missing = "code" in error && error.code === "ENOENT";
        resume(
          Effect.fail(
            new TailscaleCommandError({
              reason: missing ? "not-installed" : "failed",
              detail: firstLine(stderr) || firstLine(stdout) || (error.killed ? "timeout" : ""),
            }),
          ),
        );
      },
    );
    child.stdin?.end();
    return Effect.sync(() => {
      child.kill();
    });
  });

function firstLine(text: string | undefined): string {
  return (text ?? "").trim().split(/\r?\n/u, 1)[0]?.slice(0, 300) ?? "";
}

export type TailscaleLocalState =
  | { kind: "not-installed" }
  /** The command exists, but the Tailscale service or app does not answer. */
  | { kind: "not-running" }
  | { kind: "signed-out" }
  /** Signed in, with Tailscale turned off. */
  | { kind: "stopped" }
  | {
      kind: "connected";
      /** The tailnet name as Tailscale shows it. Only shown on this computer. */
      tailnet: string | null;
      deviceName: string;
      /** This device's MagicDNS name, without the final dot, in lowercase. */
      dnsName: string | null;
      /** Whether the tailnet issues HTTPS certificates, which `tailscale serve` needs. */
      httpsCertificates: boolean;
      /** The MagicDNS names of the devices this one can see, shared devices included. */
      peerDnsNames: readonly string[];
    };

/** Reads `tailscale status --json`. A value that does not make sense reads as "not running". */
export function parseTailscaleStatus(text: string): TailscaleLocalState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "not-running" };
  }
  if (!isDynamicRecord(value)) return { kind: "not-running" };
  const backend = value.BackendState;
  if (backend === "NeedsLogin" || backend === "NeedsMachineAuth") return { kind: "signed-out" };
  if (backend === "Stopped") return { kind: "stopped" };
  if (backend !== "Running") return { kind: "not-running" };
  const self = isDynamicRecord(value.Self) ? value.Self : {};
  const tailnet = isDynamicRecord(value.CurrentTailnet) ? value.CurrentTailnet : {};
  const peers = isDynamicRecord(value.Peer) ? Object.values(value.Peer) : [];
  return {
    kind: "connected",
    tailnet: isString(tailnet.Name) && tailnet.Name ? tailnet.Name.slice(0, 200) : null,
    deviceName: isString(self.HostName) ? self.HostName.slice(0, 200) : "",
    dnsName: magicDnsName(self.DNSName),
    httpsCertificates: Array.isArray(value.CertDomains) && value.CertDomains.some(isString),
    peerDnsNames: peers.flatMap((peer) => {
      const name = isDynamicRecord(peer) ? magicDnsName(peer.DNSName) : null;
      return name ? [name] : [];
    }),
  };
}

function magicDnsName(value: unknown): string | null {
  if (!isString(value)) return null;
  const name = value.replace(/\.$/u, "").toLowerCase();
  return name.endsWith(".ts.net") && name.length <= 253 ? name : null;
}

/** What `tailscale serve` does at one HTTPS port of this device. */
export interface TailscaleServePort {
  /** The proxy target of the root path, or null when the root path serves something else. */
  rootProxy: string | null;
  /** Whether the port serves a path other than the root, or a TCP forward. */
  otherHandlers: boolean;
  /** Whether Funnel publishes this port to the internet. */
  funnel: boolean;
}

/**
 * Reads `tailscale serve status --json` for one port. Null means nothing is configured there. An
 * output that cannot be read counts as a port in use, so OpenBot never replaces a configuration it
 * did not understand.
 */
export function parseServePort(text: string, dnsName: string, port: number): TailscaleServePort | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { rootProxy: null, otherHandlers: true, funnel: false };
  }
  if (!isDynamicRecord(value)) return { rootProxy: null, otherHandlers: true, funnel: false };
  const hostPort = `${dnsName}:${port}`;
  const tcp = isDynamicRecord(value.TCP) ? value.TCP[String(port)] : undefined;
  const web = isDynamicRecord(value.Web) ? value.Web[hostPort] : undefined;
  const funnel = isDynamicRecord(value.AllowFunnel) && value.AllowFunnel[hostPort] === true;
  if (tcp === undefined && web === undefined && !funnel) return null;
  const handlers = isDynamicRecord(web) && isDynamicRecord(web.Handlers) ? web.Handlers : {};
  const root = handlers["/"];
  const rootProxy = isDynamicRecord(root) && isString(root.Proxy) ? root.Proxy : null;
  const tcpForward = isDynamicRecord(tcp) && (tcp.TCPForward !== undefined || tcp.HTTPS !== true);
  return {
    rootProxy,
    otherHandlers: tcpForward || Object.keys(handlers).some((path) => path !== "/"),
    funnel,
  };
}

/** The proxy target `tailscale serve` is given, and reports back, for a loopback port. */
export function loopbackProxyTarget(port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid loopback port.");
  return `http://127.0.0.1:${port}`;
}

/** The commands this module runs. Each is a fixed list; only a port this process chose varies. */
export const TAILSCALE_COMMANDS = {
  status: () => ["status", "--json"],
  serveStatus: () => ["serve", "status", "--json"],
  serveOn: (httpsPort: number, loopbackPort: number) => [
    "serve",
    "--bg",
    `--https=${validPort(httpsPort)}`,
    loopbackProxyTarget(loopbackPort),
  ],
  serveOff: (httpsPort: number) => ["serve", `--https=${validPort(httpsPort)}`, "off"],
} as const;

function validPort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid port.");
  return port;
}

/** One local Tailscale client: its command, located once per call, and the runs above. */
export class TailscaleCli {
  readonly #locate: TailscaleLocate;
  readonly #exec: TailscaleExec;
  readonly #timeoutMs: number;

  constructor(options: { locate: TailscaleLocate; exec?: TailscaleExec; timeoutMs?: number }) {
    this.#locate = options.locate;
    this.#exec = options.exec ?? execTailscale;
    this.#timeoutMs = options.timeoutMs ?? TAILSCALE_COMMAND_TIMEOUT_MS;
  }

  /** The state of this device. A command that fails reads as "not running", never as an error. */
  readonly status = Effect.fn("TailscaleCli.status")(function* (this: TailscaleCli) {
    const file = yield* this.#locate();
    if (!file) return { kind: "not-installed" } satisfies TailscaleLocalState;
    return yield* this.#exec(file, TAILSCALE_COMMANDS.status(), this.#timeoutMs).pipe(
      Effect.map(parseTailscaleStatus),
      Effect.catch((error) =>
        Effect.succeed<TailscaleLocalState>(
          error.reason === "not-installed" ? { kind: "not-installed" } : { kind: "not-running" },
        ),
      ),
    );
  });

  run(args: readonly string[]): Effect.Effect<string, TailscaleCommandError> {
    return Effect.gen({ self: this }, function* () {
      const file = yield* this.#locate();
      if (!file) return yield* new TailscaleCommandError({ reason: "not-installed", detail: "" });
      return yield* this.#exec(file, args, this.#timeoutMs);
    });
  }
}
