import { decodeXReplyPayload, type XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export const OUTBOX_KEY = "openbot.x-outbox.v1";
const OUTBOX_LIFE_MS = 7 * 24 * 60 * 60 * 1_000;
const REPEAT_SAFE_MS = 23 * 60 * 60 * 1_000;

export interface QueuedPost {
  id: string;
  payload: XReplyPayload;
  createdAt: number;
  attempts: number;
  nextAt: number;
  error: string | null;
  reachedAt: number | null;
}

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

function decodeOutbox(value: unknown): QueuedPost[] {
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

const WAITS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];

export function retryWait(attempts: number): number {
  return WAITS_MS[Math.min(attempts, WAITS_MS.length) - 1] ?? WAITS_MS[0] ?? 30_000;
}
