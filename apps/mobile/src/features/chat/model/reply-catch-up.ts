const REPLY_CATCH_UP_MS = 400;
export const REPLY_CATCH_UP_STEP_MS = 32;

export function replyCatchUpStep(remaining: number): number {
  return Math.max(1, Math.ceil((remaining * REPLY_CATCH_UP_STEP_MS) / REPLY_CATCH_UP_MS));
}
