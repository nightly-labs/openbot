// The Link account (link.com, by Stripe) as agents see it. The main process implements it; the backend
// does not know how OpenBot signs in to Link.

import { type Effect, Schema } from "effect";
import type { VaultCardSecret } from "./vault-items";

/** The `fill_card` id of a Link card starts with this, so it cannot be the id of a saved card. */
export const LINK_CARD_ID_PREFIX = "link:";

export interface LinkPaymentRequest {
  /** In the smallest unit of the currency, such as cents. */
  amount: number;
  /** ISO 4217, lowercase or uppercase. Link uses the card's currency when it is absent. */
  currency?: string | undefined;
  merchantName: string;
  merchantUrl: string;
  /** What the agent buys and why. The user reads it in Link before approving. */
  context: string;
}

/** The answer of the user in Link. Only `approved` gives a card. */
export type LinkPaymentResult =
  | {
      status: "approved";
      /** Give it to `fill_card`. */
      cardId: string;
      brand: string | null;
      last4: string;
      expMonth: number;
      expYear: number;
      /** ISO 8601, or null when Link did not say. The card stops working after it. */
      validUntil: string | null;
    }
  | { status: "denied" | "expired" | "requires_action" | "failed"; detail: string | null };

export interface LinkCard {
  secret: VaultCardSecret;
  /** The merchant that the user approved. A fill on another site waits for the owner. */
  merchantUrl: string;
}

/** A Link failure as a sentence that the agent can read. It holds no token and no card value. */
export class LinkWalletError extends Schema.TaggedError<LinkWalletError>()("LinkWalletError", {
  message: Schema.String,
}) {}

export interface LinkWallet {
  /** True while a Link sign-in is stored and Link has not refused it. */
  connected(): boolean;
  /**
   * Asks Link for a one-time card, opens Link's approval page, and waits for the user's answer.
   * Interrupting the effect stops the wait; the request stays in Link until it expires.
   */
  requestPayment(request: LinkPaymentRequest): Effect.Effect<LinkPaymentResult, LinkWalletError>;
  /** The approved card of a `cardId` from `requestPayment`, or null when Link has no such card. */
  card(cardId: string): Effect.Effect<LinkCard | null, LinkWalletError>;
}
