import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { InboundAction, InboundFile, InboundMessage } from "../messaging-types";

/** The Block Kit action ids of the buttons the agent posts. */
export const SLACK_ACTION_IDS = {
  accept: "openbot_accept",
  decline: "openbot_decline",
  stop: "openbot_stop",
} as const;

/**
 * One Events API payload as a message for OpenBot, or null when it does not address OpenBot.
 *
 * - `app_mention` in a channel starts or continues the thread it is in.
 * - A direct message always addresses OpenBot. OpenBot answers in a thread under it, so each
 *   top-level direct message is its own conversation, and the router picks its agent.
 * - A reply in a thread without a mention counts only in a thread that an agent already answers
 *   (`requiresLink`). A reply with a mention also arrives as `app_mention`, and both have the same
 *   dedup key, so it runs once.
 * - Messages of bots, of OpenBot itself, edits, deletions and joins are ignored.
 */
export function slackInboundMessage(payload: unknown, workspaceId: string, botUserId: string): InboundMessage | null {
  if (!isDynamicRecord(payload) || payload.team_id !== workspaceId) return null;
  const event = payload.event;
  if (!isDynamicRecord(event)) return null;
  const channel = event.channel;
  const ts = event.ts;
  const user = event.user;
  if (!isString(channel) || !isString(ts) || !isString(user)) return null;
  if (event.bot_id !== undefined || user === botUserId) return null;
  if (event.subtype !== undefined && event.subtype !== "file_share") return null;
  const threadTs = isString(event.thread_ts) ? event.thread_ts : null;
  const base = {
    dedupKey: `${channel}:${ts}`,
    platformChannelId: channel,
    platformMessageId: ts,
    authorId: user,
    text: plainText(isString(event.text) ? event.text : "", botUserId),
    files: inboundFiles(event.files),
  };
  if (event.type === "app_mention") {
    const threadKey = threadTs ?? ts;
    return {
      ...base,
      threadKey,
      target: { platformChannelId: channel, replyThreadId: threadKey },
      isDirect: false,
      requiresLink: false,
    };
  }
  if (event.type !== "message") return null;
  if (event.channel_type === "im") {
    const threadKey = threadTs ?? ts;
    return {
      ...base,
      threadKey,
      target: { platformChannelId: channel, replyThreadId: threadKey },
      isDirect: true,
      requiresLink: false,
    };
  }
  if (!threadTs || threadTs === ts) return null;
  return {
    ...base,
    threadKey: threadTs,
    target: { platformChannelId: channel, replyThreadId: threadTs },
    isDirect: false,
    requiresLink: true,
  };
}

/** One `block_actions` payload as a button press on an OpenBot message, or null. */
export function slackInboundAction(payload: unknown, workspaceId: string): InboundAction | null {
  if (!isDynamicRecord(payload) || payload.type !== "block_actions") return null;
  const team = payload.team;
  const user = payload.user;
  const channel = payload.channel;
  const message = payload.message;
  if (!isDynamicRecord(team) || team.id !== workspaceId) return null;
  if (!isDynamicRecord(user) || !isString(user.id)) return null;
  if (!isDynamicRecord(channel) || !isString(channel.id)) return null;
  if (!isDynamicRecord(message) || !isString(message.ts)) return null;
  const action = Array.isArray(payload.actions) ? payload.actions[0] : undefined;
  if (!isDynamicRecord(action) || !isString(action.value)) return null;
  const target = {
    platformChannelId: channel.id,
    replyThreadId: isString(message.thread_ts) ? message.thread_ts : null,
  };
  const common = { token: action.value, actorId: user.id, target, platformMessageId: message.ts };
  switch (action.action_id) {
    case SLACK_ACTION_IDS.accept:
      return { type: "approval", decision: "accept", ...common };
    case SLACK_ACTION_IDS.decline:
      return { type: "approval", decision: "decline", ...common };
    case SLACK_ACTION_IDS.stop:
      return { type: "stop", ...common };
    default:
      return null;
  }
}

function inboundFiles(value: unknown): InboundFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDynamicRecord).flatMap((file: DynamicRecord) =>
    isString(file.id) && isString(file.url_private_download)
      ? [
          {
            id: file.id,
            name: isString(file.name) ? file.name : file.id,
            mimeType: isString(file.mimetype) ? file.mimetype : "application/octet-stream",
            size: isNumber(file.size) ? file.size : 0,
            url: file.url_private_download,
          },
        ]
      : [],
  );
}

/**
 * Slack's markup as plain text: OpenBot's own mention goes, other mentions stay as ids, a
 * channel link keeps its name, a link keeps its label and address, and the three escaped
 * characters come back.
 */
export function plainText(text: string, botUserId: string): string {
  return text
    .replaceAll(`<@${botUserId}>`, "")
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}
