import { isDynamicRecord, isString } from "./runtime-values";

/**
 * The Link account of this computer (link.com, by Stripe). Agents ask it for a one-time card, the user
 * approves each payment in the Link app, and the browser types the card. The tokens never cross to the
 * renderer.
 *
 * - `disconnected`: no sign-in is stored.
 * - `pending`: Link's sign-in page is open in the browser, and OpenBot waits for the user to approve it.
 * - `connected`: agents can ask to pay with Link.
 * - `expired`: Link refused the stored sign-in. The user must connect again.
 */
export type LinkAccountState = "disconnected" | "pending" | "connected" | "expired";

function isLinkAccountState(value: unknown): value is LinkAccountState {
  return value === "disconnected" || value === "pending" || value === "connected" || value === "expired";
}

export interface LinkAccountStatus {
  state: LinkAccountState;
  /** The email of the Link account, when Link gave one. */
  email: string | null;
  /** The last sign-in failure, as a sentence. Null after a success or a cancel. */
  error: string | null;
}

export const DISCONNECTED_LINK_ACCOUNT: LinkAccountStatus = { state: "disconnected", email: null, error: null };

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/** Returns null for a value that is not a Link account status. */
export function parseLinkAccountStatus(value: unknown): LinkAccountStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isLinkAccountState(value.state) ||
    !isNullableString(value.email) ||
    !isNullableString(value.error)
  ) {
    return null;
  }
  return { state: value.state, email: value.email, error: value.error };
}
