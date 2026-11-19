import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";
import { create } from "zustand";

import { openStorePage } from "@/features/app-update/model/app-update";
import { devShowRatingAsk } from "@/shared/lib/dev-feature-overrides";
import { localDay } from "@/shared/lib/local-day";

/**
 * When home asks for a rating. The phone counts the days on which home showed, and asks only after
 * real use: on `MIN_USE_DAYS` different days, and `MIN_AGE_MS` after the first of them. After a
 * "Not now" it waits `COOLDOWN_MS`. A rating or sent feedback ends the asks on this phone.
 * All of it stays on this phone.
 */
const key = "openbot.mobile.ratingAsk.v1";
const MIN_USE_DAYS = 5;
const DAY_MS = 24 * 60 * 60_000;
const MIN_AGE_MS = 7 * DAY_MS;
const COOLDOWN_MS = 60 * DAY_MS;

// A post to the maker on X, as the desktop app's feedback link prepares it. The X app opens when it is
// installed; the web page is the fallback. The user edits the text before posting.
const X_POST_TEXT = "Feedback for OpenBot @norbertbodziony: ";
const X_APP_POST_URL = `twitter://post?message=${encodeURIComponent(X_POST_TEXT)}`;
const X_WEB_POST_URL = `https://x.com/intent/post?text=${encodeURIComponent(X_POST_TEXT)}`;

interface RatingAskRecord {
  /** The newest local days on which home showed, as `YYYY-MM-DD`. Only the count matters. */
  days: readonly string[];
  /** When home first showed, in milliseconds. */
  firstUse: number | null;
  /** When the ask last showed, in milliseconds. */
  lastAsked: number | null;
  /** True after a rating or sent feedback. */
  done: boolean;
}

const EMPTY: RatingAskRecord = { days: [], firstUse: null, lastAsked: null, done: false };

export const useRatingAsk = create<RatingAskRecord & { ready: boolean }>(() => ({ ...EMPTY, ready: false }));

/** Reads the stored record. A missing or damaged value is a phone that has not used the app yet. */
function decodeRatingAsk(stored: string | null): RatingAskRecord {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  if (!isDynamicRecord(value)) return EMPTY;
  const time = (item: unknown) => (isNumber(item) && Number.isFinite(item) ? item : null);
  return {
    days: Array.isArray(value.days) ? value.days.filter(isString).slice(-MIN_USE_DAYS) : [],
    firstUse: time(value.firstUse),
    lastAsked: time(value.lastAsked),
    done: value.done === true,
  };
}

/**
 * Reads the stored record. A failed read leaves the store not ready, so this launch neither asks nor
 * writes: a write then would replace the stored answer with an empty record.
 */
export async function loadRatingAsk(): Promise<void> {
  if (useRatingAsk.getState().ready) return;
  const stored = await SecureStore.getItemAsync(key);
  if (!useRatingAsk.getState().ready) useRatingAsk.setState({ ...decodeRatingAsk(stored), ready: true });
}

// Writes run in order, so the last change is the one that stays stored.
let writes: Promise<void> = Promise.resolve();

function save(change: Partial<RatingAskRecord>): Promise<void> {
  useRatingAsk.setState(change);
  const { days, firstUse, lastAsked, done } = useRatingAsk.getState();
  const record: RatingAskRecord = { days, firstUse, lastAsked, done };
  writes = writes.then(() => SecureStore.setItemAsync(key, JSON.stringify(record))).catch(() => undefined);
  return writes;
}

/** Counts today as a day of use. A second call on the same day changes nothing. */
export function recordRatingAskUse(now = Date.now()): void {
  const state = useRatingAsk.getState();
  if (!state.ready) return;
  const today = localDay(new Date(now));
  if (state.days.includes(today)) return;
  void save({ days: [...state.days, today].slice(-MIN_USE_DAYS), firstUse: state.firstUse ?? now });
}

/** True when home should ask now. The development override asks after each reload. */
export function ratingAskDue(now = Date.now()): boolean {
  if (devShowRatingAsk()) return true;
  const { ready, done, days, firstUse, lastAsked } = useRatingAsk.getState();
  if (!ready || done || days.length < MIN_USE_DAYS || firstUse === null) return false;
  if (now - firstUse < MIN_AGE_MS) return false;
  return lastAsked === null || now - lastAsked >= COOLDOWN_MS;
}

/** The ask showed. "Not now" and a close wait the cooldown. The override saves nothing. */
export function markRatingAskShown(now = Date.now()): void {
  if (devShowRatingAsk()) return;
  void save({ lastAsked: now });
}

/** A rating or sent feedback: the ask does not show again on this phone. */
export function finishRatingAsk(): void {
  if (devShowRatingAsk()) return;
  void save({ done: true });
}

/** Opens the review form of the App Store, or the app page on Google Play. */
export function openStoreReview(): Promise<void> {
  return openStorePage({ review: true });
}

/** Opens a prepared post on X: in the X app when it is installed, else on the web. */
export async function openXPost(): Promise<void> {
  await Linking.openURL(X_APP_POST_URL).catch(() => Linking.openURL(X_WEB_POST_URL));
}
