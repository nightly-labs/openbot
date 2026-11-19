import { type EventFilter, type EventScalar, isEventFilterPointer } from "./ipc-events";

export const MASKED_WEBHOOK_SECRET = "whsec_••••••••••••";

export interface EventFilterDraft {
  pointer: string;
  value: string;
}

function isScalar(value: unknown): value is EventScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function parseScalar(text: string): EventScalar | undefined {
  try {
    const parsed = JSON.parse(text);
    return isScalar(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function eventFilterValueText(value: EventScalar): string {
  if (typeof value === "string") return parseScalar(value) === undefined ? value : JSON.stringify(value);
  return JSON.stringify(value);
}

function eventFilterValue(text: string): EventScalar {
  const parsed = parseScalar(text.trim());
  return parsed === undefined ? text : parsed;
}

export function eventFilterPointerValid(pointer: string): boolean {
  return isEventFilterPointer(pointer.trim());
}

export function eventFilterDraft(filter: EventFilter): EventFilterDraft {
  return { pointer: filter.pointer, value: eventFilterValueText(filter.value) };
}

export function eventFiltersFromDrafts(drafts: readonly EventFilterDraft[]): EventFilter[] {
  return drafts.map((draft) => ({ pointer: draft.pointer.trim(), value: eventFilterValue(draft.value) }));
}

export function eventFilterDraftsValid(drafts: readonly EventFilterDraft[]): boolean {
  return drafts.every((draft) => eventFilterPointerValid(draft.pointer));
}
