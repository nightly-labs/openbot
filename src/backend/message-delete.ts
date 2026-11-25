import { Schema } from "effect";

export interface MessageDeleteAccess {
  memberId: string | null;
  deleteAny: boolean;
}

export class MessageDeleteRefused extends Schema.TaggedError<MessageDeleteRefused>()("MessageDeleteRefused", {
  reason: Schema.Literals(["not-found", "busy", "forbidden"]),
}) {}
