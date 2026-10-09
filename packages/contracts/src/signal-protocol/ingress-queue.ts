// The queue of a hosted server that sleeps.
//
// A hosted server stops when nobody uses it. When a Slack, Discord or Telegram event comes for a route
// whose host has no `ingress` socket, Signal asks the account service to start that host, and keeps the
// event until the host connects. Signal keeps it only in memory, for a short time, and sealed to the
// host's queue key, so Signal cannot read it after it is queued.
//
// The host makes the queue key once and keeps its private half. It sends the public half in each
// `ingress` hello as `queueKey`. Signal sends the queued events in one `queued-delivery` frame each
// when the host's socket holds their routes again. An older host sends no key, so Signal never queues
// for it.

import {
  createStoredHostGrantKeyPair,
  type HostGrantKind,
  importHostGrantPrivateKey,
  isRawP256PublicKey,
  openHostGrant,
  sealHostGrant,
} from "../host-grant";
import { decodeSignalServerMessage } from "./decode";
import type { SignalServerMessage } from "./messages";

/** The frames that Signal can queue. Each one needs no answer from the host. */
export type QueuedSignalMessage = Extract<
  SignalServerMessage,
  { type: "slack-delivery" | "discord-delivery" | "telegram-delivery" }
>;

const KIND: HostGrantKind = { version: 1, info: "openbot-ingress-queue-v1" };

export const createIngressQueueKeyPair = createStoredHostGrantKeyPair;
export const importIngressQueuePrivateKey = importHostGrantPrivateKey;
export const isIngressQueueKey = isRawP256PublicKey;

/** The host ID is the additional data, so a frame sealed for one host does not open on another. */
export function sealQueuedDelivery(queueKey: string, hostId: string, message: QueuedSignalMessage): Promise<string> {
  return sealHostGrant(KIND, queueKey, hostId, message);
}

/** Throws for a frame that another key sealed, that is for another host, or that was changed. */
export function openQueuedDelivery(
  privateKey: CryptoKey,
  hostId: string,
  sealed: string,
): Promise<QueuedSignalMessage> {
  return openHostGrant(KIND, privateKey, hostId, sealed, decodeQueuedMessage);
}

function decodeQueuedMessage(value: unknown): QueuedSignalMessage {
  const message = decodeSignalServerMessage(value);
  if (
    message?.type === "slack-delivery" ||
    message?.type === "discord-delivery" ||
    message?.type === "telegram-delivery"
  )
    return message;
  throw new Error("The queued delivery is invalid.");
}
