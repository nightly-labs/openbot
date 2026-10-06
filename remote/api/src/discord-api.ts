// The Discord calls that Signal makes for a host with the bot token. `app.ts` authorizes the
// caller for the guild; this module validates the request, checks that each channel is in that
// guild, and makes the call. No response or log holds Discord's error text or a message's content.

import {
  DISCORD_CUSTOM_ID_PREFIX,
  DISCORD_LIST_MESSAGES_LIMIT,
  DISCORD_MESSAGE_TEXT_LIMIT,
  type DiscordApiErrorCode,
  type DiscordApiRequest,
  type DiscordButton,
  type DiscordHistoryMessage,
} from "@openbot/contracts/signal-protocol/discord-api";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { type DiscordState, discordAuthorName, stripBotMention } from "./discord-events";

const snowflakeSchema = z.string().regex(/^[0-9]{1,20}$/u);
const contentSchema = z.string().min(1).max(DISCORD_MESSAGE_TEXT_LIMIT);
const buttonSchema = z.strictObject({
  customId: z.string().max(100).startsWith(DISCORD_CUSTOM_ID_PREFIX),
  label: z.string().min(1).max(80),
  style: z.enum(["primary", "secondary", "success", "danger"]),
});
const buttonsSchema = z.array(buttonSchema).max(5);

const discordApiRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("createMessage"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    content: contentSchema,
    replyTo: snowflakeSchema.nullable(),
    buttons: buttonsSchema,
  }),
  z.strictObject({
    op: z.literal("editMessage"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    messageId: snowflakeSchema,
    content: contentSchema,
    buttons: buttonsSchema,
  }),
  z.strictObject({
    op: z.literal("deleteMessage"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    messageId: snowflakeSchema,
  }),
  z.strictObject({
    op: z.literal("react"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    messageId: snowflakeSchema,
    emoji: z.string().min(1).max(64),
    on: z.boolean(),
  }),
  z.strictObject({
    op: z.literal("listMessages"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    after: snowflakeSchema,
    limit: z.number().int().min(1).max(DISCORD_LIST_MESSAGES_LIMIT),
  }),
  z.strictObject({ op: z.literal("member"), guildId: snowflakeSchema, userId: snowflakeSchema }),
  z.strictObject({ op: z.literal("channel"), guildId: snowflakeSchema, channelId: snowflakeSchema }),
  z.strictObject({
    op: z.literal("interactionReply"),
    guildId: snowflakeSchema,
    interactionId: snowflakeSchema,
    content: contentSchema,
  }),
  z.strictObject({
    op: z.literal("upload"),
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    replyTo: snowflakeSchema.nullable(),
    // No path separator and no control character.
    filename: z.string().regex(/^[^/\\\p{Cc}]{1,200}$/u),
  }),
]) satisfies z.ZodType<DiscordApiRequest>;

/** The request of a call, or null when it does not match the contract. */
export function decodeDiscordApiRequest(value: unknown): DiscordApiRequest | null {
  const parsed = discordApiRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface DiscordUpload {
  name: string;
  data: Uint8Array;
  contentType: string | null;
}

export interface DiscordRestRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  route: `/${string}`;
  query?: URLSearchParams;
  body?: unknown;
  files?: DiscordUpload[];
  /** False for the interaction routes, which the interaction token authorizes. */
  auth?: boolean;
}

/** A Discord call that failed. `status` is 0 when Discord did not answer in time. */
export class DiscordTransportError extends Schema.TaggedError<DiscordTransportError>()("DiscordTransportError", {
  status: Schema.Number,
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

/** The bot's Discord REST client. Tests replace it with a fake. */
export interface DiscordTransport {
  request(input: DiscordRestRequest): Effect.Effect<unknown, DiscordTransportError>;
}

/** A refused or failed call, as the host receives it. */
export class DiscordApiFailure extends Schema.TaggedError<DiscordApiFailure>()("DiscordApiFailure", {
  status: Schema.Number,
  code: Schema.Literals([
    "unauthorized",
    "invalid_request",
    "unknown_guild",
    "forbidden",
    "not_found",
    "rate_limited",
    "discord_failed",
    "unavailable",
  ]),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

type DiscordApiResult =
  | { messageId: string }
  | { name: string }
  | { messages: DiscordHistoryMessage[] }
  | Record<string, never>;

export interface DiscordApi {
  call(request: DiscordApiRequest, file: DiscordUpload | null): Effect.Effect<DiscordApiResult, DiscordApiFailure>;
}

const createdMessageSchema = z.object({ id: snowflakeSchema });
const channelSchema = z.object({
  id: snowflakeSchema,
  guild_id: snowflakeSchema.optional(),
  name: z.string().nullish(),
});
const userSchema = z.object({
  id: snowflakeSchema,
  username: z.string(),
  global_name: z.string().nullish(),
  bot: z.boolean().optional(),
});
const memberSchema = z.object({ nick: z.string().nullish(), user: userSchema });
const historySchema = z
  .array(
    z.object({
      id: snowflakeSchema,
      content: z.string(),
      timestamp: z.string(),
      author: userSchema,
      member: z.object({ nick: z.string().nullish() }).optional(),
      message_reference: z.object({ message_id: snowflakeSchema.optional() }).optional(),
    }),
  )
  .max(DISCORD_LIST_MESSAGES_LIMIT);

const BUTTON_STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;
// No post can ping anyone: not a user, a role, `@everyone`, or the author of the replied message.
const NO_MENTIONS = { parse: [], replied_user: false };

function failure(status: number, code: DiscordApiErrorCode, retryAfterMs?: number): DiscordApiFailure {
  return new DiscordApiFailure(retryAfterMs === undefined ? { status, code } : { status, code, retryAfterMs });
}

function fromTransport(error: DiscordTransportError): DiscordApiFailure {
  if (error.status === 429) return failure(429, "rate_limited", Math.max(0, Math.ceil(error.retryAfterMs ?? 1_000)));
  if (error.status === 400) return failure(400, "invalid_request");
  if (error.status === 403) return failure(403, "forbidden");
  if (error.status === 404) return failure(404, "not_found");
  return failure(502, "discord_failed");
}

function components(buttons: DiscordButton[]) {
  return buttons.length === 0
    ? []
    : [
        {
          type: 1,
          components: buttons.map((button) => ({
            type: 2,
            custom_id: button.customId,
            label: button.label,
            style: BUTTON_STYLES[button.style],
          })),
        },
      ];
}

function messageReference(replyTo: string | null) {
  return replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {};
}

function decode<A>(schema: z.ZodType<A>, value: unknown): Effect.Effect<A, DiscordApiFailure> {
  const parsed = schema.safeParse(value);
  return parsed.success ? Effect.succeed(parsed.data) : Effect.fail(failure(502, "discord_failed"));
}

export function makeDiscordApi(transport: DiscordTransport, state: DiscordState): DiscordApi {
  const send = (input: DiscordRestRequest) => transport.request(input).pipe(Effect.mapError(fromTransport));

  /** The channel, when it is in the guild. A channel that the Gateway did not show is fetched once. */
  const guildChannel = Effect.fn("DiscordApi.guildChannel")(function* (guildId: string, channelId: string) {
    const known = state.channel(channelId);
    if (known) {
      if (known.guildId !== guildId) return yield* failure(403, "forbidden");
      return known;
    }
    const fetched = yield* transport.request({ method: "GET", route: `/channels/${channelId}` }).pipe(
      Effect.mapError((error) =>
        error.status === 403 || error.status === 404 ? failure(403, "forbidden") : fromTransport(error),
      ),
      Effect.flatMap((value) => decode(channelSchema, value)),
    );
    if (fetched.guild_id !== guildId) return yield* failure(403, "forbidden");
    const channel = { guildId, name: fetched.name ?? "" };
    state.rememberChannel(channelId, guildId, channel.name);
    return channel;
  });

  const call = Effect.fn("DiscordApi.call")(function* (
    request: DiscordApiRequest,
    file: DiscordUpload | null,
  ): Effect.fn.Return<DiscordApiResult, DiscordApiFailure> {
    switch (request.op) {
      case "createMessage": {
        yield* guildChannel(request.guildId, request.channelId);
        const created = yield* send({
          method: "POST",
          route: `/channels/${request.channelId}/messages`,
          body: {
            content: request.content,
            allowed_mentions: NO_MENTIONS,
            ...messageReference(request.replyTo),
            components: components(request.buttons),
          },
        }).pipe(Effect.flatMap((value) => decode(createdMessageSchema, value)));
        return { messageId: created.id };
      }
      case "editMessage":
        yield* guildChannel(request.guildId, request.channelId);
        yield* send({
          method: "PATCH",
          route: `/channels/${request.channelId}/messages/${request.messageId}`,
          body: { content: request.content, allowed_mentions: NO_MENTIONS, components: components(request.buttons) },
        });
        return {};
      case "deleteMessage":
        yield* guildChannel(request.guildId, request.channelId);
        yield* send({ method: "DELETE", route: `/channels/${request.channelId}/messages/${request.messageId}` });
        return {};
      case "react":
        yield* guildChannel(request.guildId, request.channelId);
        yield* send({
          method: request.on ? "PUT" : "DELETE",
          route: `/channels/${request.channelId}/messages/${request.messageId}/reactions/${encodeURIComponent(request.emoji)}/@me`,
        });
        return {};
      case "listMessages": {
        yield* guildChannel(request.guildId, request.channelId);
        const messages = yield* send({
          method: "GET",
          route: `/channels/${request.channelId}/messages`,
          query: new URLSearchParams({ after: request.after, limit: String(request.limit) }),
        }).pipe(Effect.flatMap((value) => decode(historySchema, value)));
        const botUserId = state.botUserId;
        return {
          messages: messages
            .map((message) => ({
              id: message.id,
              authorId: message.author.id,
              authorName: discordAuthorName(message),
              authorIsBot: message.author.bot === true,
              content: stripBotMention(message.content, botUserId),
              replyToId: message.message_reference?.message_id ?? null,
              sentAt: message.timestamp,
            }))
            .sort((left, right) => compareSnowflakes(left.id, right.id)),
        };
      }
      case "member": {
        const member = yield* send({
          method: "GET",
          route: `/guilds/${request.guildId}/members/${request.userId}`,
        }).pipe(Effect.flatMap((value) => decode(memberSchema, value)));
        return { name: member.nick ?? member.user.global_name ?? member.user.username };
      }
      case "channel": {
        const channel = yield* guildChannel(request.guildId, request.channelId);
        return { name: channel.name };
      }
      case "interactionReply": {
        const token = state.interactionToken(request.interactionId, request.guildId);
        if (!token) return yield* failure(404, "not_found");
        yield* send({
          method: "POST",
          route: `/webhooks/${state.applicationId}/${token}`,
          auth: false,
          body: { content: request.content, flags: 64, allowed_mentions: { parse: [] } },
        });
        return {};
      }
      case "upload": {
        if (!file) return yield* failure(400, "invalid_request");
        yield* guildChannel(request.guildId, request.channelId);
        const created = yield* send({
          method: "POST",
          route: `/channels/${request.channelId}/messages`,
          body: { allowed_mentions: NO_MENTIONS, ...messageReference(request.replyTo) },
          files: [{ ...file, name: request.filename }],
        }).pipe(Effect.flatMap((value) => decode(createdMessageSchema, value)));
        return { messageId: created.id };
      }
    }
  });

  return { call };
}

function compareSnowflakes(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
