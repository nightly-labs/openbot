import { Schema } from "effect";

/**
 * The host refuses to pin a message: the chat does not show the message, or the message cannot be
 * pinned (`not-found`), or the chat has the most pins that it keeps (`limit`).
 */
export class MessagePinRefused extends Schema.TaggedError<MessagePinRefused>()("MessagePinRefused", {
  reason: Schema.Literals(["not-found", "limit"]),
}) {}
