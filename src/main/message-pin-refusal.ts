import type { PinnedMessagesSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { MessagePinRefused } from "../backend/message-pins";

type MessagePinRefusal = MessagePinRefused["reason"];

/**
 * A pin of one message that the host refused, as the sentence the user reads. The IPC handlers send
 * it to the renderer as it is; the Team API route gives it the status of its `reason`.
 */
export class MessagePinRefusedError extends Error {
  readonly reason: MessagePinRefusal;

  constructor(reason: MessagePinRefusal) {
    super(
      reason === "limit" ? sourceText("error.backend.messagePinLimit") : sourceText("error.backend.messagePinNotFound"),
    );
    this.reason = reason;
  }
}

/**
 * Runs a pin change at a Promise boundary. A refusal rejects with `MessagePinRefusedError`; any
 * other failure rejects with the original failure that its typed error wraps, as `runCauseEffect` does.
 */
export async function runMessagePin(
  operation: Effect.Effect<PinnedMessagesSnapshot, MessagePinRefused | { readonly cause: unknown }>,
): Promise<PinnedMessagesSnapshot> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const failure = result.failure;
  if (failure instanceof MessagePinRefused) throw new MessagePinRefusedError(failure.reason);
  throw failure.cause;
}
