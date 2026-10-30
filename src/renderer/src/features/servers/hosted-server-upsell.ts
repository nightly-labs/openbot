import { z } from "zod";

/**
 * When the offer of a hosted server shows. A routine on a computer stops when the computer is off,
 * so the offer comes when the user depends on that computer: the first routine on this computer, the
 * routine list, and the computer offline. The modal shows one time for each account; the notices come
 * back often enough to be seen, but never as a repeat in one sitting.
 */

const HOSTED_UPSELL_KEY_PREFIX = "openbot:hosted-server-upsell:v1:";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The modal after the first routine shows one time. An account that saw it before does not see it again. */
const MODAL_LIMIT = 1;
/** Each "Not now" on the routine list hides the notice for longer, up to the last step. */
const NOTICE_SNOOZE_DAYS = [7, 14, 30] as const;
/** "See plans" without a purchase: the user saw the plans, so the notice waits a little. */
const NOTICE_AFTER_PLANS_MS = 3 * DAY_MS;

type UpsellStorage = Pick<Storage, "getItem" | "setItem">;

const upsellStateSchema = z.object({
  modalCount: z.number().int().min(0).catch(0),
  // Kept so that a saved value stays valid; the modal no longer comes back after an interval.
  modalShownAt: z.number().nullable().catch(null),
  noticeDismissals: z.number().int().min(0).catch(0),
  noticeHiddenUntil: z.number().nullable().catch(null),
});

export type HostedUpsellState = z.infer<typeof upsellStateSchema>;

const EMPTY_STATE: HostedUpsellState = {
  modalCount: 0,
  modalShownAt: null,
  noticeDismissals: 0,
  noticeHiddenUntil: null,
};

function storageKey(accountId: string): string {
  return `${HOSTED_UPSELL_KEY_PREFIX}${accountId}`;
}

/**
 * Null when the browser storage cannot be read: then nothing shows, so nothing can repeat. A damaged
 * saved value starts again from the empty state, and the next write replaces it.
 */
export function readHostedUpsellState(storage: UpsellStorage, accountId: string): HostedUpsellState | null {
  let saved: string | null;
  try {
    saved = storage.getItem(storageKey(accountId));
  } catch {
    return null;
  }
  if (saved === null) return EMPTY_STATE;
  try {
    const parsed = upsellStateSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/** False when the write failed. A caller saves before it shows, so a failed write shows nothing. */
export function writeHostedUpsellState(storage: UpsellStorage, accountId: string, state: HostedUpsellState): boolean {
  try {
    storage.setItem(storageKey(accountId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function modalAllowed(state: HostedUpsellState): boolean {
  return state.modalCount < MODAL_LIMIT;
}

export function withModalShown(state: HostedUpsellState, now: number): HostedUpsellState {
  return { ...state, modalCount: state.modalCount + 1, modalShownAt: now };
}

export function noticeAllowed(state: HostedUpsellState, now: number): boolean {
  return state.noticeHiddenUntil === null || now >= state.noticeHiddenUntil;
}

export function withNoticeDismissed(state: HostedUpsellState, now: number): HostedUpsellState {
  const days = NOTICE_SNOOZE_DAYS[Math.min(state.noticeDismissals, NOTICE_SNOOZE_DAYS.length - 1)] ?? 30;
  return { ...state, noticeDismissals: state.noticeDismissals + 1, noticeHiddenUntil: now + days * DAY_MS };
}

export function withNoticePlansSeen(state: HostedUpsellState, now: number): HostedUpsellState {
  return { ...state, noticeHiddenUntil: Math.max(state.noticeHiddenUntil ?? 0, now + NOTICE_AFTER_PLANS_MS) };
}
