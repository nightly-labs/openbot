import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
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
import { plainText, SLACK_ACTION_IDS } from "./slack-events";
import { SlackEventsTransport } from "./slack-events-transport";
import { slackChunks, slackMrkdwn } from "./slack-render";
import { SlackApiError, SlackWebApi } from "./slack-web-api";

/** Slack's own limit for one uploaded file is 1 GB; the host holds its uploads to this. */
const UPLOAD_BYTES = 100 * 1024 * 1024;
const HISTORY_LIMIT = 100;

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
export class SlackAdapter implements MessagingAdapter {
  readonly platform = "slack" as const;
  readonly #api: SlackWebApi;
  readonly #names = new Map<string, Promise<string>>();
  readonly #places = new Map<string, Promise<string>>();
  #botUserId = "";

  constructor(botToken: string, options: MessagingDriverOptions & { origin?: string }) {
    this.#api = new SlackWebApi({ token: botToken, origin: options.origin, rateLimited: options.rateLimited });
  }

  async identify(): Promise<ConnectionIdentity> {
    const { payload, scopes } = await this.#api.authTest();
    const workspaceId = payload.team_id;
    const botUserId = payload.user_id;
    const botId = payload.bot_id;
    if (!isString(workspaceId) || !isString(botUserId) || !isString(botId))
      throw new SlackApiError("auth.test", "not_a_bot_token");
    const bot = await this.#api.call("bots.info", { bot: botId });
    const appId = isDynamicRecord(bot.bot) && isString(bot.bot.app_id) ? bot.bot.app_id : "";
    this.#botUserId = botUserId;
    return {
      workspaceId,
      workspaceName: isString(payload.team) ? payload.team : workspaceId,
      botUserId,
      appId,
      missingScopes: SLACK_BOT_SCOPES.filter((scope) => !scopes.includes(scope)),
    };
  }

  async post(target: MessageTarget, body: MessageBody): Promise<string> {
    const response = await this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      ...this.#content(body),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
    return response.ts;
  }

  async edit(target: MessageTarget, messageId: string, body: MessageBody): Promise<void> {
    await this.#api.call("chat.update", { channel: target.platformChannelId, ts: messageId, ...this.#content(body) });
  }

  async postPrivate(target: MessageTarget, userId: string, text: string): Promise<void> {
    await this.#api.call("chat.postEphemeral", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      user: userId,
      text: this.#statusText(text),
    });
  }

  async react(target: MessageTarget, messageId: string, reaction: StatusReaction, on: boolean): Promise<void> {
    try {
      await this.#api.call(on ? "reactions.add" : "reactions.remove", {
        channel: target.platformChannelId,
        timestamp: messageId,
        name: REACTIONS[reaction],
      });
    } catch (error) {
      // A reaction is only a signal. It is already there, or already gone.
      if (!(error instanceof SlackApiError && ["already_reacted", "no_reaction"].includes(error.code))) throw error;
    }
  }

  async postAnswer(target: MessageTarget, markdown: string, replaceMessageId: string | null): Promise<void> {
    const [first = "", ...rest] = slackChunks(slackMrkdwn(markdown));
    if (replaceMessageId) {
      try {
        await this.#api.call("chat.update", {
          channel: target.platformChannelId,
          ts: replaceMessageId,
          text: first,
          blocks: [],
        });
      } catch {
        await this.#api
          .call("chat.delete", { channel: target.platformChannelId, ts: replaceMessageId })
          .catch(() => undefined);
        await this.#postText(target, first);
      }
    } else await this.#postText(target, first);
    for (const chunk of rest) await this.#postText(target, chunk);
  }

  async upload(target: MessageTarget, files: MessagingAnswerFile[]): Promise<string[]> {
    const skipped: string[] = [];
    const uploaded: Array<{ id: string; title: string }> = [];
    for (const file of files) {
      try {
        const bytes = await readFile(file.path);
        if (bytes.byteLength > UPLOAD_BYTES || bytes.byteLength === 0) {
          skipped.push(file.name);
          continue;
        }
        const ticket = await this.#api.call("files.getUploadURLExternal", {
          filename: file.name,
          length: String(bytes.byteLength),
        });
        if (!isString(ticket.upload_url) || !isString(ticket.file_id))
          throw new SlackApiError("files", "no_upload_url");
        await this.#api.uploadBytes(ticket.upload_url, bytes, file.mimeType);
        uploaded.push({ id: ticket.file_id, title: file.name });
      } catch {
        skipped.push(file.name);
      }
    }
    if (uploaded.length)
      await this.#api.call("files.completeUploadExternal", {
        files: uploaded,
        channel_id: target.platformChannelId,
        thread_ts: target.replyThreadId ?? undefined,
      });
    return skipped;
  }

  async history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Promise<ContextEntry[]> {
    // Every conversation is a thread, in a direct message too.
    const response = await this.#api.call("conversations.replies", {
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
        authorName: await this.authorName(user),
        text: plainText(isString(message.text) ? message.text : "", this.#botUserId),
        sentAt: new Date(Number(ts) * 1000).toISOString(),
      });
    }
    return entries.sort((left, right) => Number(left.id) - Number(right.id));
  }

  download(file: InboundFile, destination: string, maxBytes: number): Promise<void> {
    return this.#api.download(file.url, destination, maxBytes);
  }

  authorName(userId: string): Promise<string> {
    let name = this.#names.get(userId);
    if (!name) {
      name = this.#api
        .call("users.info", { user: userId })
        .then((response) => {
          const user = isDynamicRecord(response.user) ? response.user : {};
          const profile = isDynamicRecord(user.profile) ? user.profile : {};
          for (const candidate of [profile.display_name, profile.real_name, user.real_name, user.name])
            if (isString(candidate) && candidate.trim()) return candidate.trim();
          return userId;
        })
        .catch(() => userId);
      this.#names.set(userId, name);
    }
    return name;
  }

  placeName(platformChannelId: string): Promise<string> {
    let name = this.#places.get(platformChannelId);
    if (!name) {
      name = this.#api
        .call("conversations.info", { channel: platformChannelId })
        .then((response) =>
          isDynamicRecord(response.channel) && isString(response.channel.name)
            ? `#${response.channel.name}`
            : platformChannelId,
        )
        .catch(() => platformChannelId);
      this.#places.set(platformChannelId, name);
    }
    return name;
  }

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

  async #postText(target: MessageTarget, text: string): Promise<void> {
    await this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

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
    createAdapter(credentials, driverOptions) {
      return new SlackAdapter(credentials.botToken ?? "", { ...driverOptions, origin: options.origin });
    },
    createTransport(_credentials, identity) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.unsupported"));
      return new SlackEventsTransport({ identity, ingress: options.ingress });
    },
  };
}
