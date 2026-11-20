import { type Effect, Schema } from "effect";
import type { VaultCardSecret } from "./vault-items";

export const LINK_CARD_ID_PREFIX = "link:";

export interface LinkPaymentRequest {
  amount: number;
  currency?: string | undefined;
  merchantName: string;
  merchantUrl: string;
  context: string;
}

export type LinkPaymentResult =
  | {
      status: "approved";
      cardId: string;
      brand: string | null;
      last4: string;
      expMonth: number;
      expYear: number;
      validUntil: string | null;
    }
  | { status: "denied" | "expired" | "requires_action" | "failed"; detail: string | null };

export interface LinkCard {
  secret: VaultCardSecret;
  merchantUrl: string;
}

export class LinkWalletError extends Schema.TaggedError<LinkWalletError>()("LinkWalletError", {
  message: Schema.String,
}) {}

export interface LinkWallet {
  connected(): boolean;
  requestPayment(request: LinkPaymentRequest): Effect.Effect<LinkPaymentResult, LinkWalletError>;
  card(cardId: string): Effect.Effect<LinkCard | null, LinkWalletError>;
}
