import { sourceText } from "@openbot/i18n/source";

/**
 * OpenBot 0.70 and older ended each post in the owner's own chat with a line of blank braille
 * characters (U+2800). A person does not type this line, so a message with it is another OpenBot's post.
 */
const OLD_SPACER = /\n⠀{8,}\s*$/u;
/** Requests in the owner's own chat within this time count toward the limit. */
const SELF_CHAT_WINDOW_MS = 10 * 60_000;
/**
 * More requests than this in the window is not a person: it is a loop, such as two OpenBots that
 * answer each other's posts. A loop starts about five turns in a minute.
 */
const SELF_CHAT_MAX_REQUESTS = 30;
/** How long the owner's own chat gets no answers after the limit. The other side of a loop stops in this time. */
const SELF_CHAT_PAUSE_MS = 10 * 60_000;

let posts: ReadonlySet<string> | null = null;

/** The posts that only OpenBot writes in the owner's own chat, as WhatsApp gives them back. */
function openBotPosts(): ReadonlySet<string> {
  if (posts) return posts;
  const stop = sourceText("status.messaging.whatsappStopMenu");
  const statuses = [
    sourceText("status.messaging.queued"),
    sourceText("status.messaging.busy"),
    sourceText("status.messaging.failed"),
    sourceText("status.messaging.noAnswer"),
    sourceText("status.messaging.delegated"),
    sourceText("status.messaging.whatsappNoAgent"),
  ];
  posts = new Set([
    // "Working on it…" alone could be a person's own note, so it counts only with its stop menu.
    `${sourceText("status.messaging.working")}\n\n${stop}`,
    ...statuses,
    ...statuses.map((status) => `${status}\n\n${stop}`),
    sourceText("status.messaging.whatsappWelcomeOwn"),
    sourceText("status.messaging.whatsappWelcomeDedicated"),
    sourceText("status.messaging.whatsappOtherOpenBot"),
    sourceText("status.messaging.whatsappPaused"),
  ]);
  return posts;
}

/**
 * True for a message in the owner's own chat that another OpenBot posted: one on another computer or
 * server that is linked to the same number. Its message ids are not this OpenBot's, so only its text
 * shows it. Answered as a request, each OpenBot would answer the other's posts without end.
 */
export function isOtherOpenBotPost(text: string): boolean {
  return OLD_SPACER.test(text) || openBotPosts().has(text.trim());
}

/**
 * Stops a loop in the owner's own chat. An agent's answers that another OpenBot reads as requests look
 * like a person's messages, so only their rate shows the loop. Over the limit, the chat gets no answers
 * for a pause, and the other side, which gets no new posts, stops.
 */
export class WhatsAppSelfChatLimit {
  #times: number[] = [];
  #pausedUntil = 0;

  /** "allow" for a request that gets an answer, "pause" for the one that starts a pause, "paused" during it. */
  check(now: number): "allow" | "pause" | "paused" {
    if (now < this.#pausedUntil) return "paused";
    this.#times = this.#times.filter((at) => now - at < SELF_CHAT_WINDOW_MS);
    if (this.#times.length >= SELF_CHAT_MAX_REQUESTS) {
      this.#times = [];
      this.#pausedUntil = now + SELF_CHAT_PAUSE_MS;
      return "pause";
    }
    this.#times.push(now);
    return "allow";
  }
}
