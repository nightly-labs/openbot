import { Option, Schema } from "effect";
import { SignalRefusals, TrustedResumeToken } from "./state-snapshot";

const mutableArray = <S extends Schema.Top>(item: S) => Schema.mutable(Schema.Array(item));
const Pair = Schema.mutable(Schema.Tuple([Schema.String, Schema.String]));

const JoinAnswer = Schema.Struct({ snapshot: Schema.String, discord: Schema.optional(Schema.Boolean) });
const ClaimRequest = Schema.Struct({ jti: Schema.String, exp: Schema.Number });
const ClaimAnswer = Schema.Struct({ claimed: Schema.Boolean });
const DeliveredAnswer = Schema.Struct({ delivered: Schema.Boolean });
const TrustedBatch = Schema.Struct({ entries: Schema.Array(TrustedResumeToken) });

const IngressRoute = Schema.Union([
  Schema.Struct({ platform: Schema.Literal("slack"), appId: Schema.String, teamId: Schema.String }),
  Schema.Struct({ platform: Schema.Literal("discord"), guildId: Schema.String }),
  Schema.Struct({ platform: Schema.Literal("telegram"), botId: Schema.String, chatId: Schema.String }),
  Schema.Struct({ platform: Schema.Literal("webhook"), routeId: Schema.String }),
]);
const QueueHandoff = Schema.Struct({
  keys: mutableArray(Pair),
  entries: mutableArray(
    Schema.Struct({
      id: Schema.String,
      hostId: Schema.String,
      route: IngressRoute,
      routeKey: Schema.String,
      sealed: Schema.String,
      telegramCallback: Schema.NullOr(Schema.Struct({ botId: Schema.String, queryId: Schema.String })),
      expiresAt: Schema.Number,
    }),
  ),
});

const SessionInfo = Schema.Struct({
  resumeURL: Schema.String,
  sequence: Schema.Number,
  sessionId: Schema.String,
  shardCount: Schema.Number,
  shardId: Schema.Number,
});
const DiscordSessionHandoff = Schema.Struct({
  sessions: mutableArray(Schema.mutable(Schema.Tuple([Schema.Number, SessionInfo]))),
  state: Schema.Struct({
    applicationId: Schema.NullOr(Schema.String),
    botUserId: Schema.NullOr(Schema.String),
    guilds: mutableArray(Pair),
    shardGuilds: mutableArray(Schema.mutable(Schema.Tuple([Schema.Number, mutableArray(Schema.String)]))),
    shardCount: Schema.NullOr(Schema.Number),
    channels: mutableArray(
      Schema.mutable(Schema.Tuple([Schema.String, Schema.Struct({ guildId: Schema.String, name: Schema.String })])),
    ),
    botRoles: mutableArray(Pair),
    interactions: mutableArray(
      Schema.mutable(
        Schema.Tuple([
          Schema.String,
          Schema.Struct({ token: Schema.String, guildId: Schema.String, expiresAt: Schema.Number }),
        ]),
      ),
    ),
    directReplies: mutableArray(Schema.mutable(Schema.Tuple([Schema.String, Schema.Number]))),
  }),
});

const Attachment = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  contentType: Schema.NullOr(Schema.String),
  size: Schema.Number,
  url: Schema.String,
});
const Quote = Schema.Struct({
  authorId: Schema.String,
  authorName: Schema.String,
  content: Schema.String,
  sentAt: Schema.String,
  attachments: mutableArray(Attachment),
  embeds: mutableArray(Schema.String),
  forwarded: Schema.Boolean,
});
const DiscordDelivery = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    message: Schema.Struct({
      id: Schema.String,
      channelId: Schema.String,
      authorId: Schema.String,
      authorName: Schema.String,
      authorRoleIds: Schema.NullOr(mutableArray(Schema.String)),
      content: Schema.String,
      replyTo: Schema.NullOr(
        Schema.Struct({
          messageId: Schema.String,
          authorIsBot: Schema.Boolean,
          rootId: Schema.NullOr(Schema.String),
          quote: Schema.NullOr(Quote),
        }),
      ),
      attachments: mutableArray(Attachment),
      sentAt: Schema.String,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("interaction"),
    interaction: Schema.Struct({
      id: Schema.String,
      channelId: Schema.String,
      messageId: Schema.String,
      replyToId: Schema.NullOr(Schema.String),
      userId: Schema.String,
      customId: Schema.String,
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("removed") }),
]);
const DiscordDeliveryRequest = Schema.Struct({ guildId: Schema.String, delivery: DiscordDelivery });

const decoder =
  <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  (text: string): S["Type"] | null =>
    Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(schema))(text));

export const decodeJoinAnswer = decoder(JoinAnswer);
export const decodeClaimRequest = decoder(ClaimRequest);
export const decodeClaimAnswer = decoder(ClaimAnswer);
export const decodeDeliveredAnswer = decoder(DeliveredAnswer);
export const decodeTrustedBatch = decoder(TrustedBatch);
export const decodeRefusals = decoder(SignalRefusals);
export const decodeQueueHandoff = decoder(QueueHandoff);
export const decodeDiscordSessionHandoff = decoder(DiscordSessionHandoff);
export const decodeDiscordDeliveryRequest = decoder(DiscordDeliveryRequest);
