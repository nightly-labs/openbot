import {
  DISCORD_CUSTOM_ID_PREFIX,
  type DiscordInboundAttachment,
  type DiscordInboundInteraction,
  type DiscordInboundMessage,
} from "@openbot/contracts/signal-protocol/discord-api";
import type { InboundAction, InboundFile, InboundMessage } from "../messaging-types";

/** The actions of the buttons OpenBot posts, as the middle part of their custom id. */
const DISCORD_BUTTON_ACTIONS = ["accept", "decline", "stop"] as const;
type DiscordButtonAction = (typeof DISCORD_BUTTON_ACTIONS)[number];

/**
 * One guild message that mentions OpenBot, as a message for OpenBot. Signal passes on only such
 * messages, with OpenBot's own mention taken out.
 *
 * A conversation is a reply chain, named by its first message. OpenBot replies to that first
 * message with every post, so a reply to an OpenBot post names the first message as `rootId`. A
 * message that does not reply to OpenBot starts a new conversation.
 */
export function discordInboundMessage(message: DiscordInboundMessage): InboundMessage {
  const reply = message.replyTo;
  const threadKey = reply?.authorIsBot ? (reply.rootId ?? reply.messageId) : message.id;
  const quote = reply?.quote ?? null;
  return {
    dedupKey: `${message.channelId}:${message.id}`,
    platformChannelId: message.channelId,
    threadKey,
    target: { platformChannelId: message.channelId, replyThreadId: threadKey },
    platformMessageId: message.id,
    isDirect: false,
    requiresLink: false,
    authorId: message.authorId,
    text: discordPlainText(message.content),
    mentionedUserIds: discordMentionIds(message.content),
    // The replied-to message's files are context too, as its text is.
    files: [...message.attachments, ...(quote?.attachments ?? [])].map(inboundFile),
    authorRoleIds: message.authorRoleIds,
    // A reply to a person's message starts a new conversation, so it has no earlier messages: the
    // replied-to message is its context.
    replyTo: quote
      ? {
          authorName: quote.authorName,
          // Names its files, so that the agent knows which of the message's files are the replied-to ones.
          text: discordContextText(discordPlainText(quote.content), quote.attachments, quote.forwarded),
          mentionedUserIds: discordMentionIds(quote.content),
          sentAt: quote.sentAt,
        }
      : null,
  };
}

/**
 * The context text of a Discord message: its text and the names of its files. A forward says that
 * it is one, and says so too when Discord gave neither, such as without the Message Content intent.
 */
export function discordContextText(text: string, attachments: DiscordInboundAttachment[], forwarded: boolean): string {
  const files = attachments.length ? `(Attached files: ${attachments.map((file) => file.filename).join(", ")})` : "";
  const forward = !forwarded
    ? ""
    : text || files
      ? "(Forwarded message)"
      : "(Forwarded message: Discord did not give its text or files)";
  return [forward, text, files].filter(Boolean).join("\n");
}

export function inboundFile(attachment: DiscordInboundAttachment): InboundFile {
  return {
    id: attachment.id,
    name: attachment.filename,
    mimeType: attachment.contentType ?? "application/octet-stream",
    size: attachment.size,
    url: attachment.url,
  };
}

/** One press of an OpenBot button, or null for a custom id that OpenBot did not make. */
export function discordInboundAction(interaction: DiscordInboundInteraction): InboundAction | null {
  if (!interaction.customId.startsWith(DISCORD_CUSTOM_ID_PREFIX)) return null;
  const [action, token, extra] = interaction.customId.slice(DISCORD_CUSTOM_ID_PREFIX.length).split(":");
  if (!token || extra !== undefined || !isButtonAction(action)) return null;
  const common = {
    token,
    actorId: interaction.userId,
    target: { platformChannelId: interaction.channelId, replyThreadId: interaction.replyToId },
    platformMessageId: interaction.messageId,
    replyHandle: interaction.id,
  };
  if (action === "stop") return { type: "stop", ...common };
  return { type: "approval", decision: action, ...common };
}

/** The custom id of one OpenBot button. */
export function discordCustomId(action: DiscordButtonAction, token: string): string {
  return `${DISCORD_CUSTOM_ID_PREFIX}${action}:${token}`;
}

function isButtonAction(value: string | undefined): value is DiscordButtonAction {
  return DISCORD_BUTTON_ACTIONS.some((action) => action === value);
}

/** The users that Discord markup mentions. `discordPlainText` writes each as `@<id>`. */
export function discordMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@!?([0-9]+)>/g)].map((match) => match[1] ?? ""))].filter(Boolean);
}

/**
 * Discord's markup as plain text: a user, role or channel mention keeps its id, and a custom emoji
 * keeps its name.
 */
export function discordPlainText(text: string): string {
  return text
    .replace(/<@!?([0-9]+)>/g, "@$1")
    .replace(/<@&([0-9]+)>/g, "@role:$1")
    .replace(/<#([0-9]+)>/g, "#$1")
    .replace(/<a?:([A-Za-z0-9_]+):[0-9]+>/g, ":$1:")
    .trim();
}
