import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DiscordDelivery } from "@openbot/contracts/signal-protocol/discord-api";
import type { Server } from "bun";
import { Effect, type ManagedRuntime } from "effect";
import {
  type AppHandoff,
  applyAuthEvent,
  decodeAuthEvent,
  discordCallResponse,
  discordError,
  HANDOFF_NOT_HELD,
  HANDOFF_NOT_HELD_HEADER,
  parseDiscordCall,
} from "./app";
import type { DiscordApi } from "./discord-api";
import type { DiscordGatewayHandoff } from "./discord-gateway";
import {
  decodeClaimAnswer,
  decodeClaimRequest,
  decodeDeliveredAnswer,
  decodeDiscordDeliveryRequest,
  decodeDiscordSessionHandoff,
  decodeJoinAnswer,
  decodeQueueHandoff,
  decodeRefusals,
  decodeTrustedBatch,
} from "./handoff-bodies";
import type { RemoteTicketClaims } from "./protocol";
import type { SignalService, SignalSibling, SignalSocketCounts, SignalTokens } from "./signal-service";
import type { TrustedResumeTokenEntry } from "./state-snapshot";
import { type RemoteTokenService, RemoteTokenUnavailableError } from "./tokens";

export const HANDOFF_TOKEN_HEADER = "OpenBot-Handoff-Token";
const FORWARDED_HEADER = "OpenBot-Handoff-Forwarded";
const ADDRESS_HEADER = "OpenBot-Handoff-Address";
const TARGET_HEADER = "OpenBot-Handoff-Target";
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const CLAIM_TIMEOUT_MILLISECONDS = 2_000;
const FORWARD_TIMEOUT_MILLISECONDS = 15_000;
const SYNC_TIMEOUT_MILLISECONDS = 5_000;
const PING_TIMEOUT_MILLISECONDS = 1_000;
const PING_INTERVAL_MILLISECONDS = 1_000;
const PEER_GONE_PINGS = 2;
const TRUST_FLUSH_MILLISECONDS = 250;
const TRUST_BATCH_LIMIT = 5_000;
const HANDOFF_BODY_BYTES_LIMIT = 64 * 1024 * 1024;
const INGRESS_GONE_WAIT_MILLISECONDS = 5_000;
const DRAIN_EXIT_GRACE_MILLISECONDS = 10_000;
const ALONE_CLOSE_WAIT_MILLISECONDS = 2_000;
const WAVE_MILLISECONDS = 1_000;
const HOP_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

export type HandoffState = "starting" | "ready" | "draining";
export type SiblingRole = "old" | "new";

export type JoinResult =
  | { kind: "alone" }
  | { kind: "joined"; snapshot: string; discord: boolean }
  | { kind: "refused" };

type PeerAnswer = Response | "refused" | "failed";

export interface HandoffDependencies {
  readonly healthPort: number;
  readonly mainPort: number;
  readonly peerPort: number | null;
  readonly token: string | null;
  readonly drainSeconds: number;
  readonly signal: SignalService;
  readonly tokens: RemoteTokenService;
  readonly runtime: ManagedRuntime.ManagedRuntime<SignalTokens, never>;
  readonly discordApi: () => DiscordApi | null;
  readonly sealedState: () => string;
  readonly writeSnapshot: () => Promise<void>;
  readonly handle: (request: Request) => Promise<Response>;
  readonly stopListening: () => void;
  readonly discordHandOver: () => Promise<DiscordGatewayHandoff | null>;
  readonly discordTakeOver: (handoff: DiscordGatewayHandoff | null) => void;
  readonly authEventApplied: () => void;
  readonly exit: () => Promise<void>;
}

export interface DrainReport {
  sockets: SignalSocketCounts;
  waves: number;
  discordHandedOver: boolean;
  queueHandedOver: number;
}

export function sameSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

function connectionRefused(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ConnectionRefused" || code === "ECONNREFUSED";
}

function totalSockets(counts: SignalSocketCounts): number {
  return counts.unauthenticated + counts.ingress + counts.host + counts.client;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class SignalHandoff {
  readonly #dependencies: HandoffDependencies;
  readonly #marker = randomBytes(32).toString("base64url");
  #state: HandoffState = "starting";
  #role: SiblingRole | null = null;
  #missedPings = 0;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #trustTimer: ReturnType<typeof setInterval> | null = null;
  #pendingTrust: TrustedResumeTokenEntry[] = [];
  #drain: Promise<DrainReport> | null = null;
  #lastDrain: DrainReport | null = null;

  constructor(dependencies: HandoffDependencies) {
    this.#dependencies = dependencies;
  }

  get state(): HandoffState {
    return this.#state;
  }

  get role(): SiblingRole | null {
    return this.#role;
  }

  ready(): void {
    if (this.#state === "starting") this.#state = "ready";
  }

  readonly app: AppHandoff = {
    linked: () => this.#role !== null,
    isOld: () => this.#role === "new",
    forwarded: (request) => this.#forwarded(request),
    address: (request) => (this.#forwarded(request) ? request.headers.get(ADDRESS_HEADER) : null),
    forward: (request, body, remoteAddress) => this.#forward(request, body, remoteAddress),
    authEvent: (body) => this.#post("/handoff/auth-event", body, SYNC_TIMEOUT_MILLISECONDS).then(okAnswer),
    discordCall: (contentType, body) => this.#discordCall(contentType, body),
  };

  #forwarded(request: Request): boolean {
    const marker = request.headers.get(FORWARDED_HEADER);
    return marker !== null && sameSecret(marker, this.#marker);
  }

  async join(): Promise<JoinResult> {
    if (!this.#dependencies.token || !this.#dependencies.peerPort) return { kind: "alone" };
    const answer = await this.#request("/handoff/join", "{}", SYNC_TIMEOUT_MILLISECONDS);
    if (answer === "refused") return { kind: "alone" };
    if (answer === "failed") return { kind: "refused" };
    if (answer.status === 404 || answer.status === 405) {
      await answer.body?.cancel();
      return { kind: "alone" };
    }
    if (!answer.ok) {
      await answer.body?.cancel();
      return { kind: "refused" };
    }
    const body = decodeJoinAnswer(await answer.text().catch(() => ""));
    if (!body) return { kind: "refused" };
    return { kind: "joined", snapshot: body.snapshot, discord: body.discord === true };
  }

  link(role: SiblingRole): void {
    this.#role = role;
    this.#missedPings = 0;
    this.#dependencies.signal.setSibling(this.#sibling(role));
    this.#dependencies.tokens.onTrustedResumeToken((entry) => {
      if (this.#pendingTrust.length < TRUST_BATCH_LIMIT) this.#pendingTrust.push(entry);
    });
    this.#trustTimer ??= setInterval(() => void this.#flushTrust(), TRUST_FLUSH_MILLISECONDS);
    this.#pingTimer ??= setInterval(() => void this.#ping(), PING_INTERVAL_MILLISECONDS);
  }

  #unlink(reason: "left" | "gone"): void {
    if (this.#role === null) return;
    const role = this.#role;
    this.#role = null;
    this.#pendingTrust = [];
    this.#dependencies.signal.setSibling(null);
    this.#dependencies.tokens.onTrustedResumeToken(null);
    if (this.#trustTimer) clearInterval(this.#trustTimer);
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#trustTimer = null;
    this.#pingTimer = null;
    if (role === "old") this.#dependencies.discordTakeOver(null);
    console.log(
      reason === "left"
        ? "OpenBot Signal handoff is complete. The other process left."
        : "OpenBot Signal handoff peer is gone. This process continues alone.",
    );
  }

  #sibling(role: SiblingRole): SignalSibling {
    return {
      role,
      claimTicket: (claims: RemoteTicketClaims) =>
        Effect.tryPromise({
          try: async () => {
            const answer = await this.#post(
              "/handoff/claim-ticket",
              JSON.stringify({ jti: claims.jti, exp: claims.exp }),
              CLAIM_TIMEOUT_MILLISECONDS,
            );
            if (typeof answer === "string") throw new Error("unavailable");
            if (!answer.ok) {
              await answer.body?.cancel();
              throw new Error("unavailable");
            }
            const body = decodeClaimAnswer(await answer.text());
            if (!body) throw new Error("unavailable");
            return body.claimed;
          },
          catch: () =>
            new RemoteTokenUnavailableError({
              message: "The other Signal process did not answer the ticket check.",
              hostId: claims.hostId,
              sessionId: claims.sessionId,
              role: claims.role,
              authEpoch: claims.authEpoch,
            }),
        }),
      deliverDiscord: (guildId: string, delivery: DiscordDelivery) =>
        Effect.promise(async () => {
          const answer = await this.#post(
            "/handoff/discord-delivery",
            JSON.stringify({ guildId, delivery }),
            SYNC_TIMEOUT_MILLISECONDS,
          );
          if (typeof answer === "string") return false;
          if (!answer.ok) {
            await answer.body?.cancel();
            return false;
          }
          const body = decodeDeliveredAnswer(await answer.text().catch(() => ""));
          return body?.delivered === true;
        }),
    };
  }

  async #request(path: string, body: BodyInit | null, timeoutMilliseconds: number, headers: HeadersInit = {}) {
    const { peerPort, token } = this.#dependencies;
    if (!peerPort || !token) return "failed" as const;
    const sent = new Headers(headers);
    sent.set(HANDOFF_TOKEN_HEADER, token);
    try {
      return await fetch(`http://127.0.0.1:${peerPort}${path}`, {
        method: "POST",
        headers: sent,
        body,
        signal: AbortSignal.timeout(timeoutMilliseconds),
      });
    } catch (error) {
      return connectionRefused(error) ? ("refused" as const) : ("failed" as const);
    }
  }

  #post(path: string, body: BodyInit, timeoutMilliseconds: number): Promise<PeerAnswer> {
    if (this.#role === null) return Promise.resolve("failed");
    return this.#request(path, body, timeoutMilliseconds, { "Content-Type": "application/json" });
  }

  async #forward(
    request: Request,
    body: Uint8Array<ArrayBuffer>,
    remoteAddress: string | undefined,
  ): Promise<Response | null> {
    if (this.#role === null) return null;
    const url = new URL(request.url);
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase();
      if (HOP_HEADERS.has(lower) || lower.startsWith("openbot-handoff")) continue;
      headers.set(name, value);
    }
    headers.set(TARGET_HEADER, `${url.pathname}${url.search}`);
    if (remoteAddress) headers.set(ADDRESS_HEADER, remoteAddress);
    const answer = await this.#request("/handoff/forward", body, FORWARD_TIMEOUT_MILLISECONDS, headers);
    if (typeof answer === "string") return null;
    if (answer.headers.get(HANDOFF_NOT_HELD_HEADER) === HANDOFF_NOT_HELD) {
      await answer.body?.cancel();
      return null;
    }
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  }

  async #discordCall(contentType: string, body: Uint8Array<ArrayBuffer>): Promise<Response | null> {
    const answer = await this.#request("/handoff/discord-call", body, FORWARD_TIMEOUT_MILLISECONDS, {
      "Content-Type": contentType,
    });
    if (typeof answer === "string") return null;
    if (answer.status === 503) {
      await answer.body?.cancel();
      return null;
    }
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  }

  async #flushTrust(): Promise<void> {
    if (this.#pendingTrust.length === 0) return;
    const entries = this.#pendingTrust;
    this.#pendingTrust = [];
    const answer = await this.#post("/handoff/trusted", JSON.stringify({ entries }), SYNC_TIMEOUT_MILLISECONDS);
    if (typeof answer !== "string") await answer.body?.cancel();
  }

  async #ping(): Promise<void> {
    if (this.#role === null) return;
    const answer = await this.#post("/handoff/ping", "{}", PING_TIMEOUT_MILLISECONDS);
    if (answer === "refused") {
      this.#missedPings += 1;
      if (this.#missedPings >= PEER_GONE_PINGS) this.#unlink("gone");
      return;
    }
    if (typeof answer !== "string") {
      await answer.body?.cancel();
      if (answer.status === 404 || answer.status === 409) {
        this.#missedPings += 1;
        if (this.#missedPings >= PEER_GONE_PINGS) this.#unlink("gone");
        return;
      }
    }
    this.#missedPings = 0;
  }

  routes(): Record<string, (request: Request, server: Server<unknown>) => Response | Promise<Response>> {
    const guarded =
      (handler: (request: Request) => Response | Promise<Response>) => (request: Request, server: Server<unknown>) => {
        const peer = server.requestIP(request)?.address;
        const token = this.#dependencies.token;
        if (
          request.method !== "POST" ||
          !token ||
          !peer ||
          !LOOPBACK_ADDRESSES.has(peer) ||
          !sameSecret(request.headers.get(HANDOFF_TOKEN_HEADER) ?? "", token)
        ) {
          return new Response("Not found", { status: 404 });
        }
        return handler(request);
      };
    const linkedOnly = (handler: (request: Request) => Response | Promise<Response>) =>
      guarded((request) => (this.#role === null ? new Response(null, { status: 409 }) : handler(request)));
    return {
      "/handoff/join": guarded(() => this.#acceptJoin()),
      "/handoff/ping": linkedOnly(() => Response.json({ state: this.#state })),
      "/handoff/claim-ticket": linkedOnly(async (request) => {
        const body = decodeClaimRequest(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        return Response.json({ claimed: this.#dependencies.signal.claimTicket(body.jti, body.exp) });
      }),
      "/handoff/auth-event": linkedOnly(async (request) => {
        const event = decodeAuthEvent(await request.text());
        if (!event) return new Response(null, { status: 400 });
        applyAuthEvent(this.#dependencies.signal, event);
        this.#dependencies.authEventApplied();
        return new Response(null, { status: 204 });
      }),
      "/handoff/trusted": linkedOnly(async (request) => {
        const body = decodeTrustedBatch(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        const signal = this.#dependencies.signal;
        this.#dependencies.tokens.importTrustedResumeTokens(body.entries, (token) => signal.refusesTrust(token));
        return new Response(null, { status: 204 });
      }),
      "/handoff/refusals": linkedOnly(async (request) => {
        const body = decodeRefusals(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        this.#dependencies.signal.importRefusals(body);
        return new Response(null, { status: 204 });
      }),
      "/handoff/forward": linkedOnly((request) => this.#acceptForward(request)),
      "/handoff/discord-call": linkedOnly((request) => this.#acceptDiscordCall(request)),
      "/handoff/discord-delivery": linkedOnly(async (request) => {
        const body = decodeDiscordDeliveryRequest(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        return Response.json({
          delivered: this.#dependencies.signal.deliverDiscord(body.guildId, body.delivery, true),
        });
      }),
      "/handoff/queue": linkedOnly(async (request) => {
        const body = decodeQueueHandoff(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        this.#dependencies.signal.adoptQueue(body);
        return new Response(null, { status: 204 });
      }),
      "/handoff/discord-session": linkedOnly(async (request) => {
        const body = decodeDiscordSessionHandoff(await readText(request));
        if (!body) return new Response(null, { status: 400 });
        this.#dependencies.discordTakeOver(body);
        return new Response(null, { status: 204 });
      }),
      "/handoff/leave": linkedOnly(async (request) => {
        const body = decodeRefusals(await readText(request));
        if (body) this.#dependencies.signal.importRefusals(body);
        await this.#flushTrust();
        this.#unlink("left");
        return new Response(null, { status: 204 });
      }),
      "/handoff/drain": guarded(() => {
        if (this.#state === "starting") return new Response(null, { status: 409 });
        void this.drain();
        return Response.json(
          { state: this.#state, sockets: this.#dependencies.signal.socketCounts() },
          { status: 202 },
        );
      }),
      "/handoff/status": guarded(() =>
        Response.json({
          state: this.#state,
          linked: this.#role !== null,
          sockets: this.#dependencies.signal.socketCounts(),
          drain: this.#lastDrain,
        }),
      ),
    };
  }

  #acceptJoin(): Response {
    if (this.#role !== null || this.#state !== "ready") return new Response(null, { status: 409 });
    this.link("new");
    return Response.json(
      { snapshot: this.#dependencies.sealedState(), discord: this.#dependencies.discordApi() !== null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  async #acceptForward(request: Request): Promise<Response> {
    if (this.#state === "starting") {
      await request.body?.cancel();
      return new Response(null, { status: 421, headers: { [HANDOFF_NOT_HELD_HEADER]: HANDOFF_NOT_HELD } });
    }
    const target = request.headers.get(TARGET_HEADER);
    if (!target?.startsWith("/") || target.startsWith("//")) return new Response(null, { status: 400 });
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase();
      if (HOP_HEADERS.has(lower) || (lower.startsWith("openbot-handoff") && lower !== ADDRESS_HEADER.toLowerCase()))
        continue;
      headers.set(name, value);
    }
    headers.set(FORWARDED_HEADER, this.#marker);
    const body = new Uint8Array(await request.arrayBuffer());
    headers.set("content-length", String(body.byteLength));
    return this.#dependencies.handle(
      new Request(`http://127.0.0.1:${this.#dependencies.mainPort}${target}`, { method: "POST", headers, body }),
    );
  }

  async #acceptDiscordCall(request: Request): Promise<Response> {
    const discord = this.#dependencies.discordApi();
    if (!discord) return discordError(503, "unavailable");
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > HANDOFF_BODY_BYTES_LIMIT) return discordError(413, "invalid_request");
    const input = await parseDiscordCall(request.headers.get("content-type") ?? "", body);
    if ("status" in input) return discordError(input.status, "invalid_request");
    return discordCallResponse(this.#dependencies.signal, this.#dependencies.runtime, discord, input, request.signal);
  }

  drain(): Promise<DrainReport> {
    this.#drain ??= this.#runDrain();
    return this.#drain;
  }

  async #runDrain(): Promise<DrainReport> {
    const { signal } = this.#dependencies;
    this.#state = "draining";
    this.#dependencies.stopListening();
    signal.startDrain();
    await this.#dependencies.writeSnapshot().catch(() => undefined);
    const report: DrainReport = {
      sockets: signal.socketCounts(),
      waves: 0,
      discordHandedOver: false,
      queueHandedOver: 0,
    };
    this.#lastDrain = report;
    if (this.#role !== "new") {
      signal.closeAllForHandoff();
      await this.#waitForSockets(Date.now() + ALONE_CLOSE_WAIT_MILLISECONDS, (counts) => totalSockets(counts) === 0);
      await this.#dependencies.exit();
      return report;
    }
    await this.#sendRefusals("/handoff/refusals");
    const windowMilliseconds = this.#dependencies.drainSeconds * 1_000;
    const deadline = Date.now() + windowMilliseconds + DRAIN_EXIT_GRACE_MILLISECONDS;
    const groups = signal.drainGroups();
    const waves = Math.max(1, Math.floor(windowMilliseconds / WAVE_MILLISECONDS));
    const perWave = Math.max(1, Math.ceil((groups.ingress.length + groups.hosts.length) / waves));
    report.waves += await this.#closeInWaves(groups.ingress, perWave);
    await this.#waitForSockets(Date.now() + INGRESS_GONE_WAIT_MILLISECONDS, (counts) => counts.ingress === 0);
    report.discordHandedOver = await this.#handOverDiscord();
    report.queueHandedOver = await this.#handOverQueue();
    report.waves += await this.#closeInWaves(groups.hosts, perWave);
    await this.#waitForSockets(deadline, (counts) => totalSockets(counts) === 0);
    report.sockets = signal.socketCounts();
    signal.closeAllForHandoff();
    await this.#flushTrust();
    await this.#sendRefusals("/handoff/leave");
    this.#unlink("left");
    await this.#dependencies.exit();
    return report;
  }

  async #closeInWaves(groups: string[][], perWave: number): Promise<number> {
    let waves = 0;
    for (let index = 0; index < groups.length; index += perWave) {
      if (waves > 0) await wait(WAVE_MILLISECONDS);
      this.#dependencies.signal.closeForHandoff(groups.slice(index, index + perWave).flat());
      waves += 1;
    }
    return waves;
  }

  async #waitForSockets(deadline: number, done: (counts: SignalSocketCounts) => boolean): Promise<void> {
    while (Date.now() < deadline && !done(this.#dependencies.signal.socketCounts())) await wait(100);
  }

  async #sendRefusals(path: "/handoff/refusals" | "/handoff/leave"): Promise<void> {
    const answer = await this.#post(
      path,
      JSON.stringify(this.#dependencies.signal.exportRefusals()),
      SYNC_TIMEOUT_MILLISECONDS,
    );
    if (typeof answer !== "string") await answer.body?.cancel();
  }

  async #handOverDiscord(): Promise<boolean> {
    const handoff = await this.#dependencies.discordHandOver();
    if (!handoff) return false;
    const answer = await this.#post("/handoff/discord-session", JSON.stringify(handoff), SYNC_TIMEOUT_MILLISECONDS);
    if (typeof answer === "string") return false;
    await answer.body?.cancel();
    return answer.ok;
  }

  async #handOverQueue(): Promise<number> {
    const queue = this.#dependencies.signal.handOverQueue();
    if (queue.entries.length === 0 && queue.keys.length === 0) return 0;
    const answer = await this.#post("/handoff/queue", JSON.stringify(queue), SYNC_TIMEOUT_MILLISECONDS);
    if (typeof answer !== "string") await answer.body?.cancel();
    if (typeof answer === "string" || !answer.ok) {
      this.#dependencies.signal.adoptQueue(queue);
      return 0;
    }
    return queue.entries.length;
  }

  close(): void {
    if (this.#trustTimer) clearInterval(this.#trustTimer);
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#trustTimer = null;
    this.#pingTimer = null;
  }
}

function okAnswer(answer: PeerAnswer): boolean {
  if (typeof answer === "string") return false;
  void answer.body?.cancel();
  return answer.ok;
}

async function readText(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > HANDOFF_BODY_BYTES_LIMIT) {
    await request.body?.cancel();
    return "";
  }
  return request.text().catch(() => "");
}
