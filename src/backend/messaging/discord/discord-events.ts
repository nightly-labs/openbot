import {
  DISCORD_CUSTOM_ID_PREFIX,
  type DiscordInboundAttachment,
  type DiscordInboundInteraction,
  type DiscordInboundMessage,
} from "@openbot/contracts/signal-protocol/discord-api";
import type { InboundAction, InboundFile, InboundMessage } from "../messaging-types";

const DISCORD_BUTTON_ACTIONS = ["accept", "decline", "stop"] as const;
type DiscordButtonAction = (typeof DISCORD_BUTTON_ACTIONS)[number];

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
    files: [...message.attachments, ...(quote?.attachments ?? [])].map(inboundFile),
    authorRoleIds: message.authorRoleIds,
    replyTo: quote
      ? {
          authorName: quote.authorName,
          text: discordContextText(discordPlainText(quote.content), quote.attachments, quote.embeds, quote.forwarded),
          mentionedUserIds: discordMentionIds([quote.content, ...quote.embeds].join("\n")),
          sentAt: quote.sentAt,
        }
      : null,
  };
}

export function discordContextText(
  text: string,
  attachments: DiscordInboundAttachment[],
  embeds: string[],
  forwarded: boolean,
): string {
  const files = attachments.length ? `(Attached files: ${attachments.map((file) => file.filename).join(", ")})` : "";
  const embedTexts = embeds.map((embed) => `(Embed)\n${discordPlainText(embed)}`);
  const forward = !forwarded
    ? ""
    : text || files || embeds.length
      ? "(Forwarded message)"
      : "(Forwarded message: Discord did not give its text or files)";
  return [forward, text, files, ...embedTexts].filter(Boolean).join("\n");
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

export function discordCustomId(action: DiscordButtonAction, token: string): string {
  return `${DISCORD_CUSTOM_ID_PREFIX}${action}:${token}`;
}

function isButtonAction(value: string | undefined): value is DiscordButtonAction {
  return DISCORD_BUTTON_ACTIONS.some((action) => action === value);
}

export function discordMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@!?([0-9]+)>/g)].map((match) => match[1] ?? ""))].filter(Boolean);
}

export function discordPlainText(text: string): string {
  return text
    .replace(/<@!?([0-9]+)>/g, "@$1")
    .replace(/<@&([0-9]+)>/g, "@role:$1")
    .replace(/<#([0-9]+)>/g, "#$1")
    .replace(/<a?:([A-Za-z0-9_]+):[0-9]+>/g, ":$1:")
    .trim();
}
