// Frozen optional device-tools wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an agent on a host asks the
// paired phone of the member who owns the turn to do one of six fixed operations. The operations read
// or add Calendar events, read or add Reminders, find Contacts, and read the current Location. The host
// sends `device-tool-requested` only to the event connections of that member that declared this
// capability. The phone answers with one `POST /v1/device-tools/respond`. The first answer wins, and the
// host sends `device-tool-resolved` when the request closes, so other phones can drop it. The phone owns
// consent and the operating system permission: it can refuse any request with `app_not_allowed` or
// `os_permission_denied`. The wire has no update or delete operation. Every text, list and number has a
// fixed bound below. The span limit of 31 days for `calendar.list_events` is checked by the host and the
// phone; the decoder checks only the shape. Bounds and meaning do not follow IPC changes; widening any
// of it needs a second capability string.
import { type DynamicRecord, isDynamicRecord, isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const DEVICE_TOOLS_CAPABILITY = "device-tools";
export const DEVICE_TOOLS_ROUTES = {
  respond: "/v1/device-tools/respond",
} as const;

export const DEVICE_TOOL_APPS = ["calendar", "reminders", "contacts", "location"] as const;
export type DeviceToolApp = (typeof DEVICE_TOOL_APPS)[number];

export const DEVICE_TOOL_OPERATIONS = [
  "calendar.list_events",
  "calendar.add_event",
  "reminders.list",
  "reminders.add",
  "contacts.find",
  "location.current",
] as const;
export type DeviceToolOperation = (typeof DEVICE_TOOL_OPERATIONS)[number];

export const DEVICE_TOOL_ERROR_CODES = [
  "app_not_allowed",
  "os_permission_denied",
  "invalid_arguments",
  "device_error",
] as const;
export type DeviceToolErrorCode = (typeof DEVICE_TOOL_ERROR_CODES)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;

function text(input: unknown, minimum: number, maximum: number): string {
  if (!isString(input) || input.length < minimum || input.length > maximum) throw new Error("Invalid device text.");
  return input;
}
function isoDate(input: unknown): string {
  const value = text(input, 10, 40);
  if (!ISO_DATE.test(value)) throw new Error("Invalid device date.");
  return value;
}
function integer(input: unknown, minimum: number, maximum: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < minimum || input > maximum)
    throw new Error("Invalid device count.");
  return input;
}
function decimal(input: unknown, minimum: number, maximum: number): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < minimum || input > maximum)
    throw new Error("Invalid device number.");
  return input;
}
function flag(input: unknown): boolean {
  if (typeof input !== "boolean") throw new Error("Invalid device flag.");
  return input;
}
function record(input: unknown, allowed: readonly string[]): DynamicRecord {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Invalid device record.");
  return input;
}
function items<T>(input: unknown, maximum: number, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(input) || input.length > maximum) throw new Error("Invalid device list.");
  return input.map(decode);
}
function requestId(input: unknown): string {
  return text(input, 1, 128);
}

export type DeviceToolArgs = {
  "calendar.list_events": { from: string; to: string; limit: number };
  "calendar.add_event": {
    title: string;
    start: string;
    end: string;
    allDay?: boolean;
    location?: string;
    notes?: string;
  };
  "reminders.list": { status: "open" | "done"; limit: number };
  "reminders.add": { title: string; due?: string; notes?: string };
  "contacts.find": { query: string; limit: number };
  "location.current": Record<string, never>;
};

export type DeviceToolCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendar: string;
};
export type DeviceToolReminder = { id: string; title: string; due?: string; done: boolean };
export type DeviceToolContact = { id: string; name: string; phones: string[]; emails: string[] };

export type DeviceToolResults = {
  "calendar.list_events": { events: DeviceToolCalendarEvent[] };
  "calendar.add_event": { id: string };
  "reminders.list": { reminders: DeviceToolReminder[] };
  "reminders.add": { id: string };
  "contacts.find": { contacts: DeviceToolContact[] };
  "location.current": { latitude: number; longitude: number; accuracy: number; timestamp: string };
};

const APP_OF_OPERATION: Record<DeviceToolOperation, DeviceToolApp> = {
  "calendar.list_events": "calendar",
  "calendar.add_event": "calendar",
  "reminders.list": "reminders",
  "reminders.add": "reminders",
  "contacts.find": "contacts",
  "location.current": "location",
};

function oneOf<T extends string>(choices: readonly T[], input: unknown): T {
  const found = choices.find((choice) => choice === input);
  if (found === undefined) throw new Error("Invalid device value.");
  return found;
}

export function deviceToolAppOf(operation: DeviceToolOperation): DeviceToolApp {
  return APP_OF_OPERATION[operation];
}

const ARGUMENT_DECODERS: { [K in DeviceToolOperation]: (input: unknown) => DeviceToolArgs[K] } = {
  "calendar.list_events": (input) => {
    const value = record(input, ["from", "to", "limit"]);
    return { from: isoDate(value.from), to: isoDate(value.to), limit: integer(value.limit, 1, 50) };
  },
  "calendar.add_event": (input) => {
    const value = record(input, ["title", "start", "end", "allDay", "location", "notes"]);
    return {
      title: text(value.title, 1, 200),
      start: isoDate(value.start),
      end: isoDate(value.end),
      ...(value.allDay !== undefined && { allDay: flag(value.allDay) }),
      ...(value.location !== undefined && { location: text(value.location, 0, 200) }),
      ...(value.notes !== undefined && { notes: text(value.notes, 0, 2000) }),
    };
  },
  "reminders.list": (input) => {
    const value = record(input, ["status", "limit"]);
    return { status: oneOf(["open", "done"], value.status), limit: integer(value.limit, 1, 50) };
  },
  "reminders.add": (input) => {
    const value = record(input, ["title", "due", "notes"]);
    return {
      title: text(value.title, 1, 200),
      ...(value.due !== undefined && { due: isoDate(value.due) }),
      ...(value.notes !== undefined && { notes: text(value.notes, 0, 2000) }),
    };
  },
  "contacts.find": (input) => {
    const value = record(input, ["query", "limit"]);
    return { query: text(value.query, 1, 100), limit: integer(value.limit, 1, 10) };
  },
  "location.current": (input) => {
    record(input, []);
    return {};
  },
};

function calendarEvent(input: unknown): DeviceToolCalendarEvent {
  const value = record(input, ["id", "title", "start", "end", "allDay", "location", "calendar"]);
  return {
    id: text(value.id, 1, 256),
    title: text(value.title, 0, 200),
    start: isoDate(value.start),
    end: isoDate(value.end),
    allDay: flag(value.allDay),
    ...(value.location !== undefined && { location: text(value.location, 0, 200) }),
    calendar: text(value.calendar, 0, 200),
  };
}
function reminder(input: unknown): DeviceToolReminder {
  const value = record(input, ["id", "title", "due", "done"]);
  return {
    id: text(value.id, 1, 256),
    title: text(value.title, 0, 200),
    ...(value.due !== undefined && { due: isoDate(value.due) }),
    done: flag(value.done),
  };
}
function contact(input: unknown): DeviceToolContact {
  const value = record(input, ["id", "name", "phones", "emails"]);
  return {
    id: text(value.id, 1, 256),
    name: text(value.name, 0, 200),
    phones: items(value.phones, 5, (phone) => text(phone, 0, 64)),
    emails: items(value.emails, 5, (email) => text(email, 0, 320)),
  };
}

const RESULT_DECODERS: { [K in DeviceToolOperation]: (input: unknown) => DeviceToolResults[K] } = {
  "calendar.list_events": (input) => ({ events: items(record(input, ["events"]).events, 50, calendarEvent) }),
  "calendar.add_event": (input) => ({ id: text(record(input, ["id"]).id, 1, 256) }),
  "reminders.list": (input) => ({ reminders: items(record(input, ["reminders"]).reminders, 50, reminder) }),
  "reminders.add": (input) => ({ id: text(record(input, ["id"]).id, 1, 256) }),
  "contacts.find": (input) => ({ contacts: items(record(input, ["contacts"]).contacts, 10, contact) }),
  "location.current": (input) => {
    const value = record(input, ["latitude", "longitude", "accuracy", "timestamp"]);
    return {
      latitude: decimal(value.latitude, -90, 90),
      longitude: decimal(value.longitude, -180, 180),
      accuracy: decimal(value.accuracy, 0, 1_000_000),
      timestamp: isoDate(value.timestamp),
    };
  },
};

/** A request the host sends to the phone. The union keeps each operation with its own arguments. */
export type DeviceToolRequest = {
  [K in DeviceToolOperation]: { app: DeviceToolApp; operation: K; args: DeviceToolArgs[K] };
}[DeviceToolOperation];

function decodeRequestFields(input: DynamicRecord): DeviceToolRequest {
  const operation = oneOf(DEVICE_TOOL_OPERATIONS, input.operation);
  const app = oneOf(DEVICE_TOOL_APPS, input.app);
  if (app !== APP_OF_OPERATION[operation]) throw new Error("Invalid device app.");
  switch (operation) {
    case "calendar.list_events":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
    case "calendar.add_event":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
    case "reminders.list":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
    case "reminders.add":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
    case "contacts.find":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
    case "location.current":
      return { app, operation, args: ARGUMENT_DECODERS[operation](input.args) };
  }
}

export type DeviceToolRequestedEvent = { type: "device-tool-requested"; requestId: string } & DeviceToolRequest;
export type DeviceToolResolvedEvent = { type: "device-tool-resolved"; requestId: string };
export type DeviceToolEvent = DeviceToolRequestedEvent | DeviceToolResolvedEvent;

/** The device tool event in `input`, or null for any other event. A malformed known event throws. */
export function deviceToolEvent(input: unknown): DeviceToolEvent | null {
  if (!isDynamicRecord(input)) return null;
  if (input.type === "device-tool-requested") {
    record(input, ["type", "requestId", "app", "operation", "args"]);
    return { type: "device-tool-requested", requestId: requestId(input.requestId), ...decodeRequestFields(input) };
  }
  if (input.type === "device-tool-resolved") {
    record(input, ["type", "requestId"]);
    return { type: "device-tool-resolved", requestId: requestId(input.requestId) };
  }
  return null;
}

/** The answer of the phone: a result of the requested operation, or one closed error code. */
export type DeviceToolRespondRequest =
  | { requestId: string; ok: true; result: DeviceToolResults[DeviceToolOperation] }
  | { requestId: string; ok: false; code: DeviceToolErrorCode };

const RESULT_SHAPES = Object.values(RESULT_DECODERS);

/**
 * The route cannot know the operation, so a result must match one of the six result shapes. The host
 * checks the shape against the operation of its own pending request.
 */
function decodeAnyResult(input: unknown): DeviceToolResults[DeviceToolOperation] {
  for (const decode of RESULT_SHAPES) {
    try {
      return decode(input);
    } catch {
      // Try the next shape.
    }
  }
  throw new Error("Invalid device result.");
}

/** Decodes a result for one known operation. The host uses it against its pending request. */
export function decodeDeviceToolResult<K extends DeviceToolOperation>(
  operation: K,
  input: unknown,
): DeviceToolResults[K] {
  return RESULT_DECODERS[operation](input);
}

export function decodeDeviceToolRespondRequest(input: unknown): DeviceToolRespondRequest {
  if (!isDynamicRecord(input)) throw new Error("Invalid device answer.");
  if (input.ok === true) {
    record(input, ["requestId", "ok", "result"]);
    return { requestId: requestId(input.requestId), ok: true, result: decodeAnyResult(input.result) };
  }
  if (input.ok === false) {
    record(input, ["requestId", "ok", "code"]);
    return { requestId: requestId(input.requestId), ok: false, code: oneOf(DEVICE_TOOL_ERROR_CODES, input.code) };
  }
  throw new Error("Invalid device answer.");
}

const respondRequest: AdminDecoder = (input) => decodeDeviceToolRespondRequest(input);

export const DEVICE_TOOLS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [DEVICE_TOOLS_ROUTES.respond, adminRoute(respondRequest, empty)],
]);
