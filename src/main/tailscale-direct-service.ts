// The host side of the direct Tailscale path: the owner's switch, and `tailscale serve` set up and
// taken down with the host.
//
// When the switch is on and the host is online, a second loopback listener of the Team API opens and
// `tailscale serve` forwards `https://<device>.<tailnet>.ts.net` to it. Tailscale takes the
// connection inside the tailnet, with its own certificate; the Team API still listens on `127.0.0.1`
// only. Funnel is never used: a port that Funnel publishes is refused and taken down again.
//
// A `tailscale serve` port can hold the user's own configuration. This service changes a port only
// when nothing is configured there, or when the port forwards to the loopback address it set up last
// time. Otherwise it reports the port as in use. It keeps that last address in its settings file so a
// configuration left behind by a crash is recognised as its own.

import { readFile } from "node:fs/promises";
import { isValidTailscaleDirectApiUrl } from "@openbot/contracts/invite-links";
import type { TailscaleDirectIssue, TailscaleHostStatus } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { RemoteWorkflowError } from "./remote-service-effects";
import {
  loopbackProxyTarget,
  parseServePort,
  TAILSCALE_COMMANDS,
  type TailscaleCli,
  type TailscaleLocalState,
} from "./tailscale-cli";

const logger = createOpenBotLogger("tailscale-direct");

/** The HTTPS ports tried in order. 443 gives an address without a port. */
export const TAILSCALE_DIRECT_HTTPS_PORTS = [443, 8443] as const;

export interface TailscaleDirectSettings {
  version: 1;
  enabled: boolean;
  /** The serve port and loopback port this service set up last. Null when it set up none. */
  httpsPort: number | null;
  loopbackPort: number | null;
}

/** The second listener of the Team API. `HostService` supplies it. */
export interface TailscaleDirectListener {
  start(): Effect.Effect<number, RemoteWorkflowError>;
  stop(): Effect.Effect<void>;
}

export interface TailscaleDirectServiceOptions {
  settingsPath: string;
  cli: TailscaleCli;
}

export class TailscaleDirectService {
  readonly #settingsPath: string;
  readonly #cli: TailscaleCli;
  readonly #lock = Semaphore.makeUnsafe(1);
  #settings: TailscaleDirectSettings = { version: 1, enabled: false, httpsPort: null, loopbackPort: null };
  #listener: TailscaleDirectListener | null = null;
  #hostOnline = false;
  #url: string | null = null;
  #issue: { issue: TailscaleDirectIssue; detail: string | null } | null = null;
  #lastState: TailscaleLocalState = { kind: "not-running" };

  constructor(options: TailscaleDirectServiceOptions) {
    this.#settingsPath = options.settingsPath;
    this.#cli = options.cli;
  }

  /** Reads the switch. A missing or unreadable file is the default: off. */
  readonly load = Effect.fn("TailscaleDirect.load")(function* (this: TailscaleDirectService) {
    const text = yield* Effect.promise(() => readFile(this.#settingsPath, "utf8").catch(() => null));
    if (text === null) return;
    try {
      this.#settings = readSettings(JSON.parse(text));
    } catch {
      /* A damaged preference file is the default. The next change writes a new one. */
    }
  });

  attach(listener: TailscaleDirectListener): void {
    this.#listener = listener;
  }

  /** The address members can use now, or null. */
  url(): string | null {
    return this.#url;
  }

  get enabled(): boolean {
    return this.#settings.enabled;
  }

  /** What the last `tailscale status` of this service read. `status()` reads it again. */
  localState(): TailscaleLocalState {
    return this.#lastState;
  }

  readonly status = Effect.fn("TailscaleDirect.status")(function* (this: TailscaleDirectService) {
    this.#lastState = yield* this.#cli.status();
    return this.#snapshot();
  });

  readonly setEnabled = Effect.fn("TailscaleDirect.setEnabled")(function* (
    this: TailscaleDirectService,
    enabled: boolean,
  ) {
    yield* this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#save({ ...this.#settings, enabled });
        if (enabled && this.#hostOnline) yield* this.#serve();
        if (!enabled) yield* this.#unserve();
      }),
    );
    return yield* this.status();
  });

  /**
   * The host is online. With the switch on, the direct path starts. A failure is a reported issue.
   * The flag is set before the lock, and read again inside it, so a stop that comes in between wins.
   */
  readonly hostOnline = Effect.fn("TailscaleDirect.hostOnline")(function* (this: TailscaleDirectService) {
    this.#hostOnline = true;
    yield* this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#hostOnline && this.#settings.enabled) yield* this.#serve();
      }),
    );
  });

  /** The host stops. `tailscale serve` is taken down, and the listener closes. */
  readonly hostOffline = Effect.fn("TailscaleDirect.hostOffline")(function* (this: TailscaleDirectService) {
    this.#hostOnline = false;
    yield* this.#lock.withPermit(this.#unserve());
  });

  #snapshot(): TailscaleHostStatus {
    const state = this.#lastState;
    const issue =
      this.#issue ??
      (this.#settings.enabled && !this.#url && !this.#hostOnline
        ? { issue: "host-offline" as const, detail: null }
        : null);
    return {
      state: state.kind,
      tailnet: state.kind === "connected" ? state.tailnet : null,
      deviceName: state.kind === "connected" ? state.deviceName || null : null,
      enabled: this.#settings.enabled,
      url: this.#url,
      issue: issue?.issue ?? null,
      issueDetail: issue?.detail ?? null,
    };
  }

  readonly #serve = Effect.fn("TailscaleDirect.serve")(function* (this: TailscaleDirectService) {
    this.#issue = null;
    const listener = this.#listener;
    const state = yield* this.#cli.status();
    this.#lastState = state;
    if (!listener || state.kind !== "connected" || !state.dnsName) {
      return yield* this.#fail("tailscale-unavailable", null);
    }
    if (!state.httpsCertificates) return yield* this.#fail("https-certificates-off", null);
    const dnsName = state.dnsName;
    const serveStatus = yield* this.#cli.run(TAILSCALE_COMMANDS.serveStatus()).pipe(Effect.result);
    if (serveStatus._tag === "Failure") return yield* this.#fail("serve-failed", serveStatus.failure.detail);
    const ownTarget = this.#settings.loopbackPort === null ? null : loopbackProxyTarget(this.#settings.loopbackPort);
    const httpsPort = TAILSCALE_DIRECT_HTTPS_PORTS.find((port) => {
      const current = parseServePort(serveStatus.success, dnsName, port);
      if (current === null) return true;
      return (
        port === this.#settings.httpsPort &&
        ownTarget !== null &&
        current.rootProxy === ownTarget &&
        !current.otherHandlers &&
        !current.funnel
      );
    });
    if (httpsPort === undefined) return yield* this.#fail("port-in-use", null);
    const url = `https://${dnsName}${httpsPort === 443 ? "" : `:${httpsPort}`}`;
    if (!isValidTailscaleDirectApiUrl(url)) return yield* this.#fail("tailscale-unavailable", null);
    const loopbackPort = yield* listener.start().pipe(Effect.result);
    if (loopbackPort._tag === "Failure") return yield* this.#fail("serve-failed", null);
    // Recorded before the command runs, so a configuration it leaves behind is recognised as ours.
    yield* this.#save({ ...this.#settings, httpsPort, loopbackPort: loopbackPort.success });
    const served = yield* this.#cli
      .run(TAILSCALE_COMMANDS.serveOn(httpsPort, loopbackPort.success))
      .pipe(Effect.result);
    if (served._tag === "Failure") {
      yield* listener.stop();
      return yield* this.#fail("serve-failed", served.failure.detail);
    }
    // Read back what Tailscale now serves. Funnel on this port would publish the host to the internet.
    const check = yield* this.#cli.run(TAILSCALE_COMMANDS.serveStatus()).pipe(Effect.result);
    const configured = check._tag === "Success" ? parseServePort(check.success, dnsName, httpsPort) : null;
    if (!configured || configured.rootProxy !== loopbackProxyTarget(loopbackPort.success) || configured.funnel) {
      yield* this.#cli.run(TAILSCALE_COMMANDS.serveOff(httpsPort)).pipe(Effect.ignore);
      yield* listener.stop();
      return yield* this.#fail(configured?.funnel ? "funnel-on" : "serve-failed", null);
    }
    this.#url = url;
    logger.info(`Direct Tailscale path is on at HTTPS port ${httpsPort}.`);
  });

  /**
   * Takes down only a `tailscale serve` root path that still forwards to the address this service set.
   * The port goes too only when it holds nothing else.
   */
  readonly #unserve = Effect.fn("TailscaleDirect.unserve")(function* (this: TailscaleDirectService) {
    this.#url = null;
    this.#issue = null;
    const { httpsPort, loopbackPort } = this.#settings;
    if (httpsPort !== null && loopbackPort !== null) {
      const state = yield* this.#cli.status();
      this.#lastState = state;
      if (state.kind === "connected" && state.dnsName) {
        const dnsName = state.dnsName;
        const current = yield* this.#cli.run(TAILSCALE_COMMANDS.serveStatus()).pipe(
          Effect.map((text) => parseServePort(text, dnsName, httpsPort)),
          Effect.orElseSucceed(() => null),
        );
        if (current?.rootProxy === loopbackProxyTarget(loopbackPort)) {
          // A path that the user added on this port meanwhile stays: only the root path is removed then.
          const off = current.otherHandlers ? TAILSCALE_COMMANDS.serveRootOff : TAILSCALE_COMMANDS.serveOff;
          const removed = yield* this.#cli.run(off(httpsPort)).pipe(Effect.result);
          if (removed._tag === "Failure") logger.warn("Could not stop tailscale serve:", removed.failure.detail);
        }
      }
    }
    if (this.#listener) yield* this.#listener.stop();
  });

  #fail(issue: TailscaleDirectIssue, detail: string | null): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#url = null;
      this.#issue = { issue, detail: detail || null };
      logger.warn("Direct Tailscale path is not available:", issue, detail ? toLogValue(detail) : "");
    });
  }

  #save(settings: TailscaleDirectSettings): Effect.Effect<void> {
    this.#settings = settings;
    return writeJsonFileAtomically(this.#settingsPath, settings, { createDirectory: true }).pipe(
      Effect.catch((error) => Effect.sync(() => logger.warn("Could not save Tailscale settings:", toLogValue(error)))),
    );
  }
}

function readSettings(value: unknown): TailscaleDirectSettings {
  if (!isDynamicRecord(value) || value.version !== 1) throw new Error("Unknown Tailscale settings.");
  const port = (candidate: unknown) =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 65_535
      ? candidate
      : null;
  return {
    version: 1,
    enabled: value.enabled === true,
    httpsPort: port(value.httpsPort),
    loopbackPort: port(value.loopbackPort),
  };
}
