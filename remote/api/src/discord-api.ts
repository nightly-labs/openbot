// The Discord calls that Signal makes for a host with the bot token. `app.ts` authorizes the
// caller for the guild; this module validates the request, checks that each channel is in that
// guild, and makes the call. No response or log holds Discord's error text or a message's content.

import {
  DISCORD_CUSTOM_ID_PREFIX,
  DISCORD_LIST_CHANNELS_LIMIT,
  DISCORD_LIST_MESSAGES_LIMIT,
  DISCORD_MESSAGE_TEXT_LIMIT,
  DISCORD_ROLES_LIMIT,
  type DiscordApiErrorCode,
  type DiscordApiRequest,
  type DiscordButton,
  type DiscordChannelSummary,
  type DiscordHistoryMessage,
  type DiscordRoleSummary,
} from "@openbot/contracts/signal-protocol/discord-api";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { type DiscordState, discordAuthorName, messageBody } from "./discord-events";

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
  z.strictObject({ op: z.literal("listChannels"), guildId: snowflakeSchema }),
  z.strictObject({ op: z.literal("listRoles"), guildId: snowflakeSchema }),
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
class DiscordApiFailure extends Schema.TaggedError<DiscordApiFailure>()("DiscordApiFailure", {
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
  | { channels: DiscordChannelSummary[] }
  | { roles: DiscordRoleSummary[] }
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
const permissionsSchema = z.string().regex(/^[0-9]{1,30}$/u);
const overwriteSchema = z.object({
  id: snowflakeSchema,
  type: z.number().int(),
  allow: permissionsSchema,
  deny: permissionsSchema,
});
const guildChannelsSchema = z.array(
  z.object({
    id: snowflakeSchema,
    type: z.number().int(),
    name: z.string().nullish(),
    permission_overwrites: z.array(overwriteSchema).optional(),
  }),
);
const activeThreadsSchema = z.object({
  threads: z.array(
    z.object({
      id: snowflakeSchema,
      type: z.number().int(),
      parent_id: snowflakeSchema.nullish(),
      name: z.string().nullish(),
    }),
  ),
  // One entry for each returned thread that the bot has joined.
  members: z.array(z.object({ id: snowflakeSchema.optional() })).optional(),
});
const rolesSchema = z.array(z.object({ id: snowflakeSchema, permissions: permissionsSchema }));
const namedRolesSchema = z.array(
  z.object({
    id: snowflakeSchema,
    name: z.string(),
    position: z.number().int(),
    managed: z.boolean().optional(),
  }),
);
const botMemberSchema = z.object({ roles: z.array(snowflakeSchema) });
/** Text and announcement channels: the guild channels that take a message. */
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);
const PRIVATE_THREAD_TYPE = 12;
const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
const userSchema = z.object({
  id: snowflakeSchema,
  username: z.string(),
  global_name: z.string().nullish(),
  bot: z.boolean().optional(),
});
const memberSchema = z.object({ nick: z.string().nullish(), user: userSchema });
const historyAttachmentsSchema = z
  .array(
    z.object({
      id: snowflakeSchema,
      filename: z.string(),
      content_type: z.string().optional(),
      size: z.number().int().nonnegative(),
      url: z.string(),
    }),
  )
  .optional();
const historySchema = z
  .array(
    z.object({
      id: snowflakeSchema,
      content: z.string(),
      timestamp: z.string(),
      author: userSchema,
      member: z.object({ nick: z.string().nullish() }).optional(),
      message_reference: z
        .object({ type: z.number().int().optional(), message_id: snowflakeSchema.optional() })
        .optional(),
      attachments: historyAttachmentsSchema,
      // The forwarded message of a forward.
      message_snapshots: z
        .array(
          z.object({ message: z.object({ content: z.string().optional(), attachments: historyAttachmentsSchema }) }),
        )
        .optional(),
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
            .map((message) => {
              const body = messageBody(message, botUserId);
              return {
                id: message.id,
                authorId: message.author.id,
                authorName: discordAuthorName(message),
                authorIsBot: message.author.bot === true,
                // A forward refers to the message it copies, which it does not reply to.
                replyToId: body.forwarded ? null : (message.message_reference?.message_id ?? null),
                sentAt: message.timestamp,
                ...body,
              };
            })
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
      // Discord gives every channel of the guild, hidden ones too. Only the channels and threads that
      // the bot can view and post in are listed, so a hidden channel's name does not reach the host.
      case "listChannels": {
        const guild = `/guilds/${request.guildId}` as const;
        const botId = state.botUserId ?? state.applicationId;
        const roles = yield* send({ method: "GET", route: `${guild}/roles` }).pipe(
          Effect.flatMap((value) => decode(rolesSchema, value)),
        );
        const bot = yield* send({ method: "GET", route: `${guild}/members/${botId}` }).pipe(
          Effect.flatMap((value) => decode(botMemberSchema, value)),
        );
        const guildChannels = yield* send({ method: "GET", route: `${guild}/channels` }).pipe(
          Effect.flatMap((value) => decode(guildChannelsSchema, value)),
        );
        const active = yield* send({ method: "GET", route: `${guild}/threads/active` }).pipe(
          Effect.flatMap((value) => decode(activeThreadsSchema, value)),
        );
        const memberRoles = new Set(bot.roles);
        const rolePermissions = new Map(roles.map((role) => [role.id, BigInt(role.permissions)]));
        let base = rolePermissions.get(request.guildId) ?? 0n;
        for (const role of memberRoles) base |= rolePermissions.get(role) ?? 0n;
        const permissions = new Map(
          guildChannels.map((channel) => [
            channel.id,
            channelPermissions(base, channel.permission_overwrites ?? [], request.guildId, memberRoles, botId),
          ]),
        );
        const can = (channelId: string | null | undefined, needed: bigint) =>
          channelId != null && ((permissions.get(channelId) ?? 0n) & needed) === needed;
        const joined = new Set((active.members ?? []).flatMap((member) => (member.id ? [member.id] : [])));
        const channels: DiscordChannelSummary[] = [
          ...guildChannels
            .filter(
              (channel) => POSTABLE_CHANNEL_TYPES.has(channel.type) && can(channel.id, VIEW_CHANNEL | SEND_MESSAGES),
            )
            .map((channel) => ({ id: channel.id, name: channel.name ?? "", kind: "channel" as const })),
          ...active.threads
            .filter(
              (thread) =>
                can(thread.parent_id, VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS) &&
                (thread.type !== PRIVATE_THREAD_TYPE || joined.has(thread.id)),
            )
            .map((thread) => ({ id: thread.id, name: thread.name ?? "", kind: "thread" as const })),
        ].slice(0, DISCORD_LIST_CHANNELS_LIMIT);
        for (const channel of channels) state.rememberChannel(channel.id, request.guildId, channel.name);
        return { channels };
      }
      // The roles a person can have: not `@everyone`, whose id is the guild's, and not a role that a
      // bot or integration manages.
      case "listRoles": {
        const roles = yield* send({ method: "GET", route: `/guilds/${request.guildId}/roles` }).pipe(
          Effect.flatMap((value) => decode(namedRolesSchema, value)),
        );
        return {
          roles: roles
            .filter((role) => role.id !== request.guildId && role.managed !== true)
            .sort((left, right) => right.position - left.position)
            .slice(0, DISCORD_ROLES_LIMIT)
            .map((role) => ({ id: role.id, name: role.name })),
        };
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

/**
 * The bot's permissions in one channel, as Discord computes them: the guild permissions, then the
 * `@everyone` overwrite, the overwrites of the bot's roles, and the bot's own overwrite.
 */
function channelPermissions(
  base: bigint,
  overwrites: readonly z.infer<typeof overwriteSchema>[],
  guildId: string,
  memberRoles: ReadonlySet<string>,
  botId: string,
): bigint {
  if ((base & ADMINISTRATOR) === ADMINISTRATOR) return VIEW_CHANNEL | SEND_MESSAGES | SEND_MESSAGES_IN_THREADS;
  let permissions = base;
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId);
  if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const overwrite of overwrites)
    if (overwrite.type === 0 && overwrite.id !== guildId && memberRoles.has(overwrite.id)) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  permissions = (permissions & ~deny) | allow;
  const own = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === botId);
  if (own) permissions = (permissions & ~BigInt(own.deny)) | BigInt(own.allow);
  return permissions;
}

function compareSnowflakes(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
