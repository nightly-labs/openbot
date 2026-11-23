import type { XPost, XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { currentText } from "@openbot/ui/text";

export function xPostMessage(payload: XReplyPayload): string {
  const { t } = currentText();
  const before = payload.posts.slice(0, payload.replyTo);
  const target = payload.posts[payload.replyTo];
  const after = payload.posts.slice(payload.replyTo + 1);
  const parts = [payload.message.trim() || t("extension.x.message.empty")];
  if (before.length) parts.push(`${t("extension.x.message.before")}\n\n${before.map(postBlock).join("\n\n")}`);
  if (target) parts.push(`${t("extension.x.message.answering")}\n\n${postBlock(target)}`);
  if (after.length) parts.push(`${t("extension.x.message.after")}\n\n${after.map(postBlock).join("\n\n")}`);
  const text = parts.join("\n\n");
  return text.length > INPUT_LIMITS.messageText ? `${text.slice(0, INPUT_LIMITS.messageText - 1)}…` : text;
}

function postBlock(post: XPost): string {
  const { t } = currentText();
  const time = post.time && !Number.isNaN(Date.parse(post.time)) ? new Date(post.time).toLocaleString() : "";
  const head = [`**${post.authorName || post.handle}**`, post.authorName ? post.handle : "", time]
    .filter(Boolean)
    .join(" · ");
  const lines = [head];
  if (post.url) lines.push(post.url);
  if (post.text) lines.push(quote(post.text));
  if (post.article) lines.push(`${t("extension.x.message.article")}\n${quote(post.article)}`);
  if (post.media.length) lines.push(`${t("extension.x.message.pictures")} ${post.media.join(" ")}`);
  return lines.join("\n");
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
