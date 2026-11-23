import { decodeXReplyPayload, type XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * The posts from X that wait for the user's server. X posts the reply at once; the worker keeps the post
 * here, also over a browser restart, until the server has it, and tries again with a growing wait. Each
 * post keeps one `clientMessageId`, and the server answers a repeated id with the first receipt for a
 * day. So a post that no attempt can have sent waits up to a week, and a post that an attempt may have
 * sent (its answer was lost) is tried only within that day, so no retry makes a second thread.
 */
export const OUTBOX_KEY = "openbot.x-outbox.v1";
/** How long a post waits when no attempt reached the server. */
export const OUTBOX_LIFE_MS = 7 * 24 * 60 * 60 * 1_000;
/** Under the server's day of repeated ids, from the first attempt that may have reached it. */
export const REPEAT_SAFE_MS = 23 * 60 * 60 * 1_000;

export interface QueuedPost {
  /** The `clientMessageId` of every attempt. */
  id: string;
  payload: XReplyPayload;
  createdAt: number;
  attempts: number;
  /** When the worker tries again. */
  nextAt: number;
  /** The last failure, for the panel. */
  error: string | null;
  /** The first failed attempt that may have reached the server. Null while none can have. */
  reachedAt: number | null;
}

/** True while a retry can still be sent: in its week, and within a day of an attempt that may have arrived. */
export function stillSendable(post: QueuedPost, now: number): boolean {
  if (now - post.createdAt >= OUTBOX_LIFE_MS) return false;
  return post.reachedAt === null || now - post.reachedAt < REPEAT_SAFE_MS;
}

function decodeQueuedPost(value: unknown): QueuedPost | null {
  if (!isDynamicRecord(value) || !isString(value.id)) return null;
  const payload = decodeXReplyPayload(value.payload);
  const numbers = [value.createdAt, value.attempts, value.nextAt];
  if (!payload || !numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
  return {
    id: value.id,
    payload,
    createdAt: Number(value.createdAt),
    attempts: Number(value.attempts),
    nextAt: Number(value.nextAt),
    error: isString(value.error) ? value.error : null,
    reachedAt: typeof value.reachedAt === "number" && Number.isFinite(value.reachedAt) ? value.reachedAt : null,
  };
}

/** The stored queue. An entry that does not decode is left out, so one bad entry blocks nothing. */
export function decodeOutbox(value: unknown): QueuedPost[] {
  return Array.isArray(value) ? value.flatMap((entry) => decodeQueuedPost(entry) ?? []) : [];
}

export async function readOutbox(): Promise<QueuedPost[]> {
  return decodeOutbox((await chrome.storage.local.get(OUTBOX_KEY))[OUTBOX_KEY]);
}

export async function writeOutbox(posts: readonly QueuedPost[]): Promise<void> {
  if (!posts.length) {
    await chrome.storage.local.remove(OUTBOX_KEY);
    return;
  }
  await chrome.storage.local.set({
    [OUTBOX_KEY]: posts.map((post) => ({
      id: post.id,
      payload: {
        message: post.payload.message,
        pageUrl: post.payload.pageUrl,
        replyTo: post.payload.replyTo,
        posts: post.payload.posts.map((entry) => ({ ...entry, media: [...entry.media] })),
      },
      createdAt: post.createdAt,
      attempts: post.attempts,
      nextAt: post.nextAt,
      error: post.error,
      reachedAt: post.reachedAt,
    })),
  });
}

/** 30 s, 1 min, 2 min, 5 min, 10 min, then every 30 min. */
const WAITS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];

export function retryWait(attempts: number): number {
  return WAITS_MS[Math.min(attempts, WAITS_MS.length) - 1] ?? WAITS_MS[0] ?? 30_000;
}
