// The Signal protocol's server half: the shapes come from `@openbot/contracts/signal-protocol`, and
// what stays here is the validation of untrusted *client* input - byte limits, identifier patterns
// and a closed discriminated union that a client-side decoder has no reason to carry. The other
// direction is `@openbot/contracts/signal-protocol/decode`, which is what a peer runs over this
// service's output. One validator per trust direction, on purpose.
//
// The re-exports below are what the rest of this workspace imports, so moving the types out did not
// churn `signal-service.ts` or `tokens.ts`.

import type { SignalClientMessage, SignalServerMessage } from "@openbot/contracts/signal-protocol/messages";
import { z } from "zod";

export type {
  IceServer,
  SignalChannel,
  SignalClientMessage,
  SignalErrorCode,
  SignalRelayMessage,
  SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
export {
  SIGNAL_ERROR_CODES,
  SIGNAL_MESSAGE_BYTES_LIMIT,
  SIGNAL_PROTOCOL_VERSION,
} from "@openbot/contracts/signal-protocol/messages";
export type { RemoteMemberRole, RemoteRole, RemoteTicketClaims } from "@openbot/contracts/signal-protocol/ticket";
export {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
} from "@openbot/contracts/signal-protocol/ticket";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const channelSchema = z.enum(["team", "remote-desktop"]);
const signalMessageTypeSchema = z.enum([
  "hello",
  "offer",
  "answer",
  "ice-candidate",
  "ice-restart",
  "turn-refresh",
  "disconnect",
]);
const signalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    version: z.literal(1),
    peer: z.enum(["host", "client"]),
    token: z.string().min(1).max(8_192),
    multiplex: z.boolean().optional(),
  }),
  z.object({
    type: z.enum(["offer", "answer"]),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
    sdp: z.string().min(1).max(60_000),
  }),
  z.object({
    type: z.literal("ice-candidate"),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
    candidate: z.string().min(1).max(8_192),
    sdpMid: z.string().min(1).max(256).nullable(),
    sdpMLineIndex: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal("ice-restart"),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
  }),
  z.object({
    type: z.literal("turn-refresh"),
    version: z.literal(1),
    connectionId: identifierSchema.nullable(),
  }),
  z.object({
    type: z.literal("disconnect"),
    version: z.literal(1),
    connectionId: identifierSchema,
  }),
]) satisfies z.ZodType<SignalClientMessage>;

export function decodeSignalClientMessage(value: unknown): SignalClientMessage {
  const envelope = z.object({ type: z.string() }).safeParse(value);
  if (envelope.success && !signalMessageTypeSchema.safeParse(envelope.data.type).success) {
    throw new Error("Unsupported signal message.");
  }
  return signalClientMessageSchema.parse(value);
}

export function encodeSignalServerMessage(message: SignalServerMessage): string {
  return JSON.stringify(message);
}
