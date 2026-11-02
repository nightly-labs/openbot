import { open, rm } from "node:fs/promises";
import {
  DISCORD_LIST_MESSAGES_LIMIT,
  DISCORD_MESSAGE_TEXT_LIMIT,
  DISCORD_UPLOAD_BYTES_LIMIT,
  type DiscordApiRequest,
  type DiscordButton,
  type DiscordHistoryMessage,
  decodeDiscordChannels,
  decodeDiscordHistory,
  decodeDiscordMessageId,
  decodeDiscordName,
  decodeDiscordRoles,
} from "@openbot/contracts/signal-protocol/discord-api";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { causeHelpers } from "../../effect-boundary";
import { chunkMarkdown } from "../messaging-chunks";
import { mentionNames, withMentionNames } from "../messaging-mentions";
import type { MessagingAnswerFile } from "../messaging-threads";
import type {
  ConnectionIdentity,
  ContextEntry,
  InboundFile,
  MessageBody,
  MessageTarget,
  MessagingAdapter,
  MessagingDriver,
  MessagingDriverOptions,
  MessagingIngress,
  MessagingPlace,
  StatusReaction,
} from "../messaging-types";
import { DiscordApiError, MessagingAdapterError } from "../messaging-types";
import {
  discordContextText,
  discordCustomId,
  discordMentionIds,
  discordPlainText,
  inboundFile,
} from "./discord-events";
import { DiscordTransport } from "./discord-transport";

/** A margin under Discord's limit for the fence that `chunkMarkdown` can add. */
const CHUNK_CHARACTERS = DISCORD_MESSAGE_TEXT_LIMIT - 40;
/** How many pages of a channel the context reads after the conversation's first message. */
const HISTORY_PAGES = 3;
/** The channel messages before a conversation's first message that are its context: the most, and how old. */
const PRECEDING_MESSAGES = 10;
const PRECEDING_WINDOW_MS = 15 * 60_000;
/** The times the history tool reads a channel from, shortest first: an hour, a day, a week. */
const RECENT_WINDOWS_MS = [3_600_000, 86_400_000, 604_800_000];
/** The most `listMessages` calls of one history tool call. */
const RECENT_CALLS = 6;
const CLOCK_MARGIN_MS = 60_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const RATE_LIMIT_NOTICE_MS = 5_000;
/** Signal answers a rate limit at once. A call waits and tries again, as a Slack call does. */
const RATE_LIMIT_RETRIES = 3;
/** The longest wait for one retry. A longer limit fails the call. */
const RATE_LIMIT_WAIT_LIMIT_MS = 60_000;
const REDIRECT_LIMIT = 3;
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

const { io: adapterIo } = causeHelpers(MessagingAdapterError);

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "✅",
  failed: "❌",
  stopped: "⏹️",
};

const BUTTON_STYLES = { primary: "primary", danger: "danger" } as const;

/**
 * The Discord side of one guild's connection. Every call goes through Signal, which holds the bot
 * token and refuses a call outside this host's guilds. Signal sends no post that can ping anyone. It
 * never logs message text or a response body.
 */
class DiscordAdapter implements MessagingAdapter {
  readonly platform = "discord" as const;
  readonly #ingress: MessagingIngress;
  readonly #guildId: string;
  readonly #guildName: string;
  readonly #appId: string;
  readonly #rateLimited: (retryAt: string) => void;
  readonly #names = new Map<string, Deferred.Deferred<string>>();
  readonly #places = new Map<string, Deferred.Deferred<string>>();

  constructor(ingress: MessagingIngress, credentials: Record<string, string>, options: MessagingDriverOptions) {
    this.#ingress = ingress;
    this.#guildId = credentials.guildId ?? "";
    this.#guildName = credentials.guildName ?? this.#guildId;
    this.#appId = credentials.appId ?? "";
    this.#rateLimited = options.rateLimited;
  }

  /**
   * The guild that the account service linked to this host. Signal checks each call against the
   * link, and tells this host when OpenBot leaves the guild, so this asks Discord nothing.
   */
  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError> {
    return Effect.succeed({
      workspaceId: this.#guildId,
      workspaceName: this.#guildName,
      // Discord gives a bot user the id of its application.
      botUserId: this.#appId,
      appId: this.#appId,
      missingScopes: [],
    });
  }

  readonly post = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    body: MessageBody,
  ): Effect.fn.Return<string, MessagingAdapterError> {
    return yield* this.#call(
      {
        op: "createMessage",
        guildId: this.#guildId,
        channelId: target.platformChannelId,
        content: clip(body.text),
        replyTo: target.replyThreadId,
        buttons: buttons(body),
      },
      decodeDiscordMessageId,
    );
  });

  readonly edit = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#call(
      {
        op: "editMessage",
        guildId: this.#guildId,
        channelId: target.platformChannelId,
        messageId,
        content: clip(body.text),
        buttons: buttons(body),
      },
      ignoreAnswer,
    );
  });

  /** Discord has private replies only to a button press. Without one, nothing is posted. */
  readonly postPrivate = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    _target: MessageTarget,
    _userId: string,
    text: string,
    replyHandle?: string,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    if (!replyHandle) return;
    yield* this.#call(
      { op: "interactionReply", guildId: this.#guildId, interactionId: replyHandle, content: clip(text) },
      ignoreAnswer,
    );
  });

  readonly react = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#call(
      {
        op: "react",
        guildId: this.#guildId,
        channelId: target.platformChannelId,
        messageId,
        emoji: REACTIONS[reaction],
        on,
      },
      ignoreAnswer,
    );
  });

  readonly postAnswer = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ) {
    const [first = "", ...rest] = chunkMarkdown(markdown, CHUNK_CHARACTERS);
    let firstId: string;
    if (replaceMessageId) {
      firstId = replaceMessageId;
      const updated = yield* Effect.result(this.edit(target, replaceMessageId, { text: first }));
      if (Result.isFailure(updated)) {
        yield* this.#call(
          {
            op: "deleteMessage",
            guildId: this.#guildId,
            channelId: target.platformChannelId,
            messageId: replaceMessageId,
          },
          ignoreAnswer,
        ).pipe(Effect.catch(() => Effect.void));
        firstId = yield* this.post(target, { text: first });
      }
    } else firstId = yield* this.post(target, { text: first });
    for (const chunk of rest) yield* this.post(target, { text: chunk });
    return firstId;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    const skipped: string[] = [];
    for (const file of files) {
      const attempt = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          // An attachment can be ten times larger than Discord's limit: it is not read whole.
          const bytes = yield* readAtMost(file.path, DISCORD_UPLOAD_BYTES_LIMIT);
          if (bytes === null || bytes.byteLength === 0) return false;
          yield* this.#call(
            {
              op: "upload",
              guildId: this.#guildId,
              channelId: target.platformChannelId,
              replyTo: target.replyThreadId,
              filename: file.name,
            },
            ignoreAnswer,
            { bytes, mimeType: file.mimeType },
          );
          return true;
        }),
      );
      if (Result.isFailure(attempt) || !attempt.success) skipped.push(file.name);
    }
    return skipped;
  });

  /**
   * The messages of the reply chain that `threadKey` starts, after `afterId` and before `beforeId`.
   * Discord has no thread of replies, so this reads the channel from the first message on and keeps
   * the first message, the replies to it and the replies to OpenBot's posts, which all reply to it.
   * The first message of a conversation has no chain before it: its context is the channel's
   * messages of the last minutes before it, such as an image that a person posted without a mention.
   * Without the Message Content intent, Discord gives the text and files only of a message that
   * mentions OpenBot, so a message without either is left out.
   */
  readonly history = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const after = afterId ? BigInt(afterId) : null;
    const messages =
      threadKey === beforeId
        ? yield* this.#preceding(platformChannelId, BigInt(beforeId))
        : yield* this.#chain(platformChannelId, threadKey, BigInt(beforeId));
    return yield* this.#entries(
      messages.filter(
        (message) => !message.authorIsBot && hasContent(message) && (after === null || BigInt(message.id) > after),
      ),
    );
  });

  /**
   * The newest messages of a reply chain or of the channel, OpenBot's posts included, for the agent's
   * history tool. Discord lists a channel only forward from an id, so the channel is read from a
   * time: the last hour first, and a longer time when that has too few messages. A message without
   * text or files is left out, as in `history`.
   */
  readonly recent = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const now = Date.now();
    if (threadKey) {
      // A margin past now: this computer's clock can be behind Discord's.
      const chain = yield* this.#chain(platformChannelId, threadKey, snowflakeAt(now + CLOCK_MARGIN_MS));
      return (yield* this.#entries(chain.filter(hasContent))).slice(-limit);
    }
    let calls = 0;
    let visible: DiscordHistoryMessage[] | null = null;
    for (const window of RECENT_WINDOWS_MS) {
      const read: DiscordHistoryMessage[] = [];
      let cursor = (snowflakeAt(now - window) - 1n).toString();
      let complete = false;
      while (calls < RECENT_CALLS && !complete) {
        calls += 1;
        const batch = yield* this.#listMessages(platformChannelId, cursor);
        read.push(...batch);
        const last = batch.at(-1);
        complete = !last || batch.length < DISCORD_LIST_MESSAGES_LIMIT;
        if (last) cursor = last.id;
      }
      // A longer time that was not read to its end has only its oldest messages: the shorter time
      // before it, read to its end, is newer.
      if (!complete && visible) break;
      visible = read.filter(hasContent);
      if (!complete || visible.length >= limit || calls >= RECENT_CALLS) break;
    }
    if (!visible) return [];
    visible.sort((left, right) => compareSnowflakes(left.id, right.id));
    return (yield* this.#entries(visible)).slice(-limit);
  });

  /**
   * The messages of the reply chain that `threadKey` starts, before `before`, oldest first. Discord
   * has no thread of replies, so this reads the channel from the first message on and keeps the first
   * message, the replies to it, OpenBot's posts that reply to it, and the replies to those posts.
   */
  readonly #chain = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    threadKey: string,
    before: bigint,
  ): Effect.fn.Return<DiscordHistoryMessage[], MessagingAdapterError> {
    const messages: DiscordHistoryMessage[] = [];
    let cursor = (BigInt(threadKey) - 1n).toString();
    for (let page = 0; page < HISTORY_PAGES; page += 1) {
      const batch = yield* this.#listMessages(platformChannelId, cursor);
      messages.push(...batch);
      const last = batch.at(-1);
      if (!last || batch.length < DISCORD_LIST_MESSAGES_LIMIT || BigInt(last.id) >= before) break;
      cursor = last.id;
    }
    messages.sort((left, right) => compareSnowflakes(left.id, right.id));
    const botPosts = new Set<string>();
    const chain: DiscordHistoryMessage[] = [];
    for (const message of messages) {
      if (BigInt(message.id) >= before) break;
      if (message.authorIsBot) {
        if (message.replyToId !== threadKey) continue;
        botPosts.add(message.id);
        chain.push(message);
        continue;
      }
      if (
        message.id === threadKey ||
        message.replyToId === threadKey ||
        (message.replyToId !== null && botPosts.has(message.replyToId))
      )
        chain.push(message);
    }
    return chain;
  });

  /** The newest channel messages before `before`, from the last minutes before it, oldest first. */
  readonly #preceding = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    before: bigint,
  ): Effect.fn.Return<DiscordHistoryMessage[], MessagingAdapterError> {
    const messages: DiscordHistoryMessage[] = [];
    let cursor = (snowflakeAt(Number(snowflakeTime(before)) - PRECEDING_WINDOW_MS) - 1n).toString();
    for (let page = 0; page < HISTORY_PAGES; page += 1) {
      const batch = yield* this.#listMessages(platformChannelId, cursor);
      messages.push(...batch);
      const last = batch.at(-1);
      if (!last || batch.length < DISCORD_LIST_MESSAGES_LIMIT || BigInt(last.id) >= before) break;
      cursor = last.id;
    }
    return messages
      .filter((message) => BigInt(message.id) < before)
      .sort((left, right) => compareSnowflakes(left.id, right.id))
      .slice(-PRECEDING_MESSAGES);
  });

  #listMessages(
    platformChannelId: string,
    after: string,
  ): Effect.Effect<DiscordHistoryMessage[], MessagingAdapterError> {
    return this.#call(
      {
        op: "listMessages",
        guildId: this.#guildId,
        channelId: platformChannelId,
        after,
        limit: DISCORD_LIST_MESSAGES_LIMIT,
      },
      decodeDiscordHistory,
    );
  }

  /** Discord messages as context, with each user mention named. A bot's post names the bot. */
  readonly #entries = Effect.fnUntraced(function* (this: DiscordAdapter, messages: DiscordHistoryMessage[]) {
    const names = yield* mentionNames(
      messages.flatMap((message) => discordMentionIds(message.content)),
      (userId) => this.authorName(userId),
    );
    return messages.map(
      (message): ContextEntry => ({
        id: message.id,
        authorName: message.authorIsBot ? `${message.authorName} (bot)` : message.authorName,
        text: discordContextText(
          withMentionNames(discordPlainText(message.content), names),
          message.attachments,
          message.forwarded,
        ),
        sentAt: message.sentAt,
        ...(message.attachments.length ? { files: message.attachments.map(inboundFile) } : {}),
      }),
    );
  });

  /** A Discord attachment is a signed CDN address: it needs no token. */
  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError> {
    return downloadAttachment(file.url, destination, maxBytes);
  }

  readonly authorName = Effect.fnUntraced(function* (this: DiscordAdapter, userId: string) {
    const cached = this.#names.get(userId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#names.set(userId, name);
    // Detached, so a caller with a deadline stops waiting at it. The lookup still completes the cache
    // entry, which a later caller then reads.
    yield* Effect.forkDetach(
      this.#call({ op: "member", guildId: this.#guildId, userId }, decodeDiscordName).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            this.#names.delete(userId);
            return userId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  readonly placeName = Effect.fnUntraced(function* (this: DiscordAdapter, platformChannelId: string) {
    const cached = this.#places.get(platformChannelId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#places.set(platformChannelId, name);
    // Detached for the same reason as `authorName`.
    yield* Effect.forkDetach(
      this.#call({ op: "channel", guildId: this.#guildId, channelId: platformChannelId }, decodeDiscordName).pipe(
        Effect.map((channel) => `#${channel}`),
        Effect.catch(() =>
          Effect.sync(() => {
            this.#places.delete(platformChannelId);
            return platformChannelId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  /** A Signal that predates `listChannels` refuses it as an invalid request. */
  places(): Effect.Effect<MessagingPlace[], MessagingAdapterError> {
    return this.#call({ op: "listChannels", guildId: this.#guildId }, decodeDiscordChannels).pipe(
      Effect.map((channels) =>
        channels.map((channel) => ({
          id: channel.id,
          name: channel.kind === "channel" ? `#${channel.name}` : channel.name,
          kind: channel.kind,
        })),
      ),
    );
  }

  /** A Signal that predates `listRoles` refuses it as an invalid request. */
  roles(): Effect.Effect<Array<{ id: string; name: string }>, MessagingAdapterError> {
    return this.#call({ op: "listRoles", guildId: this.#guildId }, decodeDiscordRoles);
  }

  /** Signal posts with no mention allowed, so a mention shows the person and pings nobody. */
  mention(userId: string): string {
    return /^[0-9]+$/.test(userId) ? `<@${userId}>` : userId;
  }

  #call<A>(
    request: DiscordApiRequest,
    decode: (value: unknown) => A,
    file?: { bytes: Uint8Array; mimeType: string },
    attempt = 0,
  ): Effect.Effect<A, MessagingAdapterError> {
    return this.#ingress.discord(request, decode, file).pipe(
      Effect.catch((failure) => {
        const error = failure.cause;
        if (!(error instanceof DiscordApiError) || error.code !== "rate_limited" || attempt >= RATE_LIMIT_RETRIES)
          return Effect.fail(failure);
        const waitMs = error.retryAfterMs ?? 1_000;
        if (waitMs > RATE_LIMIT_WAIT_LIMIT_MS) return Effect.fail(failure);
        if (waitMs > RATE_LIMIT_NOTICE_MS) this.#rateLimited(new Date(Date.now() + waitMs).toISOString());
        return Effect.sleep(waitMs).pipe(Effect.andThen(this.#call(request, decode, file, attempt + 1)));
      }),
    );
  }
}

/** Each guild installed the OpenBot app. Its events come through the ingress relay, and its calls go through Signal. */
export function discordDriver(options: { ingress?: MessagingIngress } = {}): MessagingDriver {
  return {
    platform: "discord",
    requiredCredential: "guildId",
    createAdapter(credentials, driverOptions) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.discordUnsupported"));
      return new DiscordAdapter(options.ingress, credentials, driverOptions);
    },
    createTransport(_credentials, identity) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.discordUnsupported"));
      return new DiscordTransport(options.ingress, identity.workspaceId);
    },
  };
}

function buttons(body: MessageBody): DiscordButton[] {
  return (body.buttons ?? []).map((button) => ({
    customId: discordCustomId(button.action, button.token),
    label: button.label,
    style: button.style ? BUTTON_STYLES[button.style] : "secondary",
  }));
}

/** Status text is written by the host and is short; this keeps it within Discord's limit. */
function clip(text: string): string {
  return text.length > DISCORD_MESSAGE_TEXT_LIMIT ? `${text.slice(0, DISCORD_MESSAGE_TEXT_LIMIT - 1)}…` : text;
}

/** The smallest Discord id of a message sent at `milliseconds`. */
function snowflakeAt(milliseconds: number): bigint {
  return (BigInt(milliseconds) - DISCORD_EPOCH_MS) << 22n;
}

function snowflakeTime(id: bigint): bigint {
  return (id >> 22n) + DISCORD_EPOCH_MS;
}

/** A message that has text or files for the context, or a forward, which says when it has neither. */
function hasContent(message: DiscordHistoryMessage): boolean {
  return discordPlainText(message.content) !== "" || message.attachments.length > 0 || message.forwarded;
}

function compareSnowflakes(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** The answer of a call that returns nothing OpenBot reads. */
function ignoreAnswer(): void {}

function trustedCdnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CDN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** The bytes of a file, or null when it is larger than `limit`. It reads at most one byte more. */
const readAtMost = Effect.fnUntraced(function* (path: string, limit: number) {
  return yield* Effect.acquireUseRelease(
    adapterIo(() => open(path, "r")),
    (file) =>
      adapterIo(async () => {
        const { size } = await file.stat();
        if (size > limit) return null;
        // One byte more than the size, to see a file that grew since `stat`.
        const buffer = Buffer.alloc(Math.min(size, limit) + 1);
        let length = 0;
        for (;;) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (bytesRead === 0) break;
          length += bytesRead;
          if (length === buffer.length) return null;
        }
        return buffer.subarray(0, length);
      }),
    (file) => Effect.promise(() => file.close()),
  );
});

/** Downloads one attachment from Discord's CDN, and refuses a file larger than `maxBytes`. */
const downloadAttachment = Effect.fnUntraced(function* (url: string, destination: string, maxBytes: number) {
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    if (!trustedCdnUrl(current))
      return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "untrusted_file_url") });
    const next = yield* Effect.acquireUseRelease(
      Effect.sync(() => new AbortController()),
      (controller) =>
        Effect.gen(function* () {
          const response = yield* adapterIo(() => fetch(current, { redirect: "manual", signal: controller.signal }));
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location || redirects >= REDIRECT_LIMIT)
              return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "redirect") });
            return new URL(location, current).toString();
          }
          const body = response.body;
          if (!response.ok || !body)
            return yield* new MessagingAdapterError({
              cause: new DiscordApiError("download", `http_${response.status}`),
            });
          if (Number(response.headers.get("content-length") ?? "0") > maxBytes)
            return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "too_large") });
          yield* writeBody(body, destination, maxBytes);
          return null;
        }),
      (controller) => Effect.sync(() => controller.abort()),
    );
    if (next === null) return;
    current = next;
  }
});

const writeBody = Effect.fnUntraced(function* (
  body: ReadableStream<Uint8Array>,
  destination: string,
  maxBytes: number,
) {
  const reader = body.getReader();
  yield* Effect.acquireUseRelease(
    adapterIo(() => open(destination, "w", 0o600)),
    (file) =>
      Effect.gen(function* () {
        let received = 0;
        for (;;) {
          const { done, value } = yield* adapterIo(() => reader.read());
          if (done) return;
          received += value.byteLength;
          if (received > maxBytes)
            return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "too_large") });
          yield* adapterIo(() => file.write(value));
        }
      }).pipe(Effect.onError(() => adapterIo(() => rm(destination, { force: true })).pipe(Effect.orDie))),
    (file) => Effect.promise(() => file.close()),
  ).pipe(Effect.ensuring(adapterIo(() => reader.cancel()).pipe(Effect.catch(() => Effect.void))));
});
