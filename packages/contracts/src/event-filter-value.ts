// The text form of a webhook filter, shared by the desktop and mobile routine editors, so a value
// that one client saves reads back as the same value in the other.

import { type EventFilter, type EventScalar, isEventFilterPointer } from "./ipc-events";

/** The host never returns a saved secret, so the secret row shows its prefix and a mask. */
export const MASKED_WEBHOOK_SECRET = "whsec_••••••••••••";

/** A filter row while the user edits it. The value stays text until the routine is saved. */
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

/** The scalar that the text is as JSON, or undefined when the text is not a JSON scalar. */
function parseScalar(text: string): EventScalar | undefined {
  try {
    const parsed = JSON.parse(text);
    return isScalar(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Text that reads back as the same value: a string that is also a JSON scalar gets quotes. */
function eventFilterValueText(value: EventScalar): string {
  if (typeof value === "string") return parseScalar(value) === undefined ? value : JSON.stringify(value);
  return JSON.stringify(value);
}

/** A JSON scalar (`42`, `true`, `null`, `"42"`) is that value. Other text is a string. */
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
