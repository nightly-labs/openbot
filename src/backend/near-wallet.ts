// The NEAR Intents wallet as agents see it. The main process implements it and keeps the partner key and
// the payment grant; the agent process and the backend never get them.

import { type Effect, Schema } from "effect";

export interface NearPaymentRequest {
  /** The OpenBot agent that asks. Only the agents that the owner chose can pay. */
  agentId: string;
  threadId: string;
  /** The id of the tool call. The approval card and the payment use it. */
  requestId: string;
  /** The site that the agent pays for, as the agent says. A domain rule matches it. */
  domain: string;
  /** A NEAR account, or `chain:address` for a payment on another chain. */
  recipient: string;
  /** A token symbol or an asset id from the wallet balances. */
  asset: string;
  /** A decimal amount in whole tokens, such as `1.5`. */
  amount: string;
  /** What the payment is for. The owner reads it on the approval card. */
  reason: string;
}

/** `auto`: a domain rule allows the payment. `ask`: the owner approves it in the chat first. */
export type NearPaymentPlan = { kind: "auto" } | { kind: "ask"; amount: string; symbol: string };

export interface NearPaymentResult {
  /**
   * `uncertain`: the Agent API did not answer, and the payment may have been sent. OpenBot sends it again
   * with the same key, so it is never paid twice. Do not ask again.
   */
  status: "paid" | "declined" | "failed" | "uncertain";
  /** The Agent API execution id. */
  correlationId: string | null;
  /** A sentence that the agent can read. It holds no key and no token. */
  detail: string | null;
}

/** A wallet failure as a sentence that the agent can read. It holds no key and no token. */
export class NearWalletError extends Schema.TaggedError<NearWalletError>()("NearWalletError", {
  message: Schema.String,
}) {}

export interface NearWallet {
  /** True while a wallet is set up, not frozen, and its grant is valid. */
  ready(): boolean;
  /**
   * Checks the request against the wallet: agent, asset, amount, recipient and the domain rules. A refusal
   * is a `NearWalletError`. `ask` keeps the payment as waiting until `pay` or `drop`.
   */
  prepare(request: NearPaymentRequest): Effect.Effect<NearPaymentPlan, NearWalletError>;
  /** Sends a prepared payment and waits for the Agent API result. */
  pay(requestId: string): Effect.Effect<NearPaymentResult, NearWalletError>;
  /** Forgets a prepared payment that the owner did not approve. */
  drop(requestId: string): void;
}
