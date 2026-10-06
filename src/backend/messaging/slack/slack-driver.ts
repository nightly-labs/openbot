import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
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
import { MessagingAdapterError } from "../messaging-types";
import { plainText, SLACK_ACTION_IDS } from "./slack-events";
import { SlackEventsTransport } from "./slack-events-transport";
import { slackChunks, slackMrkdwn } from "./slack-render";
import { SlackApiError, SlackWebApi } from "./slack-web-api";

/** Slack's own limit for one uploaded file is 1 GB; the host holds its uploads to this. */
const UPLOAD_BYTES = 100 * 1024 * 1024;
const HISTORY_LIMIT = 100;
const CHANNEL_PAGE_LIMIT = 200;

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
    if (replaceMessageId) {
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
        yield* this.#postText(target, first);
      }
    } else yield* this.#postText(target, first);
    for (const chunk of rest) yield* this.#postText(target, chunk);
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
    const entries: ContextEntry[] = [];
    for (const message of messages) {
      const ts = message.ts;
      const user = message.user;
      if (!isString(ts) || !isString(user) || user === this.#botUserId || message.bot_id !== undefined) continue;
      if (Number(ts) >= Number(beforeId) || (afterId && Number(ts) <= Number(afterId))) continue;
      entries.push({
        id: ts,
        authorName: yield* this.authorName(user),
        text: plainText(isString(message.text) ? message.text : "", this.#botUserId),
        sentAt: new Date(Number(ts) * 1000).toISOString(),
      });
    }
    return entries.sort((left, right) => Number(left.id) - Number(right.id));
  });

  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError> {
    return this.#api.download(file.url, destination, maxBytes);
  }

  readonly authorName = Effect.fnUntraced(function* (this: SlackAdapter, userId: string) {
    const cached = this.#names.get(userId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#names.set(userId, name);
    const result = yield* this.#api.call("users.info", { user: userId }).pipe(
      Effect.map((response) => {
        const user = isDynamicRecord(response.user) ? response.user : {};
        const profile = isDynamicRecord(user.profile) ? user.profile : {};
        for (const candidate of [profile.display_name, profile.real_name, user.real_name, user.name])
          if (isString(candidate) && candidate.trim()) return candidate.trim();
        return userId;
      }),
      Effect.catch(() => Effect.succeed(userId)),
    );
    yield* Deferred.succeed(name, result);
    return result;
  }, Effect.uninterruptible);

  readonly placeName = Effect.fnUntraced(function* (this: SlackAdapter, platformChannelId: string) {
    const cached = this.#places.get(platformChannelId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#places.set(platformChannelId, name);
    const result = yield* this.#api.call("conversations.info", { channel: platformChannelId }).pipe(
      Effect.map((response) =>
        isDynamicRecord(response.channel) && isString(response.channel.name)
          ? `#${response.channel.name}`
          : platformChannelId,
      ),
      Effect.catch(() => Effect.succeed(platformChannelId)),
    );
    yield* Deferred.succeed(name, result);
    return result;
  }, Effect.uninterruptible);

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
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
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

function adapterIo<A>(run: () => Promise<A>): Effect.Effect<A, MessagingAdapterError> {
  return Effect.tryPromise({ try: run, catch: (cause) => new MessagingAdapterError({ cause }) });
}
