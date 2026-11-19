// The OpenBot Discord bot's connections: the Gateway WebSocket (`@discordjs/ws`) and the REST client
// (`@discordjs/rest`). Under Bun, both use the global WebSocket and fetch. The bot token stays in
// this module and in the libraries; no log holds it, a payload, or Discord's error text.

import { DiscordAPIError, HTTPError, RateLimitError, REST, RequestMethod } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents, WebSocketShardStatus } from "@discordjs/ws";
import { DISCORD_GATEWAY_INTENTS, DISCORD_MESSAGE_CONTENT_INTENT } from "@openbot/contracts/discord-app";
import { GatewayCloseCodes } from "discord-api-types/v10";
import { Context, Effect, Fiber, FiberSet, Layer, Schedule, Schema } from "effect";
import type { DiscordBotConfig } from "./config";
import {
  type DiscordApi,
  type DiscordRestRequest,
  type DiscordTransport,
  DiscordTransportError,
  makeDiscordApi,
} from "./discord-api";
import { DISCORD_DIRECT_MESSAGE_REPLY, type DiscordAction, DiscordState } from "./discord-events";
import type { SignalService } from "./signal-service";

const DISCORD_REQUEST_TIMEOUT_MILLISECONDS = 10_000;
// A first connection that fails is tried again, after 5 seconds and then twice as long each time, at
// most every 5 minutes, until Signal stops.
const DISCORD_CONNECT_RETRY = Schedule.min([Schedule.exponential("5 seconds"), Schedule.spaced("5 minutes")]);
// How often Signal checks the shards of the Gateway. After a fatal close code (such as 4011 or 4013)
// the library leaves the shard idle and does not connect again, and the Discord API route works without
// the Gateway: hosts then show Discord as connected while no mention arrives. A shard that the library
// reconnects or resumes is idle for only 0.5 seconds, so the check does not take its session.
const DISCORD_HEALTH_INTERVAL = "1 minute";
// Checks in a row with an idle shard before a new connection replaces the Gateway. It doubles after
// each replacement that does not get ready, up to about 30 minutes, so that a token or an intent that
// Discord refuses does not use up the bot's daily session starts. A ready Gateway resets it.
const DISCORD_STOPPED_CHECKS = 2;
const DISCORD_STOPPED_CHECKS_LIMIT = 32;

class DiscordGatewayConnectError extends Schema.TaggedError<DiscordGatewayConnectError>()(
  "DiscordGatewayConnectError",
  {},
) {}
// How often Signal tells the account service which guilds the bot is in, so a link of a guild that
// the bot left goes also when every unlink before it failed.
const DISCORD_RECONCILE_INTERVAL = "30 minutes";
// A link this new is kept: its guild can be added on the Gateway after the snapshot.
const DISCORD_RECONCILE_GRACE_MILLISECONDS = 5 * 60_000;

/** What Signal tells the account service about the bot's guilds. */
export interface DiscordLinks {
  /** The bot left the guild: unlink it at once. */
  removed(guildId: string): Effect.Effect<void, { readonly message: string }>;
  /** The bot is in these guilds: unlink every other guild linked before `before`. */
  reconcile(guildIds: string[], before: number): Effect.Effect<void, { readonly message: string }>;
}
const METHODS: Record<DiscordRestRequest["method"], RequestMethod> = {
  GET: RequestMethod.Get,
  POST: RequestMethod.Post,
  PATCH: RequestMethod.Patch,
  PUT: RequestMethod.Put,
  DELETE: RequestMethod.Delete,
};

function transportError(error: unknown): DiscordTransportError {
  if (error instanceof RateLimitError)
    return new DiscordTransportError({ status: 429, retryAfterMs: error.retryAfter });
  if (error instanceof DiscordAPIError || error instanceof HTTPError)
    return new DiscordTransportError({ status: error.status });
  return new DiscordTransportError({ status: 0 });
}

/** The REST client of the bot, with Signal's deadline and no wait for a Discord rate limit. */
function makeDiscordRestTransport(rest: REST): DiscordTransport {
  return {
    request: Effect.fn("DiscordRest.request")((input: DiscordRestRequest) =>
      Effect.tryPromise({
        try: (signal) =>
          rest.request({
            method: METHODS[input.method],
            fullRoute: input.route,
            ...(input.query ? { query: input.query } : {}),
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(input.files
              ? {
                  files: input.files.map((file) => ({
                    name: file.name,
                    data: file.data,
                    ...(file.contentType ? { contentType: file.contentType } : {}),
                  })),
                }
              : {}),
            auth: input.auth ?? true,
            signal: AbortSignal.any([signal, AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MILLISECONDS)]),
          }),
        catch: transportError,
      }),
    ),
  };
}

export class DiscordGateway extends Context.Service<DiscordGateway, { readonly api: DiscordApi }>()(
  "@openbot/remote-api/DiscordGateway",
) {
  /** Connects the bot. The scope's finalizer closes the Gateway connection. */
  static layer(config: DiscordBotConfig, signal: SignalService, links: DiscordLinks) {
    return Layer.effect(
      DiscordGateway,
      Effect.gen(function* () {
        const rest = new REST({
          timeout: DISCORD_REQUEST_TIMEOUT_MILLISECONDS,
          retries: 0,
          // A host gets `rate_limited` with the wait, rather than a request that waits here.
          rejectOnRateLimit: () => true,
        }).setToken(config.botToken);
        const transport = makeDiscordRestTransport(rest);
        const state = new DiscordState(config.applicationId);
        const run = yield* FiberSet.makeRuntime<never>();
        // The guilds whose unlink is on its way, so that hosts that connect meanwhile do not repeat it.
        const unlinking = new Set<string>();

        /**
         * Drops the route of a guild that the bot left and unlinks it in the account service. A failed
         * unlink is recovered by the next reconcile.
         */
        const left = (guildId: string) => {
          signal.revokeDiscordRoute(guildId, Date.now());
          if (unlinking.has(guildId)) return;
          unlinking.add(guildId);
          run(
            links.removed(guildId).pipe(
              Effect.catch(() => Effect.sync(() => console.error("OpenBot Discord could not unlink a removed guild."))),
              Effect.ensuring(Effect.sync(() => unlinking.delete(guildId))),
            ),
          );
        };
        signal.setDiscordMembership({ isMember: (guildId) => state.isMember(guildId), left });
        yield* Effect.addFinalizer(() => Effect.sync(() => signal.setDiscordMembership(null)));

        /** Sends the guilds that the bot is in. Nothing happens before every shard is ready. */
        const reconcile = Effect.suspend(() => {
          const guildIds = state.memberGuildIds();
          return guildIds === null
            ? Effect.void
            : links
                .reconcile(guildIds, Date.now() - DISCORD_RECONCILE_GRACE_MILLISECONDS)
                .pipe(
                  Effect.catch(() =>
                    Effect.sync(() => console.error("OpenBot Discord could not reconcile the guild links.")),
                  ),
                );
        });
        run(reconcile.pipe(Effect.delay(DISCORD_RECONCILE_INTERVAL), Effect.forever));

        const act = (action: DiscordAction) => {
          if (action.type === "deliver") {
            signal.deliverDiscord(action.guildId, action.delivery);
            // The bot left the guild. The route goes now, and the account service unlinks the guild,
            // also when its host is offline and does not receive the delivery above.
            if (action.delivery.kind === "removed") left(action.guildId);
            return;
          }
          if (action.type === "reconcile") {
            run(reconcile);
            return;
          }
          const call =
            action.type === "acknowledge"
              ? transport.request({
                  method: "POST",
                  route: `/interactions/${action.interactionId}/${action.interactionToken}/callback`,
                  auth: false,
                  body: { type: 6 },
                })
              : transport.request({
                  method: "POST",
                  route: `/channels/${action.channelId}/messages`,
                  body: { content: DISCORD_DIRECT_MESSAGE_REPLY, allowed_mentions: { parse: [] } },
                });
          run(
            call.pipe(
              Effect.catch((error) =>
                Effect.sync(() => console.error(`OpenBot Discord ${action.type} failed with status ${error.status}.`)),
              ),
            ),
          );
        };

        /**
         * Connects a manager, and tries again until Signal stops or a new manager replaces it. After that,
         * the library reconnects by itself, except after a fatal close code: the health check below
         * replaces the manager then. A first connection that gets a fatal close never settles, so
         * `replace` interrupts this fiber.
         */
        const connect = (gateway: WebSocketManager) =>
          run(
            Effect.suspend(() =>
              current === gateway
                ? Effect.tryPromise({
                    try: () => {
                      const connected = gateway.connect();
                      // A manager destroyed during its REST call still spawns and connects its shards.
                      void connected.then(
                        () => (current === gateway ? undefined : run(release(gateway))),
                        () => undefined,
                      );
                      return connected;
                    },
                    catch: () => new DiscordGatewayConnectError(),
                  })
                : Effect.void,
            ).pipe(
              Effect.tapError(() => Effect.sync(() => console.error("OpenBot Discord Gateway could not connect."))),
              Effect.retry(DISCORD_CONNECT_RETRY),
              Effect.ignore,
            ),
          );
        const release = (gateway: WebSocketManager) =>
          Effect.tryPromise({ try: async () => gateway.destroy(), catch: () => undefined }).pipe(
            Effect.catch(() => Effect.void),
            Effect.ensuring(Effect.sync(() => gateway.removeAllListeners())),
          );

        const open = (intents: number): WebSocketManager => {
          const gateway = new WebSocketManager({ token: config.botToken, intents, rest });
          // A replaced manager no longer changes the state: its shard IDs are also the new manager's.
          gateway.on(WebSocketShardEvents.Dispatch, (payload) => {
            if (current !== gateway) return;
            let actions: DiscordAction[];
            try {
              actions = state.handle(payload);
            } catch {
              // The event name only: the payload can hold a message.
              console.error(`OpenBot Discord could not read a ${payload.t} event.`);
              return;
            }
            // The acknowledgement goes first: Discord waits 3 seconds for it.
            for (const action of actions) act(action);
          });
          gateway.on(WebSocketShardEvents.Ready, () => console.log("OpenBot Discord Gateway is ready."));
          gateway.on(WebSocketShardEvents.Resumed, (shardId) => {
            if (current !== gateway) return;
            console.log("OpenBot Discord Gateway resumed.");
            for (const action of state.shardResumed(shardId)) act(action);
          });
          gateway.on(WebSocketShardEvents.Closed, (code, shardId) => {
            if (current !== gateway) return;
            // Until the shard resumes or is ready again, its guild list can be stale: a reconcile with
            // it could unlink a guild that installed the bot meanwhile.
            state.shardClosed(shardId);
            console.log(`OpenBot Discord Gateway closed with code ${code}.`);
            // The library does not reconnect after a refused intent. Without the Message Content
            // intent in the Developer Portal, the bot connects without it.
            if (code === GatewayCloseCodes.DisallowedIntents && intents !== DISCORD_GATEWAY_INTENTS) {
              console.error("OpenBot Discord Gateway refused the Message Content intent. It connects without it.");
              replace(DISCORD_GATEWAY_INTENTS);
            }
          });
          gateway.on(WebSocketShardEvents.Error, () => console.error("OpenBot Discord Gateway failed."));
          return gateway;
        };

        /** A new connection in place of the Gateway. A new manager also asks Discord for the shard count again. */
        const replace = (intents: number) => {
          const previous = current;
          run(Fiber.interrupt(connecting));
          currentIntents = intents;
          stopped = 0;
          current = open(intents);
          run(release(previous));
          connecting = connect(current);
        };

        let currentIntents = config.messageContent
          ? DISCORD_GATEWAY_INTENTS | DISCORD_MESSAGE_CONTENT_INTENT
          : DISCORD_GATEWAY_INTENTS;
        let current = open(currentIntents);
        yield* Effect.addFinalizer(() => Effect.suspend(() => release(current)));
        // Signal starts without waiting for Discord. The fibers end with the runtime, which stops the retries.
        let connecting = connect(current);

        let stopped = 0;
        let stoppedLimit = DISCORD_STOPPED_CHECKS;
        const check = Effect.suspend(() => {
          const gateway = current;
          return Effect.tryPromise(async () => gateway.fetchStatus()).pipe(
            Effect.flatMap((shards) =>
              Effect.sync(() => {
                // No shards yet: the connect fiber still asks Discord for the shard count.
                if (gateway !== current || shards.size === 0) return;
                if (!shards.some((status) => status === WebSocketShardStatus.Idle)) {
                  stopped = 0;
                  if (shards.every((status) => status === WebSocketShardStatus.Ready))
                    stoppedLimit = DISCORD_STOPPED_CHECKS;
                  return;
                }
                stopped += 1;
                if (stopped < stoppedLimit) return;
                stoppedLimit = Math.min(stoppedLimit * 2, DISCORD_STOPPED_CHECKS_LIMIT);
                console.error("OpenBot Discord Gateway stopped. It connects again.");
                replace(currentIntents);
              }),
            ),
            Effect.catch(() => Effect.void),
          );
        });
        run(check.pipe(Effect.delay(DISCORD_HEALTH_INTERVAL), Effect.forever));
        return DiscordGateway.of({ api: makeDiscordApi(transport, state) });
      }),
    );
  }
}
