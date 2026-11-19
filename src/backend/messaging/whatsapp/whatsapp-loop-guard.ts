import { sourceText } from "@openbot/i18n/source";
import { CANCEL_TEXT, chatFailureReason } from "../messaging-types";

const OLD_SPACER = /\n⠀{8,}\s*$/u;
const OLD_QUEUED = "Waiting: OpenBot is working on another request. The answer comes here.";
const SELF_CHAT_SPAN_MS = 10_000;
const SELF_CHAT_LIMITS = [
  { windowMs: 10 * 60_000, maxSpans: 30 },
  { windowMs: 60 * 60_000, maxSpans: 120 },
  { windowMs: 6 * 60 * 60_000, maxSpans: 360 },
] as const;
const SELF_CHAT_KEPT_MS = 6 * 60 * 60_000;
const SELF_CHAT_PAUSE_MS = 10 * 60_000;

let known: { posts: ReadonlySet<string>; menus: readonly string[] } | null = null;

function openBotPosts(): { posts: ReadonlySet<string>; menus: readonly string[] } {
  known ??= {
    posts: new Set([
      OLD_QUEUED,
      sourceText("status.messaging.queued"),
      sourceText("status.messaging.busy"),
      sourceText("status.messaging.failed"),
      sourceText("status.messaging.noAnswer"),
      sourceText("status.messaging.delegated"),
      sourceText("status.messaging.whatsappNoAgent"),
      sourceText("status.messaging.whatsappWelcomeOwn"),
      sourceText("status.messaging.whatsappWelcomeDedicated"),
      sourceText("status.messaging.whatsappOtherOpenBot"),
      sourceText("status.messaging.whatsappPaused"),
    ]),
    menus: [
      `\n\n${sourceText("status.messaging.whatsappStopMenu")}`,
      `\n\n${sourceText("status.messaging.whatsappApprovalMenu")}`,
    ],
  };
  return known;
}

export function isOtherOpenBotPost(text: string): boolean {
  const { posts, menus } = openBotPosts();
  const trimmed = text.trim();
  return (
    OLD_SPACER.test(text) ||
    posts.has(trimmed) ||
    chatFailureReason(trimmed) !== null ||
    menus.some((menu) => trimmed.endsWith(menu))
  );
}

export class WhatsAppSelfChatLimit {
  #spans = new Set<number>();
  #pausedUntil = 0;

  check(at: number, text: string): "allow" | "pause" | "paused" {
    if (CANCEL_TEXT.test(text.trim())) return "allow";
    if (at < this.#pausedUntil) return "paused";
    const span = Math.floor(at / SELF_CHAT_SPAN_MS);
    const spanOf = (msAgo: number) => Math.floor((at - msAgo) / SELF_CHAT_SPAN_MS);
    for (const kept of this.#spans) if (kept <= spanOf(SELF_CHAT_KEPT_MS)) this.#spans.delete(kept);
    this.#spans.add(span);
    const over = SELF_CHAT_LIMITS.some(({ windowMs, maxSpans }) => {
      const oldest = spanOf(windowMs);
      let count = 0;
      for (const kept of this.#spans) if (kept > oldest) count += 1;
      return count > maxSpans;
    });
    if (!over) return "allow";
    this.#spans.clear();
    this.#pausedUntil = at + SELF_CHAT_PAUSE_MS;
    return "pause";
  }
}
