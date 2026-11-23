import type { XPost, XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { currentText } from "@openbot/ui/text";

export function xPostMessage(payload: XReplyPayload): string {
  const { t } = currentText();
  const before = payload.posts.slice(0, payload.replyTo);
  const target = payload.posts[payload.replyTo];
  const after = payload.posts.slice(payload.replyTo + 1);
  const parts = [payload.message.trim() || t("extension.x.message.empty")];
  if (before.length)
    parts.push(`${t("extension.x.message.before")}\n\n${before.map((post) => postBlock(post, true)).join("\n\n")}`);
  if (target) parts.push(`${t("extension.x.message.answering")}\n\n${postBlock(target, false)}`);
  if (after.length)
    parts.push(`${t("extension.x.message.after")}\n\n${after.map((post) => postBlock(post, true)).join("\n\n")}`);
  const text = parts.join("\n\n");
  const link = target?.url ? `${t("extension.x.message.link")} ${target.url}` : "";
  const room = INPUT_LIMITS.messageText - (link ? link.length + 2 : 0);
  const body = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  return link ? `${body}\n\n${link}` : body;
}

function postBlock(post: XPost, withLink: boolean): string {
  const { t, format } = currentText();
  const time =
    post.time && !Number.isNaN(Date.parse(post.time))
      ? format.date(new Date(post.time), { dateStyle: "medium", timeStyle: "short" })
      : "";
  const author =
    post.authorName && post.handle ? `${post.authorName} (${post.handle})` : post.authorName || post.handle;
  const head = [author, time].filter(Boolean).join(" · ");
  const lines = [head];
  if (withLink && post.url) lines.push(post.url);
  if (post.text) lines.push(quote(post.text));
  if (post.article) lines.push(`${t("extension.x.message.article")}\n${quote(post.article)}`);
  if (post.media.length) lines.push(`${t("extension.x.message.pictures")} ${post.media.join(" ")}`);
  return lines.join("\n");
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ""))
    .join("\n");
