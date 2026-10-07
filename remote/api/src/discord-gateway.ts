// The OpenBot Discord bot's connections: the Gateway WebSocket (`@discordjs/ws`) and the REST client
// (`@discordjs/rest`). Under Bun, both use the global WebSocket and fetch. The bot token stays in
// this module and in the libraries; no log holds it, a payload, or Discord's error text.

import { DiscordAPIError, HTTPError, RateLimitError, REST, RequestMethod } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents } from "@discordjs/ws";
import { DISCORD_GATEWAY_INTENTS } from "@openbot/contracts/discord-app";
import { Context, Effect, FiberSet, Layer } from "effect";
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

        const manager = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const gateway = new WebSocketManager({ token: config.botToken, intents: DISCORD_GATEWAY_INTENTS, rest });
            gateway.on(WebSocketShardEvents.Dispatch, (payload) => {
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
              console.log("OpenBot Discord Gateway resumed.");
              for (const action of state.shardResumed(shardId)) act(action);
            });
            gateway.on(WebSocketShardEvents.Closed, (code, shardId) => {
              // Until the shard resumes or is ready again, its guild list can be stale: a reconcile with
              // it could unlink a guild that installed the bot meanwhile.
              state.shardClosed(shardId);
              console.log(`OpenBot Discord Gateway closed with code ${code}.`);
            });
            gateway.on(WebSocketShardEvents.Error, () => console.error("OpenBot Discord Gateway failed."));
            return gateway;
          }),
          (gateway) =>
            Effect.tryPromise({ try: async () => gateway.destroy(), catch: () => undefined }).pipe(
              Effect.catch(() => Effect.void),
              Effect.ensuring(Effect.sync(() => gateway.removeAllListeners())),
            ),
        );
        // Signal starts without waiting for Discord; the library reconnects by itself after it connects.
        run(
          Effect.tryPromise({ try: () => manager.connect(), catch: () => undefined }).pipe(
            Effect.catch(() => Effect.sync(() => console.error("OpenBot Discord Gateway could not connect."))),
          ),
        );
        return DiscordGateway.of({ api: makeDiscordApi(transport, state) });
      }),
    );
  }
}
