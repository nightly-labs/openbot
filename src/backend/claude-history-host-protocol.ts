import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { ClaudeHistoryOptions } from "./claude-history";
import { decodeThreadItem, type ThreadItem } from "./protocol";
import type { ProviderHistoryFragment, ProviderHistoryRequest, ReadProviderHistory } from "./provider-history";

/** Internal host transport. No credentials, application database handles or tools cross it. */
export type ClaudeHistoryHostRequest =
  | { kind: "scan"; id: number; options: ClaudeHistoryOptions; request: ProviderHistoryRequest }
  | { kind: "ack"; id: number; sequence: number; continue: boolean };

export type ClaudeHistoryHostMessage =
  | { kind: "ready"; pid: number }
  | { kind: "fragment"; id: number; sequence: number; fragment: ProviderHistoryFragment }
  | { kind: "complete"; id: number }
  | { kind: "failed"; id: number; failure: "line-too-long" | "scan" };

export interface ClaudeHistoryHostProcess {
  send(request: ClaudeHistoryHostRequest): void;
  onMessage(listener: (message: ClaudeHistoryHostMessage) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

export type ClaudeHistoryReaderFactory = (options: ClaudeHistoryOptions) => ReadProviderHistory;

/** Validate the internal process envelope while preserving the scanner's original item fields. */
export function decodeClaudeHistoryHostMessage(value: unknown): ClaudeHistoryHostMessage | null {
  if (!isDynamicRecord(value)) return null;
  if (value.kind === "ready")
    return typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0
      ? { kind: "ready", pid: value.pid }
      : null;
  if (typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id < 1) return null;
  if (value.kind === "complete") return { kind: "complete", id: value.id };
  if (value.kind === "failed")
    return value.failure === "line-too-long" || value.failure === "scan"
      ? { kind: "failed", id: value.id, failure: value.failure }
      : null;
  if (
    value.kind !== "fragment" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !isDynamicRecord(value.fragment)
  )
    return null;
  const fragment = value.fragment;
  if (
    typeof fragment.turnId !== "string" ||
    !fragment.turnId ||
    typeof fragment.complete !== "boolean" ||
    !Array.isArray(fragment.items) ||
    fragment.items.length > 50 ||
    !fragment.items.every(historyItem) ||
    (fragment.status !== undefined && typeof fragment.status !== "string") ||
    (fragment.startedAt !== undefined &&
      (typeof fragment.startedAt !== "number" || !Number.isFinite(fragment.startedAt))) ||
    (fragment.itemOffset !== undefined &&
      (typeof fragment.itemOffset !== "number" ||
        !Number.isSafeInteger(fragment.itemOffset) ||
        fragment.itemOffset < 0)) ||
    (fragment.recordsOnly !== undefined && typeof fragment.recordsOnly !== "boolean")
  )
    return null;
  return {
    kind: "fragment",
    id: value.id,
    sequence: value.sequence,
    fragment: {
      turnId: fragment.turnId,
      complete: fragment.complete,
      items: fragment.items,
      ...(fragment.status === undefined ? {} : { status: fragment.status }),
      ...(fragment.startedAt === undefined ? {} : { startedAt: fragment.startedAt }),
      ...(fragment.itemOffset === undefined ? {} : { itemOffset: fragment.itemOffset }),
      ...(fragment.recordsOnly === undefined ? {} : { recordsOnly: fragment.recordsOnly }),
    },
  };
}

function historyItem(value: unknown): value is ThreadItem {
  try {
    decodeThreadItem(value);
    return true;
  } catch {
    return false;
  }
}
