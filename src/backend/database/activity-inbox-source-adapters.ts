import type { InboundMessage } from "../messaging/messaging-types";

export type ActivityInboxExternalSource = "telegram" | "herdr" | "orca";

export interface VerifiedActivityInboxSourceIdentity {
  sourceId: ActivityInboxExternalSource;
  sourceKey: string;
  originalRef: string;
  identityKind: "event" | "resource";
}

export interface UnconnectedActivityInboxSource {
  sourceId: Exclude<ActivityInboxExternalSource, "telegram">;
  state: "unconnected";
  coverage: "unknown";
  reasonCode: "durable-source-event-cursor-unverified";
}

/** Maps the normalized Telegram event that OpenBot already deduplicates at ingress. */
export function telegramActivityInboxIdentity(
  message: Pick<InboundMessage, "dedupKey" | "platformChannelId" | "platformMessageId">,
): VerifiedActivityInboxSourceIdentity {
  if (!message.platformChannelId || !message.platformMessageId || !message.dedupKey)
    throw new Error("Telegram source identity is incomplete.");
  return {
    sourceId: "telegram",
    sourceKey: JSON.stringify(["telegram.message", message.platformChannelId, message.platformMessageId]),
    originalRef: message.dedupKey,
    identityKind: "event",
  };
}

/** Maps the exact resource identity carried by the Herdr v1 live-terminal handle. */
export function herdrTerminalReferenceIdentity(input: {
  terminalId: string;
  spaceId: string;
  tabId: string;
  machineLabel: string;
}): VerifiedActivityInboxSourceIdentity {
  if (!input.terminalId || !input.spaceId || !input.tabId || !input.machineLabel)
    throw new Error("Herdr terminal identity is incomplete.");
  const sourceKey = JSON.stringify([
    "herdr.terminal.v1",
    input.machineLabel,
    input.spaceId,
    input.tabId,
    input.terminalId,
  ]);
  return { sourceId: "herdr", sourceKey, originalRef: sourceKey, identityKind: "resource" };
}

/** Maps Orca's exact Run, Task and Dispatch IDs; this identifies a worker attempt, not an event cursor. */
export function orcaWorkerDispatchIdentity(input: {
  runId: string;
  taskId: string;
  dispatchId: string;
}): VerifiedActivityInboxSourceIdentity {
  if (!input.runId || !input.taskId || !input.dispatchId) throw new Error("Orca worker identity is incomplete.");
  const sourceKey = JSON.stringify(["orca.worker-dispatch.v1", input.runId, input.taskId, input.dispatchId]);
  return { sourceId: "orca", sourceKey, originalRef: sourceKey, identityKind: "resource" };
}

/** Keeps event capture unavailable when a source has only a resource handle and no durable event cursor. */
export function unavailableActivityInboxEventCapture(
  sourceId: UnconnectedActivityInboxSource["sourceId"],
): UnconnectedActivityInboxSource {
  return {
    sourceId,
    state: "unconnected",
    coverage: "unknown",
    reasonCode: "durable-source-event-cursor-unverified",
  };
}
