import { open, rm } from "node:fs/promises";
import {
  DISCORD_LIST_MESSAGES_LIMIT,
  DISCORD_MESSAGE_TEXT_LIMIT,
  DISCORD_UPLOAD_BYTES_LIMIT,
  type DiscordApiRequest,
  type DiscordButton,
  type DiscordHistoryMessage,
  decodeDiscordHistory,
  decodeDiscordMessageId,
  decodeDiscordName,
} from "@openbot/contracts/signal-protocol/discord-api";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { causeHelpers } from "../../effect-boundary";
import { chunkMarkdown } from "../messaging-chunks";
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
  StatusReaction,
} from "../messaging-types";
import { DiscordApiError, MessagingAdapterError } from "../messaging-types";
import { discordCustomId, discordPlainText } from "./discord-events";
import { DiscordTransport } from "./discord-transport";

/** A margin under Discord's limit for the fence that `chunkMarkdown` can add. */
const CHUNK_CHARACTERS = DISCORD_MESSAGE_TEXT_LIMIT - 40;
/** How many pages of a channel the context reads after the conversation's first message. */
const HISTORY_PAGES = 3;
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
    if (replaceMessageId) {
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
        yield* this.post(target, { text: first });
      }
    } else yield* this.post(target, { text: first });
    for (const chunk of rest) yield* this.post(target, { text: chunk });
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
   * Without the Message Content intent, Discord gives the text only of a message that mentions
   * OpenBot, so a message without text is left out.
   */
  readonly history = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const root = BigInt(threadKey);
    const before = BigInt(beforeId);
    const after = afterId ? BigInt(afterId) : null;
    const messages: DiscordHistoryMessage[] = [];
    let cursor = (root - 1n).toString();
    for (let page = 0; page < HISTORY_PAGES; page += 1) {
      const batch = yield* this.#call(
        {
          op: "listMessages",
          guildId: this.#guildId,
          channelId: platformChannelId,
          after: cursor,
          limit: DISCORD_LIST_MESSAGES_LIMIT,
        },
        decodeDiscordHistory,
      );
      messages.push(...batch);
      const last = batch.at(-1);
      if (!last || batch.length < DISCORD_LIST_MESSAGES_LIMIT || BigInt(last.id) >= before) break;
      cursor = last.id;
    }
    messages.sort((left, right) => compareSnowflakes(left.id, right.id));
    const botPosts = new Set<string>();
    const entries: ContextEntry[] = [];
    for (const message of messages) {
      const id = BigInt(message.id);
      if (id >= before) break;
      if (message.authorIsBot) {
        if (message.replyToId === threadKey) botPosts.add(message.id);
        continue;
      }
      const inChain =
        message.id === threadKey ||
        message.replyToId === threadKey ||
        (message.replyToId !== null && botPosts.has(message.replyToId));
      const text = discordPlainText(message.content);
      if (!inChain || !text || (after !== null && id <= after)) continue;
      entries.push({ id: message.id, authorName: message.authorName, text, sentAt: message.sentAt });
    }
    return entries;
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
    const result = yield* this.#call({ op: "member", guildId: this.#guildId, userId }, decodeDiscordName).pipe(
      Effect.catch(() => Effect.succeed(userId)),
    );
    yield* Deferred.succeed(name, result);
    return result;
  }, Effect.uninterruptible);

  readonly placeName = Effect.fnUntraced(function* (this: DiscordAdapter, platformChannelId: string) {
    const cached = this.#places.get(platformChannelId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#places.set(platformChannelId, name);
    const result = yield* this.#call(
      { op: "channel", guildId: this.#guildId, channelId: platformChannelId },
      decodeDiscordName,
    ).pipe(
      Effect.map((channel) => `#${channel}`),
      Effect.catch(() => Effect.succeed(platformChannelId)),
    );
    yield* Deferred.succeed(name, result);
    return result;
  }, Effect.uninterruptible);

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
