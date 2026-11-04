import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { MessageDeleteRefused } from "../backend/message-delete";

type MessageDeleteRefusal = MessageDeleteRefused["reason"];

/**
 * A delete of one message that the host refused, as the sentence the user reads. The IPC handlers
 * send it to the renderer as it is; the Team API route gives it the status of its `reason`.
 */
export class MessageDeleteRefusedError extends Error {
  readonly reason: MessageDeleteRefusal;

  constructor(reason: MessageDeleteRefusal) {
    super(
      reason === "not-found"
        ? sourceText("error.backend.messageDeleteNotFound")
        : reason === "busy"
          ? sourceText("error.backend.messageDeleteBusy")
          : sourceText("error.backend.messageDeleteForbidden"),
    );
    this.reason = reason;
  }
}

/**
 * Runs a message delete at a Promise boundary. A refusal rejects with `MessageDeleteRefusedError`;
 * any other failure rejects with the original failure that its typed error wraps, as
 * `runCauseEffect` does.
 */
export async function runMessageDelete(
  operation: Effect.Effect<void, MessageDeleteRefused | { readonly cause: unknown }>,
): Promise<void> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return;
  const failure = result.failure;
  if (failure instanceof MessageDeleteRefused) throw new MessageDeleteRefusedError(failure.reason);
  throw failure.cause;
}
