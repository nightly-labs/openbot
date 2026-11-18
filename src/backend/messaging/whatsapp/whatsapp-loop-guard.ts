import { sourceText } from "@openbot/i18n/source";
import { CANCEL_TEXT, chatFailureReason } from "../messaging-types";

/**
 * OpenBot 0.70 and older ended each post in the owner's own chat with a line of blank braille
 * characters (U+2800). A person does not type this line, so a message with it is another OpenBot's post.
 */
const OLD_SPACER = /\n⠀{8,}\s*$/u;
/** The waiting post of OpenBot 0.72 and older, which another OpenBot on the same number still posts. */
const OLD_QUEUED = "Waiting: OpenBot is working on another request. The answer comes here.";
/** The limit counts spans of this length that have a request, so a burst of messages counts once. */
const SELF_CHAT_SPAN_MS = 10_000;
/**
 * A request in more spans than the limit of a window is not a person: it is a loop, such as two
 * OpenBots that answer each other's posts. A fast loop fills the short window, and slower loops of
 * long agent turns fill the longer ones: a person does not write each minute for six hours. A person
 * who writes a burst, or forwards many files at once, fills only a few spans.
 */
const SELF_CHAT_LIMITS = [
  { windowMs: 10 * 60_000, maxSpans: 30 },
  { windowMs: 60 * 60_000, maxSpans: 120 },
  { windowMs: 6 * 60 * 60_000, maxSpans: 360 },
] as const;
const SELF_CHAT_KEPT_MS = 6 * 60 * 60_000;
/** How long the owner's own chat gets no answers after the limit. The other side of a loop stops in this time. */
const SELF_CHAT_PAUSE_MS = 10 * 60_000;

let known: { posts: ReadonlySet<string>; menus: readonly string[] } | null = null;

/** The posts that only OpenBot writes in the owner's own chat, as WhatsApp gives them back. */
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
    // A status post with a numbered menu, such as "Working on it…" or an approval request, ends with it.
    menus: [
      `\n\n${sourceText("status.messaging.whatsappStopMenu")}`,
      `\n\n${sourceText("status.messaging.whatsappApprovalMenu")}`,
    ],
  };
  return known;
}

/**
 * True for a message in the owner's own chat that another OpenBot posted: one on another computer or
 * server that is linked to the same number. Its message ids are not this OpenBot's, so only its text
 * shows it. Answered as a request, each OpenBot would answer the other's posts without end.
 */
export function isOtherOpenBotPost(text: string): boolean {
  const { posts, menus } = openBotPosts();
  const trimmed = text.trim();
  return (
    OLD_SPACER.test(text) ||
    posts.has(trimmed) ||
    // The reason of a failed request, which a chat gets in place of the general failure text.
    chatFailureReason(trimmed) !== null ||
    menus.some((menu) => trimmed.endsWith(menu))
  );
}

/**
 * Stops a loop in the owner's own chat. An agent's answers that another OpenBot reads as requests look
 * like a person's messages, so only their rate shows the loop. Over the limit, the chat gets no answers
 * for a pause, and the other side, which gets no new posts, stops. A stop request always goes through.
 */
export class WhatsAppSelfChatLimit {
  #spans = new Set<number>();
  #pausedUntil = 0;

  /**
   * For a request sent at `at`: "allow" when it gets an answer, "pause" for the one that starts a
   * pause, and "paused" during it.
   */
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
