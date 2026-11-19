import { Effect } from "effect";
import { constantTimeEqual, deriveSecret, hmacSha256, randomToken } from "./crypto";
import { GitHubInstallationTokensError } from "./github-installation-tokens";

const MARK = /\n<!-- openbot-feedback-owner:([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43}) -->\s*$/u;
const KEY_LABEL = "openbot/feedback-owner/v1";

const unavailable = () => new GitHubInstallationTokensError(503, "feedback_unavailable", "Feedback is not available.");

export const feedbackOwner = Effect.fn("FeedbackOwner.create")(function* (secret: string, userId: string) {
  const key = yield* deriveSecret(secret, KEY_LABEL).pipe(Effect.mapError(unavailable));
  const hash = (nonce: string) => hmacSha256(key, `${nonce}:${userId}`).pipe(Effect.mapError(unavailable));
  return {
    mark: Effect.fn("FeedbackOwner.mark")(function* (body: string) {
      const nonce = randomToken(16);
      return `${body}\n\n<!-- openbot-feedback-owner:${nonce}.${yield* hash(nonce)} -->`;
    }),
    sentBy: Effect.fn("FeedbackOwner.sentBy")(function* (body: string) {
      const found = MARK.exec(body.replace(/\r\n/gu, "\n"));
      if (!found?.[1] || !found[2]) return false;
      const encoder = new TextEncoder();
      return constantTimeEqual(encoder.encode(yield* hash(found[1])), encoder.encode(found[2]));
    }),
  };
});
