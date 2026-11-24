import { Schema } from "effect";

export class MessagePinRefused extends Schema.TaggedError<MessagePinRefused>()("MessagePinRefused", {
  reason: Schema.Literals(["not-found", "limit"]),
}) {}
