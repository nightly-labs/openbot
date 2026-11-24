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

export type IngressRoute =
  | { platform: "slack"; appId: string; teamId: string }
  | { platform: "discord"; guildId: string }
  | { platform: "telegram"; botId: string; chatId: string }
  | { platform: "webhook"; routeId: string };

export const ROUTE_HOST_STATES = ["not_hosted", "ended", "sleeping", "starting"] as const;
export type RouteHostState = (typeof ROUTE_HOST_STATES)[number];

export type QueuedSignalMessage = Extract<
  SignalServerMessage,
  { type: "slack-delivery" | "discord-delivery" | "telegram-delivery" }
>;

const KIND: HostGrantKind = { version: 1, info: "openbot-ingress-queue-v1" };

export const INGRESS_QUEUE_CAPABILITY = "ingress-queue";

export const createIngressQueueKeyPair = createStoredHostGrantKeyPair;
export const importIngressQueuePrivateKey = importHostGrantPrivateKey;
export const isIngressQueueKey = isRawP256PublicKey;

export function sealQueuedDelivery(queueKey: string, hostId: string, message: QueuedSignalMessage): Promise<string> {
  return sealHostGrant(KIND, queueKey, hostId, message);
}

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
