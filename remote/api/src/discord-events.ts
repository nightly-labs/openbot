// What Signal keeps from the OpenBot Discord bot's Gateway, and how it turns a Gateway event into a
// delivery for a host. Everything here is pure and in memory: the Gateway adapter
// (`./discord-gateway.ts`) gives it the events and does the actions it returns.
//
// Signal keeps only the names and the channel-to-guild map of the guilds that the bot is in, and
// the pending button presses. It keeps no message.

import {
  DISCORD_ATTACHMENTS_LIMIT,
  DISCORD_CUSTOM_ID_PREFIX,
  type DiscordDelivery,
  type DiscordInboundAttachment,
  type DiscordInboundInteraction,
  type DiscordInboundMessage,
} from "@openbot/contracts/signal-protocol/discord-api";
import {
  GatewayDispatchEvents,
  type GatewayDispatchPayload,
  InteractionType,
  MessageReferenceType,
} from "discord-api-types/v10";

/** The text of the one reply to a direct message. */
export const DISCORD_DIRECT_MESSAGE_REPLY = "OpenBot answers in Discord servers. Mention @OpenBot in a server channel.";

/** Discord accepts follow-ups with an interaction token for 15 minutes. */
const INTERACTION_TOKEN_TTL_MILLISECONDS = 15 * 60_000;
const MAXIMUM_INTERACTIONS = 10_000;
const DIRECT_REPLY_INTERVAL_MILLISECONDS = 60 * 60_000;
const MAXIMUM_DIRECT_REPLIES = 10_000;
const ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/** The fields of a Gateway or REST message that Signal reads. */
export interface DiscordMessageData {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  timestamp: string;
  webhook_id?: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  member?: { nick?: string | null };
  mentions: { id: string }[];
  message_reference?: { type?: number; message_id?: string };
  referenced_message?: { id: string; author: { id: string }; message_reference?: { message_id?: string } } | null;
  attachments: { id: string; filename: string; content_type?: string; size: number; url: string }[];
}

/** What the Gateway adapter does for one event. */
export type DiscordAction =
  | { type: "deliver"; guildId: string; delivery: DiscordDelivery }
  // Acknowledge a button press at once, as a deferred update: Discord waits 3 seconds.
  | { type: "acknowledge"; interactionId: string; interactionToken: string }
  | { type: "direct-reply"; channelId: string }
  // The Gateway listed every guild of the bot: the account service drops the links of the others.
  | { type: "reconcile" };

interface StoredInteraction {
  token: string;
  guildId: string;
  expiresAt: number;
}

/** The display name of a message author: the guild nickname, the global name, or the user name. */
export function discordAuthorName(message: Pick<DiscordMessageData, "author" | "member">): string {
  return message.member?.nick ?? message.author.global_name ?? message.author.username;
}

/** Removes each mention of the bot user: a host does not know the bot user ID. */
export function stripBotMention(content: string, botUserId: string | null): string {
  if (!botUserId) return content.trim();
  return content.split(`<@${botUserId}>`).join("").split(`<@!${botUserId}>`).join("").trim();
}

/**
 * The delivery for one guild message, or null when the host must not receive it: a bot or webhook
 * wrote it, or it does not mention the bot.
 */
export function normalizeGuildMessage(message: DiscordMessageData, botUserId: string): DiscordInboundMessage | null {
  if (!message.guild_id || message.author.bot === true || message.webhook_id) return null;
  if (!message.mentions.some((user) => user.id === botUserId)) return null;
  const reference = message.message_reference;
  let replyTo: DiscordInboundMessage["replyTo"] = null;
  const repliedId = message.referenced_message?.id ?? reference?.message_id;
  if (reference && (reference.type ?? MessageReferenceType.Default) === MessageReferenceType.Default && repliedId) {
    const referenced = message.referenced_message;
    const authorIsBot = referenced?.author.id === botUserId;
    replyTo = {
      messageId: repliedId,
      authorIsBot,
      rootId: authorIsBot ? (referenced?.message_reference?.message_id ?? null) : null,
    };
  }
  const attachments: DiscordInboundAttachment[] = [];
  for (const attachment of message.attachments) {
    if (attachments.length >= DISCORD_ATTACHMENTS_LIMIT) break;
    if (!isDiscordCdnUrl(attachment.url)) continue;
    attachments.push({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type ?? null,
      size: attachment.size,
      url: attachment.url,
    });
  }
  return {
    id: message.id,
    channelId: message.channel_id,
    authorId: message.author.id,
    authorName: discordAuthorName(message),
    content: stripBotMention(message.content, botUserId),
    replyTo,
    attachments,
    sentAt: message.timestamp,
  };
}

function isDiscordCdnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ATTACHMENT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export class DiscordState {
  readonly #configuredApplicationId: string;
  #applicationId: string | null = null;
  #botUserId: string | null = null;
  // Guild ID to name, for each guild that the bot is in.
  readonly #guilds = new Map<string, string>();
  // The guilds that the bot is in, for each Gateway shard, from that shard's READY on. Discord puts a
  // guild on shard `(guild_id >> 22) % shard count`.
  readonly #shardGuilds = new Map<number, Set<string>>();
  #shardCount: number | null = null;
  // The shards whose connection closed. Their guilds can be stale until the shard resumes, when the
  // Gateway sends the missed events, or until its next READY.
  readonly #closedShards = new Set<number>();
  // Channel or thread ID to its guild and name.
  readonly #channels = new Map<string, { guildId: string; name: string }>();
  readonly #interactions = new Map<string, StoredInteraction>();
  // User ID to the time of the last reply to a direct message from that user.
  readonly #directReplies = new Map<string, number>();

  constructor(applicationId: string) {
    this.#configuredApplicationId = applicationId;
  }

  /** Whether the bot is in the guild, or null before the READY of every shard. */
  isMember(guildId: string): boolean | null {
    return this.memberGuildIds() === null
      ? null
      : (this.#shardGuilds.get(this.#shardOf(guildId))?.has(guildId) ?? false);
  }

  /** Every guild that the bot is in, or null before the READY of every shard and while one is closed. */
  memberGuildIds(): string[] | null {
    const count = this.#shardCount;
    if (count === null || this.#shardGuilds.size < count || this.#closedShards.size > 0) return null;
    return [...this.#shardGuilds.values()].flatMap((guilds) => [...guilds]);
  }

  /** A shard's connection closed: its guilds are not known until it resumes or is ready again. */
  shardClosed(shard: number): void {
    this.#closedShards.add(shard);
  }

  /** A shard resumed: the Gateway sent the events it missed, so its guilds are current again. */
  shardResumed(shard: number): DiscordAction[] {
    this.#closedShards.delete(shard);
    return this.memberGuildIds() === null ? [] : [{ type: "reconcile" }];
  }

  #shardOf(guildId: string): number {
    return Number((BigInt(guildId) >> 22n) % BigInt(this.#shardCount ?? 1));
  }

  get botUserId(): string | null {
    return this.#botUserId;
  }

  /** The application ID from the Gateway, or the configured one before READY. */
  get applicationId(): string {
    return this.#applicationId ?? this.#configuredApplicationId;
  }

  channel(channelId: string): { guildId: string; name: string } | null {
    return this.#channels.get(channelId) ?? null;
  }

  /** Keeps a channel that a REST call found, for a guild that the bot is in. */
  rememberChannel(channelId: string, guildId: string, name: string): void {
    if (this.#guilds.has(guildId)) this.#channels.set(channelId, { guildId, name });
  }

  /** The token of a button press in the guild that Discord still accepts, or null. */
  interactionToken(interactionId: string, guildId: string, now = Date.now()): string | null {
    const stored = this.#interactions.get(interactionId);
    if (!stored || stored.guildId !== guildId || stored.expiresAt <= now) return null;
    return stored.token;
  }

  handle(payload: GatewayDispatchPayload, now = Date.now()): DiscordAction[] {
    switch (payload.t) {
      case GatewayDispatchEvents.Ready:
        this.#botUserId = payload.d.user.id;
        this.#applicationId = payload.d.application.id;
        {
          const [shard, count] = payload.d.shard ?? [0, 1];
          // A new session of a shard lists its guilds again; a guild that it does not list was left.
          if (this.#shardCount !== count) this.#shardGuilds.clear();
          this.#shardCount = count;
          this.#shardGuilds.set(shard, new Set(payload.d.guilds.map((guild) => guild.id)));
          this.#closedShards.delete(shard);
        }
        return this.memberGuildIds() === null ? [] : [{ type: "reconcile" }];
      case GatewayDispatchEvents.GuildCreate:
      case GatewayDispatchEvents.GuildUpdate: {
        const guild = payload.d;
        this.#guilds.set(guild.id, guild.name);
        if (this.#shardCount !== null) this.#shardGuilds.get(this.#shardOf(guild.id))?.add(guild.id);
        if (payload.t === GatewayDispatchEvents.GuildCreate) {
          for (const channel of [...(payload.d.channels ?? []), ...(payload.d.threads ?? [])]) {
            this.#channels.set(channel.id, { guildId: guild.id, name: channel.name ?? "" });
          }
        }
        return [];
      }
      case GatewayDispatchEvents.GuildDelete: {
        // An outage makes a guild unavailable. Only a removal ends the guild's connection.
        if (payload.d.unavailable === true) return [];
        this.#forgetGuild(payload.d.id);
        return [{ type: "deliver", guildId: payload.d.id, delivery: { kind: "removed" } }];
      }
      case GatewayDispatchEvents.ChannelCreate:
      case GatewayDispatchEvents.ChannelUpdate:
      case GatewayDispatchEvents.ThreadCreate:
      case GatewayDispatchEvents.ThreadUpdate: {
        const channel = payload.d;
        if ("guild_id" in channel && channel.guild_id) {
          this.#channels.set(channel.id, { guildId: channel.guild_id, name: channel.name ?? "" });
        }
        return [];
      }
      case GatewayDispatchEvents.ChannelDelete:
      case GatewayDispatchEvents.ThreadDelete:
        this.#channels.delete(payload.d.id);
        return [];
      case GatewayDispatchEvents.ThreadListSync:
        for (const thread of payload.d.threads) {
          this.#channels.set(thread.id, { guildId: payload.d.guild_id, name: thread.name ?? "" });
        }
        return [];
      case GatewayDispatchEvents.MessageCreate:
        return this.#message(payload.d, now);
      case GatewayDispatchEvents.InteractionCreate:
        return this.#interaction(payload.d, now);
      default:
        return [];
    }
  }

  #message(message: DiscordMessageData, now: number): DiscordAction[] {
    if (!message.guild_id) return this.#directMessage(message, now);
    if (!this.#botUserId) return [];
    const normalized = normalizeGuildMessage(message, this.#botUserId);
    return normalized
      ? [{ type: "deliver", guildId: message.guild_id, delivery: { kind: "message", message: normalized } }]
      : [];
  }

  #directMessage(message: DiscordMessageData, now: number): DiscordAction[] {
    if (message.author.bot === true || message.webhook_id) return [];
    const last = this.#directReplies.get(message.author.id);
    if (last !== undefined && now - last < DIRECT_REPLY_INTERVAL_MILLISECONDS) return [];
    for (const [userId, repliedAt] of this.#directReplies) {
      if (now - repliedAt >= DIRECT_REPLY_INTERVAL_MILLISECONDS) this.#directReplies.delete(userId);
    }
    this.#directReplies.delete(message.author.id);
    if (this.#directReplies.size >= MAXIMUM_DIRECT_REPLIES) return [];
    this.#directReplies.set(message.author.id, now);
    return [{ type: "direct-reply", channelId: message.channel_id }];
  }

  #interaction(
    interaction: Extract<GatewayDispatchPayload, { t: GatewayDispatchEvents.InteractionCreate }>["d"],
    now: number,
  ): DiscordAction[] {
    if (interaction.type !== InteractionType.MessageComponent) return [];
    const guildId = interaction.guild_id;
    const userId = interaction.member?.user.id;
    const customId = interaction.data.custom_id;
    const channelId = interaction.channel?.id ?? interaction.channel_id;
    if (!guildId || !userId || !channelId || !customId.startsWith(DISCORD_CUSTOM_ID_PREFIX)) return [];
    this.#rememberInteraction(
      interaction.id,
      { token: interaction.token, guildId, expiresAt: now + INTERACTION_TOKEN_TTL_MILLISECONDS },
      now,
    );
    const pressed: DiscordInboundInteraction = {
      id: interaction.id,
      channelId,
      messageId: interaction.message.id,
      replyToId: interaction.message.message_reference?.message_id ?? null,
      userId,
      customId,
    };
    return [
      { type: "acknowledge", interactionId: interaction.id, interactionToken: interaction.token },
      { type: "deliver", guildId, delivery: { kind: "interaction", interaction: pressed } },
    ];
  }

  #rememberInteraction(id: string, stored: StoredInteraction, now: number): void {
    for (const [key, value] of this.#interactions) {
      if (value.expiresAt <= now) this.#interactions.delete(key);
    }
    while (this.#interactions.size >= MAXIMUM_INTERACTIONS) {
      const oldest = this.#interactions.keys().next().value;
      if (oldest === undefined) break;
      this.#interactions.delete(oldest);
    }
    this.#interactions.set(id, stored);
  }

  #forgetGuild(guildId: string): void {
    this.#guilds.delete(guildId);
    if (this.#shardCount !== null) this.#shardGuilds.get(this.#shardOf(guildId))?.delete(guildId);
    for (const [channelId, channel] of this.#channels) {
      if (channel.guildId === guildId) this.#channels.delete(channelId);
    }
    for (const [interactionId, interaction] of this.#interactions) {
      if (interaction.guildId === guildId) this.#interactions.delete(interactionId);
    }
  }
}
