// The owner's Tailscale setup of this host, read and changed from the owner's client
// (`host-tailscale-v1`).
//
// OpenBot runs here as a user without root, so it never installs Tailscale and never changes a
// Tailscale setting. On a self-hosted server the owner runs `sudo openbot tailscale setup` once: it
// installs Tailscale with the official script and makes the OpenBot user the Tailscale "operator".
// After that, this module can start Tailscale with `tailscale up` (no flag that changes a setting, no
// auth key) and report the sign-in page that Tailscale gives. The owner opens that page on their own
// computer and approves the host in their tailnet. A host in WSL uses the Windows Tailscale app; the
// owner installs it on Windows.
//
// Every command is a fixed argument list run without a shell. Nothing from the request reaches one.

import { readFile } from "node:fs/promises";
import type {
  HostTailscaleSetup,
  TailscaleHostEnvironment,
  TailscaleSignInIssue,
  TailscaleWslNetworking,
} from "@openbot/contracts/ipc";
import { isHostTailscaleDnsName } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import {
  execTailscale,
  TAILSCALE_COMMANDS,
  type TailscaleCli,
  type TailscaleExec,
  type TailscalePlatform,
  WSL_WINDOWS_TAILSCALE,
} from "./tailscale-cli";
import type { TailscaleDirectService } from "./tailscale-direct-service";

const logger = createOpenBotLogger("tailscale-host-setup");

/** The kernel release names Microsoft in WSL 1 and WSL 2. */
export const OS_RELEASE_PATH = "/proc/sys/kernel/osrelease";
/** `openbot-server-setup` writes `self` here on a self-hosted server. */
export const HOSTED_MODE_PATH = "/opt/OpenBot/hosted/mode";
/** WSL 2 puts `wslinfo` here. Only absolute paths: nothing is looked up on the search path. */
export const WSL_INFO_CANDIDATES = ["/usr/bin/wslinfo", "/bin/wslinfo"] as const;
export const WSL_INFO_ARGS = ["--networking-mode"] as const;
const WSL_INFO_TIMEOUT_MS = 3_000;

export function isWslKernel(osRelease: string | null): boolean {
  return osRelease !== null && /microsoft/iu.test(osRelease);
}

/** Reads `wslinfo --networking-mode`. Any answer other than the two known modes is "unknown". */
export function parseWslNetworking(text: string): TailscaleWslNetworking {
  const mode = text.trim().toLowerCase();
  return mode === "mirrored" || mode === "nat" ? mode : "unknown";
}

/**
 * Why `tailscale up` did not start a sign-in. Tailscale refuses a user that is not the operator with
 * "Access denied"; only root can make the OpenBot user the operator.
 */
export function signInIssueFor(detail: string): TailscaleSignInIssue {
  return /access denied|permission denied|operator|must be root|run as root|sudo/iu.test(detail)
    ? "needs-setup"
    : "failed";
}

export interface TailscaleHostEnvironmentOptions {
  platform: TailscalePlatform;
  /** This process is a self-hosted server that systemd started (`OPENBOT_SERVER=1`). */
  serverMode: boolean;
  readText?: (path: string) => Promise<string | null>;
  exec?: TailscaleExec;
}

interface HostFacts {
  environment: TailscaleHostEnvironment;
  setupCommand: boolean;
  /** `wslinfo` answered, or "unknown". Null outside WSL. */
  wslNetworking: TailscaleWslNetworking | null;
}

export interface TailscaleHostSetupOptions extends TailscaleHostEnvironmentOptions {
  direct: TailscaleDirectService;
  cli: TailscaleCli;
}

export class TailscaleHostSetup {
  readonly #direct: TailscaleDirectService;
  readonly #cli: TailscaleCli;
  readonly #options: TailscaleHostEnvironmentOptions;
  readonly #readText: (path: string) => Promise<string | null>;
  readonly #exec: TailscaleExec;
  readonly #signInLock = Semaphore.makeUnsafe(1);
  #facts: HostFacts | null = null;

  constructor(options: TailscaleHostSetupOptions) {
    this.#direct = options.direct;
    this.#cli = options.cli;
    this.#options = options;
    this.#readText = options.readText ?? ((path) => readFile(path, "utf8").catch(() => null));
    this.#exec = options.exec ?? execTailscale;
  }

  readonly status = Effect.fn("TailscaleHostSetup.status")(function* (this: TailscaleHostSetup) {
    return yield* this.#snapshot(null);
  });

  readonly setEnabled = Effect.fn("TailscaleHostSetup.setEnabled")(function* (
    this: TailscaleHostSetup,
    enabled: boolean,
  ) {
    yield* this.#direct.setEnabled(enabled);
    return yield* this.#snapshot(null);
  });

  /**
   * Starts Tailscale when it is installed but not connected, so that it reports its sign-in page. A
   * connected host, or one that already waits for a sign-in, runs nothing.
   */
  readonly signIn = Effect.fn("TailscaleHostSetup.signIn")(function* (this: TailscaleHostSetup) {
    return yield* this.#signInLock.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#direct.status();
        const state = this.#direct.localState();
        if (state.kind === "connected") return yield* this.#snapshot(null);
        if (state.kind === "not-installed") return yield* this.#snapshot("needs-setup");
        if (state.kind === "signed-out" && state.authUrl) return yield* this.#snapshot(null);
        const started = yield* this.#cli.run(TAILSCALE_COMMANDS.up()).pipe(Effect.result);
        // `up` stops with an error after its timeout while it waits for the sign-in. That is the
        // expected result; the state read below has the sign-in page.
        const status = yield* this.#snapshot(null);
        if (status.state === "connected" || status.loginUrl || started._tag === "Success") return status;
        const issue =
          started.failure.reason === "not-installed" ? "needs-setup" : signInIssueFor(started.failure.detail);
        logger.warn("Tailscale did not start a sign-in:", issue);
        return { ...status, signInIssue: issue };
      }),
    );
  });

  #snapshot(signInIssue: TailscaleSignInIssue | null): Effect.Effect<HostTailscaleSetup> {
    return Effect.gen({ self: this }, function* () {
      const host = yield* this.#direct.status();
      const state = this.#direct.localState();
      const facts = yield* this.#hostFacts();
      const command = facts.environment === "wsl" ? yield* this.#cli.locate() : null;
      // Mirrored networking matters only to the Windows app, which reaches the host from outside WSL.
      const windowsApp = command === null || command === WSL_WINDOWS_TAILSCALE;
      const dnsName = state.kind === "connected" ? state.dnsName : null;
      return {
        state: host.state,
        tailnet: host.tailnet?.slice(0, 200) ?? null,
        deviceName: host.deviceName?.slice(0, 200) ?? null,
        dnsName: dnsName && isHostTailscaleDnsName(dnsName) ? dnsName : null,
        httpsCertificates: state.kind === "connected" && state.httpsCertificates,
        enabled: host.enabled,
        url: host.url,
        issue: host.issue,
        issueDetail: host.issueDetail?.slice(0, 300) ?? null,
        loginUrl: state.kind === "signed-out" ? state.authUrl : null,
        environment: facts.environment,
        wslNetworking: facts.environment === "wsl" && windowsApp ? facts.wslNetworking : null,
        setupCommand: facts.setupCommand,
        signInIssue,
      } satisfies HostTailscaleSetup;
    });
  }

  /** What does not change while this process runs: the platform, WSL and its networking mode. */
  #hostFacts(): Effect.Effect<HostFacts> {
    return Effect.gen({ self: this }, function* () {
      if (this.#facts) return this.#facts;
      const { platform, serverMode } = this.#options;
      if (platform !== "linux") {
        this.#facts = { environment: "other", setupCommand: false, wslNetworking: null };
        return this.#facts;
      }
      const wsl = isWslKernel(yield* Effect.promise(() => this.#readText(OS_RELEASE_PATH)));
      const mode = serverMode ? yield* Effect.promise(() => this.#readText(HOSTED_MODE_PATH)) : null;
      // The setup command installs the Linux Tailscale. In WSL the owner installs the Windows app.
      const setupCommand = !wsl && mode?.trim() === "self";
      this.#facts = {
        environment: wsl ? "wsl" : "linux",
        setupCommand,
        wslNetworking: wsl ? yield* this.#wslNetworking() : null,
      };
      return this.#facts;
    });
  }

  #wslNetworking(): Effect.Effect<TailscaleWslNetworking> {
    return Effect.gen({ self: this }, function* () {
      for (const file of WSL_INFO_CANDIDATES) {
        const answer = yield* this.#exec(file, WSL_INFO_ARGS, WSL_INFO_TIMEOUT_MS).pipe(Effect.result);
        if (answer._tag === "Success") return parseWslNetworking(answer.success);
        if (answer.failure.reason !== "not-installed") return "unknown";
      }
      return "unknown";
    });
  }
}
