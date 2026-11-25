import { open, rm } from "node:fs/promises";
import {
  DISCORD_LIST_MESSAGES_LIMIT,
  DISCORD_MESSAGE_TEXT_LIMIT,
  DISCORD_UPLOAD_BYTES_LIMIT,
  type DiscordApiRequest,
  type DiscordButton,
  type DiscordEmbed,
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
  MessagingPlaces,
  RecentMessages,
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

const CHUNK_CHARACTERS = DISCORD_MESSAGE_TEXT_LIMIT - 40;
const HISTORY_PAGES = 3;
const PRECEDING_MESSAGES = 10;
const PRECEDING_WINDOW_MS = 15 * 60_000;
const RECENT_WINDOWS_MS = [3_600_000, 86_400_000, 604_800_000];
const NO_RECENT_MESSAGES =
  "This Discord channel has no messages from the last 7 days. OpenBot reads only the last 7 days of a Discord channel.";
const RECENT_CALLS = 6;
const CLOCK_MARGIN_MS = 60_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const RATE_LIMIT_NOTICE_MS = 5_000;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_LIMIT_MS = 60_000;
const REDIRECT_LIMIT = 3;
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const POSSIBLY_POSTED_CODES = new Set(["unreachable", "invalid_answer", "discord_failed"]);

const { io: adapterIo } = causeHelpers(MessagingAdapterError);

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "✅",
  failed: "❌",
  stopped: "⏹️",
};

const BUTTON_STYLES = { primary: "primary", danger: "danger" } as const;

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

  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError> {
    return Effect.succeed({
      workspaceId: this.#guildId,
      workspaceName: this.#guildName,
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
        ...(body.embeds?.length ? { embeds: body.embeds } : {}),
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

  readonly addEmoji = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    messageId: string,
    emoji: string,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#call(
      { op: "react", guildId: this.#guildId, channelId: target.platformChannelId, messageId, emoji, on: true },
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

  readonly postEmbeds = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    markdown: string,
    embeds: DiscordEmbed[],
  ) {
    const [first = "", ...rest] = markdown ? chunkMarkdown(markdown, CHUNK_CHARACTERS) : [];
    const firstId = yield* this.post(target, { text: first, embeds });
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
    return { skipped, firstId: null };
  });

  readonly postFileWithText = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    target: MessageTarget,
    markdown: string,
    file: MessagingAnswerFile,
  ) {
    const chunks = chunkMarkdown(markdown, CHUNK_CHARACTERS);
    const content = chunks.length === 1 ? (chunks[0] ?? "") : "";
    if (!content.trim()) return null;
    const bytes = yield* readAtMost(file.path, DISCORD_UPLOAD_BYTES_LIMIT).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (bytes === null || bytes.byteLength === 0) return null;
    return yield* this.#call(
      {
        op: "upload",
        guildId: this.#guildId,
        channelId: target.platformChannelId,
        replyTo: target.replyThreadId,
        filename: file.name,
        content,
      },
      decodeDiscordMessageId,
      { bytes, mimeType: file.mimeType },
    ).pipe(Effect.catch((failure) => (refusedBeforePost(failure.cause) ? Effect.succeed(null) : Effect.fail(failure))));
  });

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

  readonly recent = Effect.fnUntraced(function* (
    this: DiscordAdapter,
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
  ): Effect.fn.Return<RecentMessages, MessagingAdapterError> {
    const now = Date.now();
    if (threadKey) {
      const chain = yield* this.#chain(platformChannelId, threadKey, snowflakeAt(now + CLOCK_MARGIN_MS));
      return { messages: (yield* this.#entries(chain.filter(hasContent))).slice(-limit) };
    }
    let calls = 0;
    let visible: DiscordHistoryMessage[] | null = null;
    let leftOut = 0;
    let none = false;
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
      if (!complete && visible) break;
      visible = read.filter(hasContent);
      leftOut = read.length - visible.length;
      none = complete && read.length === 0 && window === RECENT_WINDOWS_MS.at(-1);
      if (!complete || visible.length >= limit || calls >= RECENT_CALLS) break;
    }
    if (!visible) return { messages: [] };
    visible.sort((left, right) => compareSnowflakes(left.id, right.id));
    const messages = (yield* this.#entries(visible)).slice(-limit);
    if (none) return { messages, note: NO_RECENT_MESSAGES };
    if (leftOut > 0 && messages.length < limit) return { messages, note: leftOutNote(leftOut) };
    return { messages };
  });

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

  readonly #entries = Effect.fnUntraced(function* (this: DiscordAdapter, messages: DiscordHistoryMessage[]) {
    const names = yield* mentionNames(
      messages.flatMap((message) => discordMentionIds([message.content, ...message.embeds].join("\n"))),
      (userId) => this.authorName(userId),
    );
    return messages.map(
      (message): ContextEntry => ({
        id: message.id,
        authorName: message.authorIsBot ? `${message.authorName} (bot)` : message.authorName,
        text: withMentionNames(
          discordContextText(discordPlainText(message.content), message.attachments, message.embeds, message.forwarded),
          names,
        ),
        sentAt: message.sentAt,
        ...(message.attachments.length ? { files: message.attachments.map(inboundFile) } : {}),
      }),
    );
  });

  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError> {
    return downloadAttachment(file.url, destination, maxBytes);
  }

  readonly authorName = Effect.fnUntraced(function* (this: DiscordAdapter, userId: string) {
    const cached = this.#names.get(userId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#names.set(userId, name);
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

  places(): Effect.Effect<MessagingPlaces, MessagingAdapterError> {
    return this.#call({ op: "listChannels", guildId: this.#guildId }, decodeDiscordChannels).pipe(
      Effect.map(({ channels, omitted }) => ({
        places: channels.map((channel) => ({
          id: channel.id,
          name: channel.kind === "channel" ? `#${channel.name}` : channel.name,
          kind: channel.kind,
        })),
        ...(omitted > 0 ? { note: omittedPlaces(omitted) } : {}),
      })),
    );
  }

  roles(): Effect.Effect<Array<{ id: string; name: string }>, MessagingAdapterError> {
    return this.#call({ op: "listRoles", guildId: this.#guildId }, decodeDiscordRoles);
  }

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

function omittedPlaces(count: number): string {
  return `This server has ${count} more places that this list leaves out: the oldest threads first. messaging_post also takes the id of a place that is not listed, such as the last number of its Discord link. messaging_history reads only listed places.`;
}

function clip(text: string): string {
  return text.length > DISCORD_MESSAGE_TEXT_LIMIT ? `${text.slice(0, DISCORD_MESSAGE_TEXT_LIMIT - 1)}…` : text;
}

function snowflakeAt(milliseconds: number): bigint {
  return (BigInt(milliseconds) - DISCORD_EPOCH_MS) << 22n;
}

function snowflakeTime(id: bigint): bigint {
  return (id >> 22n) + DISCORD_EPOCH_MS;
}

function hasContent(message: DiscordHistoryMessage): boolean {
  return (
    discordPlainText(message.content) !== "" ||
    message.attachments.length > 0 ||
    message.embeds.length > 0 ||
    message.forwarded
  );
}

function leftOutNote(count: number): string {
  const messages =
    count === 1
      ? "1 message of this channel has no text or files that OpenBot can read, so it is left out."
      : `${count} messages of this channel have no text or files that OpenBot can read, so they are left out.`;
  return `${messages} Possible causes: Discord gives OpenBot the text of a message only when the message mentions OpenBot, or the message is a system message, such as a member join. A person can mention OpenBot in a message so that OpenBot can read it.`;
}

function compareSnowflakes(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function ignoreAnswer(): void {}

function refusedBeforePost(cause: unknown): boolean {
  return cause instanceof DiscordApiError && !POSSIBLY_POSTED_CODES.has(cause.code) && !cause.code.startsWith("http_5");
}

function trustedCdnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CDN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const readAtMost = Effect.fnUntraced(function* (path: string, limit: number) {
  return yield* Effect.acquireUseRelease(
    adapterIo(() => open(path, "r")),
    (file) =>
      adapterIo(async () => {
        const { size } = await file.stat();
        if (size > limit) return null;
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

type CdnStep<A> = { redirect: string } | { value: A };

const withCdnBody = Effect.fnUntraced(function* <A>(
  url: string,
  maxBytes: number,
  consume: (body: ReadableStream<Uint8Array>) => Effect.Effect<A, MessagingAdapterError>,
) {
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    if (!trustedCdnUrl(current))
      return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "untrusted_file_url") });
    const next: CdnStep<A> = yield* Effect.acquireUseRelease(
      Effect.sync(() => new AbortController()),
      (controller) =>
        Effect.gen(function* () {
          const response = yield* adapterIo(() => fetch(current, { redirect: "manual", signal: controller.signal }));
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location || redirects >= REDIRECT_LIMIT)
              return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "redirect") });
            return { redirect: new URL(location, current).toString() } as const;
          }
          const body = response.body;
          if (!response.ok || !body)
            return yield* new MessagingAdapterError({
              cause: new DiscordApiError("download", `http_${response.status}`),
            });
          if (Number(response.headers.get("content-length") ?? "0") > maxBytes)
            return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "too_large") });
          return { value: yield* consume(body) } as const;
        }),
      (controller) => Effect.sync(() => controller.abort()),
    );
    if ("value" in next) return next.value;
    current = next.redirect;
  }
});

const downloadAttachment = (url: string, destination: string, maxBytes: number) =>
  withCdnBody(url, maxBytes, (body) => writeBody(body, destination, maxBytes));

export const downloadDiscordAttachment = (url: string, maxBytes: number) =>
  withCdnBody(url, maxBytes, (body) => readBody(body, maxBytes));

const readBody = Effect.fnUntraced(function* (body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  return yield* Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = yield* adapterIo(() => reader.read());
      if (done) return Buffer.concat(chunks, received);
      received += value.byteLength;
      if (received > maxBytes)
        return yield* new MessagingAdapterError({ cause: new DiscordApiError("download", "too_large") });
      chunks.push(value);
    }
  }).pipe(Effect.ensuring(adapterIo(() => reader.cancel()).pipe(Effect.catch(() => Effect.void))));
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
