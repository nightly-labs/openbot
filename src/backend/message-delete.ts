import { Schema } from "effect";

/**
 * Who asks to delete a message. `memberId` is the server member who asks, or null for the user of
 * this computer. With `deleteAny`, the user can delete any message; else only a message they sent.
 */
export interface MessageDeleteAccess {
  memberId: string | null;
  deleteAny: boolean;
}

/**
 * The host refuses to delete a message: it does not show the message (`not-found`), the message is
 * part of a running turn (`busy`), or the user can delete only their own messages (`forbidden`).
 */
export class MessageDeleteRefused extends Schema.TaggedError<MessageDeleteRefused>()("MessageDeleteRefused", {
  reason: Schema.Literals(["not-found", "busy", "forbidden"]),
}) {}
