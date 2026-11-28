import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IngressRoute, ROUTE_HOST_STATES } from "@openbot/contracts/signal-protocol/ingress-queue";
import type { Server } from "bun";
import { Context, Effect, Layer, ManagedRuntime, Schema, Semaphore } from "effect";
import { goAwayRoute } from "./admin-go-away";
import { applyAuthEvent, createRemoteApiApp, decodeAuthEvent, prometheusMetrics } from "./app";
import { readRemoteApiConfig } from "./config";
import type { DiscordApi } from "./discord-api";
import { DiscordGateway, type DiscordGatewayHandoff } from "./discord-gateway";
import { SignalEntry } from "./entry";
import { SignalHandoff } from "./handoff";
import type { RouteWake } from "./ingress-queue";
import { makeResumeBatcher } from "./resume-batch";
import { sameSecret } from "./same-secret";
import { SignalService } from "./signal-service";
import {
  openSnapshot,
  readSnapshotFile,
  type SignalStatePayload,
  sealSnapshot,
  writeSnapshotFile,
} from "./state-snapshot";
import { TelegramBotApi } from "./telegram";
import {
  RemoteTokenError,
  RemoteTokenService,
  RemoteTokenUnavailableError,
  signServiceRequest,
  type TelegramChatLink,
  TelegramFileTokens,
} from "./tokens";
import { TurnRelays } from "./turn-relays";

const config = readRemoteApiConfig();
const turnRelays = new TurnRelays(config);
const entry = new SignalEntry(config);
const turnRuntime = ManagedRuntime.make(turnRelays.watch());
await turnRuntime.runPromise(Effect.void);
class ControlPlaneError extends Schema.TaggedError<ControlPlaneError>()("ControlPlaneError", {
  message: Schema.String,
}) {}

const RESUME_CHECK_CONCURRENCY = 64;
const RESUME_CHECK_DEADLINE = "15 seconds";
const RESUME_BATCH_WAIT = "25 millis";
const RESUME_BATCH_CONCURRENCY = 128;
const RESUME_BATCH_RETRY_AFTER_MILLISECONDS = 10 * 60_000;
const HOST_WAKE_DEADLINE_MILLISECONDS = 10_000;

const ResumeValidation = Schema.Struct({ valid: Schema.Boolean });
const ResumeBatchValidation = Schema.Struct({ valid: Schema.Array(Schema.Boolean) });
const SlackValidation = Schema.Struct({ teams: Schema.Array(Schema.String) });
const TelegramValidation = Schema.Struct({
  chats: Schema.Array(Schema.Struct({ id: Schema.String, botId: Schema.String, linkedAt: Schema.Int })),
});
const TelegramLink = Schema.Struct({ hostId: Schema.String, linkedAt: Schema.Int });
const DiscordValidation = Schema.Struct({ guilds: Schema.Array(Schema.String) });
const WebhookValidation = Schema.Struct({ routes: Schema.Array(Schema.String) });
const AuthEventPage = Schema.Struct({
  events: Schema.Array(Schema.Struct({ eventId: Schema.String, attemptedAt: Schema.Number, payload: Schema.String })),
  more: Schema.Boolean,
});
type AuthEventCursor = { attemptedAt: number; eventId: string };
const AUTH_EVENT_PAGE_LIMIT = 500;
const AUTH_EVENT_CATCH_UP_MILLISECONDS = 3_000;
const AUTH_EVENT_CATCH_UP_OVERLAP_MILLISECONDS = 120_000;
const SIGTERM_DRAIN_SLACK_MILLISECONDS = 15_000;
const RouteWakeAnswer = Schema.Struct({
  hostId: Schema.NullOr(Schema.String),
  state: Schema.Literals(ROUTE_HOST_STATES),
});

class ControlPlane extends Context.Service<
  ControlPlane,
  {
    validateResume(claims: import("./protocol").RemoteTicketClaims): Effect.Effect<boolean, ControlPlaneError>;
    validateSlackRoute(
      hostId: string,
      teams: import("@openbot/contracts/signal-protocol/slack-route").SlackRouteTeam[],
    ): Effect.Effect<string[], ControlPlaneError>;
    validateTelegramRoute(
      hostId: string,
      chats: import("@openbot/contracts/signal-protocol/telegram-route").TelegramRouteChat[],
    ): Effect.Effect<
      import("@openbot/contracts/signal-protocol/telegram-route").TelegramRouteChat[],
      ControlPlaneError
    >;
    linkTelegramChat(
      botId: string,
      chatId: string,
      code: string,
    ): Effect.Effect<TelegramChatLink | null, ControlPlaneError>;
    validateDiscordRoute(
      hostId: string,
      guilds: import("@openbot/contracts/signal-protocol/discord-route").DiscordRouteGuild[],
    ): Effect.Effect<string[], ControlPlaneError>;
    validateWebhookRoute(
      hostId: string,
      routes: import("@openbot/contracts/signal-protocol/webhook-route").WebhookRoute[],
    ): Effect.Effect<string[], ControlPlaneError>;
    discordGuildRemoved(guildId: string): Effect.Effect<void, ControlPlaneError>;
    routeWake(route: IngressRoute, wake: boolean): Effect.Effect<RouteWake, ControlPlaneError>;
    supportsRouteWake(): Effect.Effect<boolean>;
    hostWake(hostId: string): Effect.Effect<RouteWake, ControlPlaneError>;
    reconcileDiscordGuilds(guildIds: string[], before: number): Effect.Effect<void, ControlPlaneError>;
    authEventsAfter(
      cursor: AuthEventCursor,
      timeoutMilliseconds: number,
    ): Effect.Effect<typeof AuthEventPage.Type, ControlPlaneError>;
  }
>()("@openbot/remote-api/ControlPlane") {
  static layer = Layer.effect(
    ControlPlane,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const ask = Effect.fn("ControlPlane.request")((path: string, payload: unknown, timeoutMilliseconds = 5_000) =>
        Effect.tryPromise({
          try: (signal) => {
            const body = JSON.stringify(payload);
            const timestamp = Math.floor(Date.now() / 1_000).toString();
            return fetch(new URL(path, config.controlPlaneUrl), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "OpenBot-Timestamp": timestamp,
                "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
              },
              body,
              signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]),
            });
          },
          catch: () => new ControlPlaneError({ message: "The account service request failed." }),
        }),
      );
      const readJson = (response: Response) =>
        Effect.tryPromise({
          try: () => response.json(),
          catch: () => new ControlPlaneError({ message: "The account service response is invalid." }),
        });
      const releaseResponse = (response: Response) => {
        const body = response.body;
        return body
          ? Effect.tryPromise({ try: () => body.cancel(), catch: () => undefined }).pipe(
              Effect.catch(() => Effect.void),
            )
          : Effect.void;
      };
      const resumeChecks = Semaphore.makeUnsafe(RESUME_CHECK_CONCURRENCY);
      const unavailable = () => new ControlPlaneError({ message: "The account service is unavailable." });
      const invalidAnswer = () => new ControlPlaneError({ message: "The account service response is invalid." });
      const validateOne = (claims: import("./protocol").RemoteTicketClaims) =>
        Effect.acquireUseRelease(
          ask("/v2/remote/resume/validate", claims),
          (response) =>
            Effect.gen(function* () {
              if (response.status >= 500 || response.status === 429) return yield* unavailable();
              if (!response.ok) return false;
              const result = yield* readJson(response).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ResumeValidation)),
                Effect.mapError(invalidAnswer),
              );
              return result.valid;
            }),
          releaseResponse,
        ).pipe(resumeChecks.withPermit);
      let batchUnsupportedUntil = 0;
      const validateBatch = (claims: readonly import("./protocol").RemoteTicketClaims[]) =>
        Date.now() < batchUnsupportedUntil
          ? Effect.succeed("unsupported" as const)
          : Effect.acquireUseRelease(
              ask("/v2/remote/resume/validate-batch", { claims }),
              (response) =>
                Effect.gen(function* () {
                  if (response.status >= 500 || response.status === 429) return yield* unavailable();
                  if (response.status === 404 || response.status === 405)
                    batchUnsupportedUntil = Date.now() + RESUME_BATCH_RETRY_AFTER_MILLISECONDS;
                  if (!response.ok) return "unsupported" as const;
                  const result = yield* readJson(response).pipe(
                    Effect.flatMap(Schema.decodeUnknownEffect(ResumeBatchValidation)),
                    Effect.mapError(invalidAnswer),
                  );
                  if (result.valid.length !== claims.length) return yield* invalidAnswer();
                  return { valid: result.valid };
                }),
              releaseResponse,
            );
      const validateInBatch = makeResumeBatcher({
        scope,
        wait: RESUME_BATCH_WAIT,
        concurrency: RESUME_BATCH_CONCURRENCY,
        batch: validateBatch,
        single: validateOne,
      });
      return ControlPlane.of({
        validateResume: Effect.fn("ControlPlane.validateResume")(
          (claims) => validateInBatch(claims),
          Effect.timeoutOrElse({
            duration: RESUME_CHECK_DEADLINE,
            orElse: () => Effect.fail(unavailable()),
          }),
        ),
        validateSlackRoute: Effect.fn("ControlPlane.validateSlackRoute")((hostId, teams) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/slack-route/validate", { hostId, teams }),
            (response) =>
              Effect.gen(function* () {
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not confirm the Slack route.",
                  });
                const result = yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(SlackValidation)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
                return [...result.teams];
              }),
            releaseResponse,
          ),
        ),
        validateDiscordRoute: Effect.fn("ControlPlane.validateDiscordRoute")((hostId, guilds) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/discord-route/validate", { hostId, guilds }),
            (response) =>
              Effect.gen(function* () {
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not confirm the Discord route.",
                  });
                const result = yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(DiscordValidation)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
                return [...result.guilds];
              }),
            releaseResponse,
          ),
        ),
        validateWebhookRoute: Effect.fn("ControlPlane.validateWebhookRoute")((hostId, routes) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/webhook-route/validate", { hostId, routes }),
            (response) =>
              Effect.gen(function* () {
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not confirm the webhook route.",
                  });
                const result = yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(WebhookValidation)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
                return [...result.routes];
              }),
            releaseResponse,
          ),
        ),
        reconcileDiscordGuilds: Effect.fn("ControlPlane.reconcileDiscordGuilds")((guildIds, before) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/discord-route/reconcile", { guilds: guildIds, before }),
            (response) =>
              response.ok
                ? Effect.void
                : Effect.fail(
                    new ControlPlaneError({ message: "The account service did not reconcile the Discord guilds." }),
                  ),
            releaseResponse,
          ),
        ),
        routeWake: Effect.fn("ControlPlane.routeWake")((route, wake) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/route-wake", { route, wake }, 30_000),
            (response) =>
              Effect.gen(function* () {
                if (response.status === 404) return { hostId: null, state: "not_hosted" as const };
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not answer the route wake.",
                  });
                return yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(RouteWakeAnswer)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
              }),
            releaseResponse,
          ),
        ),
        hostWake: Effect.fn("ControlPlane.hostWake")((hostId) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/host-wake", { hostId, wake: true }, HOST_WAKE_DEADLINE_MILLISECONDS),
            (response) =>
              Effect.gen(function* () {
                if (response.status === 404) return { hostId: null, state: "not_hosted" as const };
                if (!response.ok)
                  return yield* new ControlPlaneError({ message: "The account service did not answer the host wake." });
                return yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(RouteWakeAnswer)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
              }),
            releaseResponse,
          ),
        ),
        supportsRouteWake: Effect.fn("ControlPlane.supportsRouteWake")(() =>
          Effect.acquireUseRelease(
            ask("/v2/remote/route-wake", { route: { platform: "slack", appId: "A0", teamId: "T0" }, wake: false }),
            (response) => Effect.succeed(response.ok),
            releaseResponse,
          ).pipe(Effect.catch(() => Effect.succeed(false))),
        ),
        authEventsAfter: Effect.fn("ControlPlane.authEventsAfter")((cursor, timeoutMilliseconds) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/auth-events", { after: cursor, limit: AUTH_EVENT_PAGE_LIMIT }, timeoutMilliseconds),
            (response) =>
              Effect.gen(function* () {
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not return the auth events.",
                  });
                return yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(AuthEventPage)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
              }),
            releaseResponse,
          ),
        ),
        discordGuildRemoved: Effect.fn("ControlPlane.discordGuildRemoved")((guildId) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/discord-route/removed", { guildId }),
            (response) =>
              response.ok
                ? Effect.void
                : Effect.fail(
                    new ControlPlaneError({ message: "The account service did not unlink the Discord guild." }),
                  ),
            releaseResponse,
          ),
        ),
        validateTelegramRoute: Effect.fn("ControlPlane.validateTelegramRoute")((hostId, chats) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/telegram-route/validate", {
              hostId,
              chats: chats.map(({ id, botId, linkedAt }) => ({ id, botId, linkedAt })),
            }),
            (response) =>
              Effect.gen(function* () {
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not confirm the Telegram route.",
                  });
                const result = yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(TelegramValidation)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
                return [...result.chats];
              }),
            releaseResponse,
          ),
        ),
        linkTelegramChat: Effect.fn("ControlPlane.linkTelegramChat")((botId, chatId, code) =>
          Effect.acquireUseRelease(
            ask("/v2/remote/telegram-route/link", { botId, chatId, code }),
            (response) =>
              Effect.gen(function* () {
                if (response.status === 404 || response.status === 409) return null;
                if (!response.ok)
                  return yield* new ControlPlaneError({
                    message: "The account service did not link the Telegram chat.",
                  });
                const result = yield* readJson(response).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(TelegramLink)),
                  Effect.mapError(() => new ControlPlaneError({ message: "The account service response is invalid." })),
                );
                return { hostId: result.hostId, linkedAt: result.linkedAt };
              }),
            releaseResponse,
          ),
        ),
      });
    }),
  );
}

const controlPlane = ManagedRuntime.make(ControlPlane.layer);
const controlPlaneService = await controlPlane.runPromise(ControlPlane);
const tokens = new RemoteTokenService(
  config,
  (claims) =>
    controlPlaneService.validateResume(claims).pipe(
      Effect.mapError(
        (error) =>
          new RemoteTokenUnavailableError({
            message: error.message,
            hostId: claims.hostId,
            sessionId: claims.sessionId,
            role: claims.role,
            authEpoch: claims.authEpoch,
          }),
      ),
    ),
  {
    turnHost: (hostId) => turnRelays.pick(hostId),
    validateSlackRoute: (hostId, teams) =>
      controlPlaneService
        .validateSlackRoute(hostId, teams)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
    validateTelegramRoute: (hostId, chats) =>
      controlPlaneService
        .validateTelegramRoute(hostId, chats)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
    linkTelegramChat: (botId, chatId, code) =>
      controlPlaneService
        .linkTelegramChat(botId, chatId, code)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
    validateDiscordRoute: (hostId, guilds) =>
      controlPlaneService
        .validateDiscordRoute(hostId, guilds)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
    validateWebhookRoute: (hostId, routes) =>
      controlPlaneService
        .validateWebhookRoute(hostId, routes)
        .pipe(Effect.mapError((error) => new RemoteTokenError({ message: error.message }))),
  },
);
await controlPlane.runPromise(tokens.initialize());
const signal = new SignalService(
  tokens,
  config.maximumConnectionsPerUser,
  config.maximumConnectionsPerIp,
  config.maximumMessagesPerMinute,
  undefined,
  {
    discord: config.discord !== null,
    telegram: config.telegram
      ? { bot: new TelegramBotApi(config.telegram), files: new TelegramFileTokens(config.sessionSecret) }
      : null,
    routeWaker: (await controlPlane.runPromise(controlPlaneService.supportsRouteWake()))
      ? (route, wake) => controlPlaneService.routeWake(route, wake).pipe(Effect.catch(() => Effect.succeed(null)))
      : null,
    hostWaker: (hostId) => controlPlaneService.hostWake(hostId).pipe(Effect.catch(() => Effect.succeed(null))),
    fork: (work) => void signalRuntime.runFork(work),
    isEntry: () => entry.isEntry,
  },
);
const tlsPaths =
  config.tlsCertificatePath && config.tlsPrivateKeyPath
    ? { certificate: config.tlsCertificatePath, privateKey: config.tlsPrivateKeyPath }
    : undefined;

const signalRuntime = ManagedRuntime.make(signal.dependencies);
const discordConfig = config.discord;
if (!discordConfig) {
  console.log("OpenBot Discord is off: DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are not both set and valid.");
}
let discordApi: DiscordApi | null = null;
let discordGateway: DiscordGateway["Service"] | null = null;
let takeOverDiscord: (handoff: DiscordGatewayHandoff | null) => void = () => undefined;
let discordTakeover: Promise<DiscordGatewayHandoff | null> = Promise.resolve(null);
const discordWhileEntry: Effect.Effect<void> = discordConfig
  ? Effect.scoped(
      Effect.gen(function* () {
        const takeover = yield* Effect.promise(() => discordTakeover);
        discordTakeover = Promise.resolve(null);
        const services = yield* Layer.build(
          DiscordGateway.layer(
            discordConfig,
            signal,
            {
              removed: (guildId) => controlPlaneService.discordGuildRemoved(guildId),
              reconcile: (guildIds, before) => controlPlaneService.reconcileDiscordGuilds(guildIds, before),
            },
            takeover,
          ),
        );
        const gateway = Context.get(services, DiscordGateway);
        discordGateway = gateway;
        discordApi = gateway.api;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            discordApi = null;
            discordGateway = null;
          }),
        );
        return yield* Effect.never;
      }),
    )
  : Effect.void;
const startedAt = Date.now();
let lastAuthEventAt: number | null = null;
const stateDirectory = config.stateDirectory;
const servers = new Set<Server<unknown>>();
const statePayload = (): SignalStatePayload => {
  const cutoffs = signal.cutoffs;
  return {
    version: 1,
    signalId: config.signalId ?? "",
    writtenAt: Date.now(),
    lastAuthEventAt,
    ticketCutoff: cutoffs.ticket,
    routeCutoff: cutoffs.route,
    trusted: tokens.exportTrustedResumeTokens(),
    refusals: signal.exportRefusals(),
  };
};
const writeSnapshot = async () => {
  if (!stateDirectory) return;
  await controlPlane.runPromise(
    writeSnapshotFile(stateDirectory, sealSnapshot(statePayload(), config.sessionSecret)).pipe(
      Effect.catch(() => Effect.sync(() => console.error("OpenBot Signal could not write its state snapshot."))),
    ),
  );
};
const handoff = new SignalHandoff({
  healthPort: config.healthPort,
  mainPort: config.port,
  peerPort: config.handoffPeerPort,
  token: config.handoffToken,
  drainSeconds: config.drainSeconds,
  signal,
  tokens,
  runtime: signalRuntime,
  discordApi: () => discordApi,
  sealedState: () => sealSnapshot(statePayload(), config.sessionSecret),
  writeSnapshot,
  handle: (request) => app.handle(request),
  stopListening: () => {
    for (const server of servers) void server.stop(false);
  },
  discordHandOver: async () => (discordGateway ? Effect.runPromise(discordGateway.handOver) : null),
  discordTakeOver: (takeover) => takeOverDiscord(takeover),
  authEventApplied: () => {
    lastAuthEventAt = Date.now();
  },
  exit: () => shutdown(),
});
const healthServer = Bun.serve({
  hostname: config.healthHost,
  port: config.healthPort,
  routes: {
    "/health/live": () =>
      Response.json({
        service: "openbot-remote-api",
        status: "live",
        state: handoff.state,
        commit: config.sourceCommit,
      }),
    "/health/ready": () =>
      handoff.state === "ready"
        ? Response.json({ service: "openbot-remote-api", status: "ready", state: handoff.state })
        : Response.json({ service: "openbot-remote-api", status: "not_ready", state: handoff.state }, { status: 503 }),
    "/metrics": (request) => {
      const authorization = request.headers.get("Authorization") ?? "";
      if (!config.metricsToken || !sameSecret(authorization, `Bearer ${config.metricsToken}`))
        return new Response("Not found", { status: 404 });
      return new Response(prometheusMetrics(signal, turnRelays, entry), {
        headers: { "Content-Type": "text/plain; version=0.0.4" },
      });
    },
    ...handoff.routes(),
    "/admin/go-away": { POST: goAwayRoute(signal, config.adminToken) },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

const catchUpAuthEvents = async (since: number): Promise<boolean> => {
  const deadline = Date.now() + AUTH_EVENT_CATCH_UP_MILLISECONDS;
  let cursor: AuthEventCursor = {
    attemptedAt: Math.max(0, since - AUTH_EVENT_CATCH_UP_OVERLAP_MILLISECONDS),
    eventId: "",
  };
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const page = await controlPlane.runPromise(
      controlPlaneService.authEventsAfter(cursor, remaining).pipe(Effect.catch(() => Effect.succeed(null))),
    );
    if (!page) return false;
    for (const row of page.events) {
      const event = decodeAuthEvent(row.payload);
      if (event) applyAuthEvent(signal, event);
      cursor = { attemptedAt: row.attemptedAt, eventId: row.eventId };
    }
    if (page.events.length > 0) lastAuthEventAt = Date.now();
    if (!page.more) return true;
  }
};

const restoreState = async (): Promise<void> => {
  const joined = await handoff.join();
  if (joined.kind === "refused") {
    console.error("OpenBot Signal could not join the running Signal process. It stops.");
    process.exit(1);
  }
  if (joined.kind === "joined") {
    const opened = openSnapshot(joined.snapshot, config.sessionSecret, config.signalId ?? "", Date.now());
    if (!opened.ok) {
      console.error(`OpenBot Signal refused the state of the running process (${opened.reason}). It stops.`);
      process.exit(1);
    }
    discordTakeover = new Promise((resolve) => {
      takeOverDiscord = resolve;
    });
    if (!joined.discord) takeOverDiscord(null);
    handoff.link("old");
    signal.importRefusals(opened.payload.refusals);
    signal.setCutoffs({ ticket: opened.payload.ticketCutoff, route: opened.payload.routeCutoff });
    tokens.importTrustedResumeTokens(opened.payload.trusted, (token) => signal.refusesTrust(token));
    lastAuthEventAt = opened.payload.lastAuthEventAt;
    if (!(await catchUpAuthEvents(opened.payload.writtenAt)))
      console.error("OpenBot Signal could not read the recent auth events. The running process gave its state.");
    console.log("OpenBot Signal joined the running process and took its state.");
    return;
  }
  const sealed = stateDirectory ? await controlPlane.runPromise(readSnapshotFile(stateDirectory)) : null;
  if (!sealed) return;
  const opened = openSnapshot(sealed, config.sessionSecret, config.signalId ?? "", Date.now());
  if (!opened.ok) {
    console.error(`OpenBot Signal refused its state snapshot (${opened.reason}). Each session is checked again.`);
    return;
  }
  signal.importRefusals(opened.payload.refusals);
  if (!(await catchUpAuthEvents(opened.payload.writtenAt))) {
    console.error("OpenBot Signal could not read the recent auth events. Each session is checked again.");
    return;
  }
  tokens.importTrustedResumeTokens(opened.payload.trusted, (token) => signal.refusesTrust(token));
  signal.setCutoffs({
    ticket: signal.cutoffs.ticket,
    route: Math.min(signal.cutoffs.route, opened.payload.routeCutoff),
  });
  lastAuthEventAt = opened.payload.lastAuthEventAt;
  console.log("OpenBot Signal restored its state snapshot.");
};
await restoreState();

const setTelegramWebhooks = () => {
  if (signal.telegram) void signalRuntime.runPromise(signal.telegram.bot.setWebhooks());
};
const entryRuntime = ManagedRuntime.make(
  entry.watch({
    whileEntry: discordWhileEntry,
    changed: (isEntry) =>
      Effect.sync(() => {
        if (!isEntry) signal.closeEntrySockets();
        else setTelegramWebhooks();
      }),
  }),
);
await entryRuntime.runPromise(Effect.void);
const app = createRemoteApiApp(config, signal, signalRuntime, turnRelays, entry, () => discordApi, {
  handoff: handoff.app,
  authEventApplied: () => {
    lastAuthEventAt = Date.now();
  },
});
const listen = () => {
  app.listen({
    hostname: config.host,
    port: config.port,
    reusePort: true,
    ...(tlsPaths
      ? {
          tls: {
            cert: Bun.file(tlsPaths.certificate),
            key: Bun.file(tlsPaths.privateKey),
          },
        }
      : {}),
  });
  if (app.server) servers.add(app.server);
};
listen();
handoff.ready();
if (entry.isEntry && handoff.role === null) setTelegramWebhooks();
const snapshotTimer = stateDirectory ? setInterval(() => void writeSnapshot(), config.snapshotSeconds * 1_000) : null;
if (stateDirectory) void writeSnapshot();
console.log(`OpenBot Signal health is at http://${config.healthHost}:${healthServer.port} (${startedAt}).`);

const protocol = tlsPaths ? "https" : "http";
console.log(`OpenBot Remote API is ready at ${protocol}://${config.host}:${config.port}`);

const readCertificateFile = (path: string) =>
  Effect.tryPromise({
    try: (signal) => readFile(path, { signal }),
    catch: () => new ControlPlaneError({ message: "The TLS certificate could not be read." }),
  });

let certificateHash = await controlPlane.runPromise(tlsCertificateHash());
let pendingReload: Promise<void> | null = null;
let shuttingDown = false;
const certificateTimer = setInterval(() => void reloadTlsWhenChanged(), 5 * 60_000);

function reloadTlsWhenChanged(): Promise<void> {
  if (!tlsPaths || shuttingDown || handoff.state === "draining") return Promise.resolve();
  pendingReload ??= controlPlane
    .runPromise(reloadTlsEffect())
    .catch(() => {
      console.error("OpenBot Remote API could not reload its TLS certificate.");
    })
    .finally(() => {
      pendingReload = null;
    });
  return pendingReload;
}

const reloadTlsEffect = Effect.fn("Signal.reloadTls")(function* () {
  const nextHash = yield* tlsCertificateHash();
  if (shuttingDown || !nextHash || nextHash === certificateHash) return;
  if (handoff.state === "draining") return;
  const previous = app.server;
  yield* Effect.try({
    try: listen,
    catch: () => new ControlPlaneError({ message: "The Signal listener could not be restarted." }),
  });
  if (previous && previous !== app.server) {
    servers.delete(previous);
    void previous.stop(false);
  }
  certificateHash = nextHash;
  console.log("OpenBot Remote API reloaded its TLS certificate.");
});

function tlsCertificateHash(): Effect.Effect<string | null> {
  const certificatePath = config.tlsCertificatePath;
  const keyPath = config.tlsPrivateKeyPath;
  if (!certificatePath || !keyPath) return Effect.succeed(null);
  return Effect.all([readCertificateFile(certificatePath), readCertificateFile(keyPath)], { concurrency: 2 }).pipe(
    Effect.map(([certificate, key]) => createHash("sha256").update(certificate).update(key).digest("hex")),
    Effect.catch(() => Effect.succeed(null)),
  );
}

let pendingShutdown: Promise<void> | null = null;
function shutdown(): Promise<void> {
  shuttingDown = true;
  pendingShutdown ??= (async () => {
    clearInterval(certificateTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    handoff.close();
    healthServer.stop(true);
    await pendingReload;
    try {
      for (const server of servers) void server.stop(true);
      servers.clear();
      if (app.server) await app.stop(true);
    } finally {
      try {
        await entryRuntime.dispose();
        await signalRuntime.dispose();
        signal.close();
      } finally {
        await turnRuntime.dispose();
        await controlPlane.dispose();
      }
    }
    process.exit(0);
  })();
  return pendingShutdown;
}
const drainThenStop = () => {
  if (handoff.state === "starting") {
    void shutdown();
    return;
  }
  const bound = setTimeout(() => void shutdown(), config.drainSeconds * 1_000 + SIGTERM_DRAIN_SLACK_MILLISECONDS);
  bound.unref();
  void handoff.drain().catch(() => shutdown());
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", drainThenStop);
