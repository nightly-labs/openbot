import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { causeHelpers } from "../../effect-boundary";
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
import { MessagingAdapterError, MessagingConnectionError } from "../messaging-types";
import { plainText, SLACK_ACTION_IDS, slackMentionIds } from "./slack-events";
import { SlackEventsTransport } from "./slack-events-transport";
import { slackChunks, slackMrkdwn } from "./slack-render";
import { SlackApiError, SlackWebApi } from "./slack-web-api";

const { io: adapterIo } = causeHelpers(MessagingAdapterError);

/** Slack error codes that a later lookup can recover from. */
const TEMPORARY_SLACK_ERRORS = new Set([
  "ratelimited",
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
]);

function isTemporaryLookupFailure(failure: MessagingAdapterError): boolean {
  const error = failure.cause;
  if (error instanceof MessagingConnectionError) return false;
  return !(error instanceof SlackApiError) || error.code.startsWith("http_") || TEMPORARY_SLACK_ERRORS.has(error.code);
}

/** Slack's own limit for one uploaded file is 1 GB; the host holds its uploads to this. */
const UPLOAD_BYTES = 100 * 1024 * 1024;
const HISTORY_LIMIT = 100;
/** A page of a thread, read from its start: the history tool keeps the newest messages. */
const RECENT_THREAD_LIMIT = 200;
const RECENT_THREAD_PAGES = 5;
/** Message subtypes that a person or an app wrote, and not a join or a topic change. */
const RECENT_SUBTYPES = new Set(["file_share", "bot_message", "thread_broadcast", "me_message"]);
const CHANNEL_PAGE_LIMIT = 200;
const PLACES_LIMIT = 500;

const REACTIONS: Record<StatusReaction, string> = {
  received: "eyes",
  done: "white_check_mark",
  failed: "x",
  stopped: "black_square_for_stop",
};

const BUTTON_ACTIONS = {
  accept: SLACK_ACTION_IDS.accept,
  decline: SLACK_ACTION_IDS.decline,
  stop: SLACK_ACTION_IDS.stop,
} as const;

/** The Slack Web API side of one connection. It never logs message text or a response body. */
class SlackAdapter implements MessagingAdapter {
  readonly platform = "slack" as const;
  readonly #api: SlackWebApi;
  readonly #names = new Map<string, Deferred.Deferred<string>>();
  readonly #places = new Map<string, Deferred.Deferred<string>>();
  #botUserId = "";

  constructor(botToken: string, options: MessagingDriverOptions & { origin?: string | undefined }) {
    this.#api = new SlackWebApi({ token: botToken, origin: options.origin, rateLimited: options.rateLimited });
  }

  readonly identify = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<ConnectionIdentity, MessagingAdapterError> {
    const { payload, scopes } = yield* this.#api.authTest();
    const workspaceId = payload.team_id;
    const botUserId = payload.user_id;
    const botId = payload.bot_id;
    if (!isString(workspaceId) || !isString(botUserId) || !isString(botId))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("auth.test", "not_a_bot_token") });
    const bot = yield* this.#api.call("bots.info", { bot: botId });
    const appId = isDynamicRecord(bot.bot) && isString(bot.bot.app_id) ? bot.bot.app_id : "";
    this.#botUserId = botUserId;
    return {
      workspaceId,
      workspaceName: isString(payload.team) ? payload.team : workspaceId,
      botUserId,
      appId,
      missingScopes: SLACK_BOT_SCOPES.filter((scope) => !scopes.includes(scope)),
    };
  });

  readonly post = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    body: MessageBody,
  ): Effect.fn.Return<string, MessagingAdapterError> {
    const response = yield* this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      ...this.#content(body),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("chat.postMessage", "no_ts") });
    return response.ts;
  });

  readonly edit = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.update", {
      channel: target.platformChannelId,
      ts: messageId,
      ...this.#content(body),
    });
  });

  readonly postPrivate = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    userId: string,
    text: string,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.postEphemeral", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      user: userId,
      text: this.#statusText(text),
    });
  });

  readonly react = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ) {
    yield* this.#api
      .call(on ? "reactions.add" : "reactions.remove", {
        channel: target.platformChannelId,
        timestamp: messageId,
        name: REACTIONS[reaction],
      })
      .pipe(
        Effect.catch((failure) => {
          const error = failure.cause;
          return error instanceof SlackApiError && ["already_reacted", "no_reaction"].includes(error.code)
            ? Effect.void
            : Effect.fail(failure);
        }),
      );
  });

  readonly postAnswer = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ) {
    const [first = "", ...rest] = slackChunks(slackMrkdwn(markdown));
    let firstId: string;
    if (replaceMessageId) {
      firstId = replaceMessageId;
      const updated = yield* Effect.result(
        this.#api.call("chat.update", {
          channel: target.platformChannelId,
          ts: replaceMessageId,
          text: first,
          blocks: [],
        }),
      );
      if (Result.isFailure(updated)) {
        yield* this.#api
          .call("chat.delete", { channel: target.platformChannelId, ts: replaceMessageId })
          .pipe(Effect.catch(() => Effect.void));
        firstId = yield* this.#postText(target, first);
      }
    } else firstId = yield* this.#postText(target, first);
    for (const chunk of rest) yield* this.#postText(target, chunk);
    return firstId;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    const skipped: string[] = [];
    const uploaded: Array<{ id: string; title: string }> = [];
    for (const file of files) {
      const attempt = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const bytes = yield* adapterIo(() => readFile(file.path));
          if (bytes.byteLength > UPLOAD_BYTES || bytes.byteLength === 0) return null;
          const ticket = yield* this.#api.call("files.getUploadURLExternal", {
            filename: file.name,
            length: String(bytes.byteLength),
          });
          if (!isString(ticket.upload_url) || !isString(ticket.file_id))
            return yield* new MessagingAdapterError({ cause: new SlackApiError("files", "no_upload_url") });
          yield* this.#api.uploadBytes(ticket.upload_url, bytes, file.mimeType);
          return { id: ticket.file_id, title: file.name };
        }),
      );
      if (Result.isFailure(attempt) || attempt.success === null) skipped.push(file.name);
      else uploaded.push(attempt.success);
    }
    if (uploaded.length)
      yield* this.#api.call("files.completeUploadExternal", {
        files: uploaded,
        channel_id: target.platformChannelId,
        thread_ts: target.replyThreadId ?? undefined,
      });
    return skipped;
  });

  readonly history = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    // Every conversation is a thread, in a direct message too.
    const response = yield* this.#api.call("conversations.replies", {
      channel: platformChannelId,
      ts: threadKey,
      latest: beforeId,
      oldest: afterId ?? undefined,
      inclusive: false,
      limit: HISTORY_LIMIT,
    });
    const messages = Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
    const kept = messages.filter((message) => {
      const ts = message.ts;
      const user = message.user;
      if (!isString(ts) || !isString(user) || user === this.#botUserId || message.bot_id !== undefined) return false;
      return Number(ts) < Number(beforeId) && !(afterId && Number(ts) <= Number(afterId));
    });
    return yield* this.#entries(kept, false);
  });

  /**
   * The newest messages of a channel, or of one thread, for the agent's history tool. A history read
   * fails at once when Slack limits it: the agent can try again, and the connection does not wait.
   * The author and place names use the adapter's cached lookups, which wait for a limit as usual.
   */
  readonly recent = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const messages = threadKey
      ? yield* this.#threadReplies(platformChannelId, threadKey)
      : yield* this.#api
          .call("conversations.history", { channel: platformChannelId, limit }, { rateLimitRetries: 0 })
          .pipe(Effect.map(responseMessages));
    const kept = messages.filter(
      (message) =>
        isString(message.ts) &&
        (message.subtype === undefined || RECENT_SUBTYPES.has(String(message.subtype))) &&
        (isString(message.user) || message.bot_id !== undefined),
    );
    return (yield* this.#entries(kept, threadKey === null)).slice(-limit);
  });

  /**
   * A thread from its start. Slack gives replies oldest first, so the newest ones are on the last
   * page; a longer thread keeps the pages it read. Only a failed first page fails the read: until the
   * Slack Marketplace approves OpenBot, Slack allows one thread read a minute, so a second page is
   * often refused.
   */
  readonly #threadReplies = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string,
  ): Effect.fn.Return<DynamicRecord[], MessagingAdapterError> {
    const messages: DynamicRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < RECENT_THREAD_PAGES; page += 1) {
      const read = this.#api.call(
        "conversations.replies",
        { channel: platformChannelId, ts: threadKey, limit: RECENT_THREAD_LIMIT, cursor },
        { rateLimitRetries: 0 },
      );
      const response = page === 0 ? yield* read : yield* read.pipe(Effect.catch(() => Effect.succeed(null)));
      if (!response) break;
      messages.push(...responseMessages(response));
      const metadata = isDynamicRecord(response.response_metadata) ? response.response_metadata : {};
      cursor = isString(metadata.next_cursor) && metadata.next_cursor ? metadata.next_cursor : undefined;
      if (!cursor) break;
    }
    return messages;
  });

  /** Slack messages as context, oldest first, with each mention named. */
  readonly #entries = Effect.fnUntraced(function* (
    this: SlackAdapter,
    messages: DynamicRecord[],
    withReplyCounts: boolean,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const raw = messages.map((message) => (isString(message.text) ? message.text : ""));
    const names = yield* mentionNames(
      raw.flatMap((text) => slackMentionIds(text, this.#botUserId)),
      (userId) => this.authorName(userId),
    );
    const entries: ContextEntry[] = [];
    for (const [index, message] of messages.entries()) {
      const ts = String(message.ts);
      const replies = withReplyCounts && typeof message.reply_count === "number" ? message.reply_count : 0;
      const text = withMentionNames(plainText(raw[index] ?? "", this.#botUserId), names);
      entries.push({
        id: ts,
        authorName: yield* this.#author(message),
        text: replies ? `${text} (thread with ${replies} replies)` : text,
        sentAt: new Date(Number(ts) * 1000).toISOString(),
      });
    }
    return entries.sort((left, right) => Number(left.id) - Number(right.id));
  });

  readonly #author = Effect.fnUntraced(function* (this: SlackAdapter, message: DynamicRecord) {
    if (message.user === this.#botUserId) return "OpenBot";
    if (message.bot_id !== undefined || !isString(message.user)) {
      const profile = isDynamicRecord(message.bot_profile) ? message.bot_profile.name : undefined;
      const name = isString(message.username) ? message.username : isString(profile) ? profile : "a bot";
      return `${name} (bot)`;
    }
    return yield* this.authorName(message.user);
  });

  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError> {
    return this.#api.download(file.url, destination, maxBytes);
  }

  readonly authorName = Effect.fnUntraced(function* (this: SlackAdapter, userId: string) {
    const cached = this.#names.get(userId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#names.set(userId, name);
    // Detached, so a caller with a deadline stops waiting at it. The lookup still completes the cache
    // entry, which a later caller then reads.
    yield* Effect.forkDetach(
      this.#api.call("users.info", { user: userId }).pipe(
        Effect.map((response) => {
          const user = isDynamicRecord(response.user) ? response.user : {};
          const profile = isDynamicRecord(user.profile) ? user.profile : {};
          for (const candidate of [profile.display_name, profile.real_name, user.real_name, user.name])
            if (isString(candidate) && candidate.trim()) return candidate.trim();
          return userId;
        }),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (isTemporaryLookupFailure(failure)) this.#names.delete(userId);
            return userId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  readonly placeName = Effect.fnUntraced(function* (this: SlackAdapter, platformChannelId: string) {
    const cached = this.#places.get(platformChannelId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#places.set(platformChannelId, name);
    // Detached for the same reason as `authorName`.
    yield* Effect.forkDetach(
      this.#api.call("conversations.info", { channel: platformChannelId }).pipe(
        Effect.map((response) =>
          isDynamicRecord(response.channel) && isString(response.channel.name)
            ? `#${response.channel.name}`
            : platformChannelId,
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (isTemporaryLookupFailure(failure)) this.#places.delete(platformChannelId);
            return platformChannelId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  /** The public and private channels that OpenBot is a member of: `chat:write` posts only there. */
  readonly places = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<MessagingPlace[], MessagingAdapterError> {
    const places: MessagingPlace[] = [];
    let cursor: string | undefined;
    do {
      // `users.conversations` gives only the bot's own channels, so a large workspace needs few pages.
      const page = yield* this.#api.call("users.conversations", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: CHANNEL_PAGE_LIMIT,
        cursor,
      });
      const channels = Array.isArray(page.channels) ? page.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && isString(channel.name))
          places.push({ id: channel.id, name: `#${channel.name}`, kind: channel.is_private ? "private" : "channel" });
      const next = isDynamicRecord(page.response_metadata) ? page.response_metadata.next_cursor : undefined;
      cursor = isString(next) && next && places.length < PLACES_LIMIT ? next : undefined;
    } while (cursor);
    return places.slice(0, PLACES_LIMIT);
  });

  readonly joinPublicPlaces = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    let cursor: string | undefined;
    do {
      const page = yield* this.#api.call("conversations.list", {
        types: "public_channel",
        exclude_archived: true,
        limit: CHANNEL_PAGE_LIMIT,
        cursor,
      });
      const channels = Array.isArray(page.channels) ? page.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && channel.is_member !== true) yield* this.joinPlace(channel.id);
      const next = isDynamicRecord(page.response_metadata) ? page.response_metadata.next_cursor : undefined;
      cursor = isString(next) && next ? next : undefined;
    } while (cursor);
  });

  readonly joinPlace = Effect.fnUntraced(function* (this: SlackAdapter, platformChannelId: string) {
    yield* this.#api
      .call("conversations.join", { channel: platformChannelId })
      .pipe(Effect.catch((failure) => (failure.cause instanceof SlackApiError ? Effect.void : Effect.fail(failure))));
  });

  /**
   * A marker, not Slack markup: status text is escaped as a whole, which would make `<@U…>` inert.
   * `#statusText` turns the marker back into a mention after the escape. The answer of an agent never
   * goes through it, so an answer cannot mention anyone.
   */
  mention(userId: string): string {
    return /^[A-Z0-9]+$/.test(userId) ? `\uE000@${userId}\uE000` : userId;
  }

  #statusText(text: string): string {
    return slackMrkdwn(text).replace(/\uE000@([A-Z0-9]+)\uE000/g, "<@$1>");
  }

  readonly #postText = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    text: string,
  ): Effect.fn.Return<string, MessagingAdapterError> {
    const response = yield* this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("chat.postMessage", "no_ts") });
    return response.ts;
  });

  /** Status text is written by the host, so it is only escaped. Buttons become Block Kit. */
  #content(body: MessageBody): DynamicRecord {
    const text = this.#statusText(body.text);
    if (!body.buttons?.length) return { text, blocks: [] };
    return {
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        {
          type: "actions",
          elements: body.buttons.map((button) => ({
            type: "button",
            action_id: BUTTON_ACTIONS[button.action],
            text: { type: "plain_text", text: button.label },
            value: button.token,
            ...(button.style ? { style: button.style } : {}),
          })),
        },
      ],
    };
  }
}

export interface SlackDriverOptions {
  /** Only tests change this. */
  origin?: string;
  /** The relay that brings the workspace's events. Without it, no workspace connects. */
  ingress?: MessagingIngress;
}

function responseMessages(response: DynamicRecord): DynamicRecord[] {
  return Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
}

/** Each workspace installed the OpenBot app, and its events come through the ingress relay. */
export function slackDriver(options: SlackDriverOptions = {}): MessagingDriver {
  return {
    platform: "slack",
    requiredCredential: "botToken",
    createAdapter(credentials, driverOptions) {
      return new SlackAdapter(credentials.botToken ?? "", { ...driverOptions, origin: options.origin });
    },
    createTransport(_credentials, identity) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.unsupported"));
      return new SlackEventsTransport({ identity, ingress: options.ingress });
    },
  };
}
