import { type Effect, Schema } from "effect";

export interface NearPaymentRequest {
  agentId: string;
  threadId: string;
  requestId: string;
  domain: string;
  recipient: string;
  asset: string;
  amount: string;
  reason: string;
}

export interface NearPaymentPlan {
  kind: "auto" | "ask";
  amount: string;
  symbol: string;
}

export interface NearPaymentResult {
  status: "paid" | "declined" | "failed" | "uncertain";
  correlationId: string | null;
  transactionHash: string | null;
  detail: string | null;
}

export class NearWalletError extends Schema.TaggedError<NearWalletError>()("NearWalletError", {
  message: Schema.String,
}) {}

export interface NearWallet {
  ready(): boolean;
  prepare(request: NearPaymentRequest): Effect.Effect<NearPaymentPlan, NearWalletError>;
  pay(requestId: string): Effect.Effect<NearPaymentResult, NearWalletError>;
  drop(requestId: string): void;
}
