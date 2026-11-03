import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import { decodeAccountReadResult } from "../protocol";

/** Host-only credentials. Never export this type through IPC or the Team protocol. */
export interface CodexSubscriptionAuth {
  token: string;
  accountId: string;
  stillCurrent?: () => boolean;
}

export class CodexSubscriptionAuthFailed extends Schema.TaggedError<CodexSubscriptionAuthFailed>()(
  "CodexSubscriptionAuthFailed",
  { cause: Schema.Defect() },
) {}

export function subscriptionAuthFailure(): CodexSubscriptionAuthFailed {
  return new CodexSubscriptionAuthFailed({ cause: new Error(sourceText("error.voice.realtime.subscriptionRequired")) });
}

/** Decode only a Codex-owned ChatGPT token; an API-key login must never spend API credit here. */
function decodeSubscriptionAuth(value: unknown): CodexSubscriptionAuth {
  if (
    !isDynamicRecord(value) ||
    value.authMethod !== "chatgpt" ||
    typeof value.authToken !== "string" ||
    !value.authToken ||
    value.authToken.length > 32_768
  )
    throw subscriptionAuthFailure();
  const token = value.authToken;
  registerSecretValue(token);
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    const auth = isDynamicRecord(payload) ? payload["https://api.openai.com/auth"] : undefined;
    if (
      !isDynamicRecord(auth) ||
      typeof auth.chatgpt_account_id !== "string" ||
      !auth.chatgpt_account_id ||
      auth.chatgpt_account_id.length > 256
    )
      throw subscriptionAuthFailure();
    registerSecretValue(auth.chatgpt_account_id);
    // The upstream service verifies the token. This claim only prepares its account header.
    return { token, accountId: auth.chatgpt_account_id };
  } catch {
    throw subscriptionAuthFailure();
  }
}

export const readCodexSubscriptionAuth = Effect.fn("CodexVoice.readSubscriptionAuth")(function* (client: AgentClient) {
  const account = yield* client
    .request("account/read", { refreshToken: true }, decodeAccountReadResult, 8_000)
    .pipe(Effect.mapError(subscriptionAuthFailure));
  if (account.account?.type !== "chatgpt") return yield* subscriptionAuthFailure();
  return yield* client
    .request("getAuthStatus", { includeToken: true, refreshToken: true }, decodeSubscriptionAuth, 8_000)
    .pipe(Effect.mapError(subscriptionAuthFailure));
});
