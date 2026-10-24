import {
  type DeviceToolApp,
  type DeviceToolEvent,
  type DeviceToolOperation,
  type DeviceToolRequest,
  deviceToolAppOf,
  deviceToolEvent,
} from "@openbot/contracts/team-protocol/device-tools-v1";
import { z } from "zod";

export const OPENBOT_DEVICE_NAMESPACE = "openbot_device";

/** The longest span `calendar.list_events` accepts. The wire decoder checks only the shape. */
const MAX_LIST_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

// Mirrors the wire date of `device-tools-v1`; the wire decoder below stays the final check.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;
const isoDate = z.string().min(10).max(40).regex(ISO_DATE);
const title = z.string().min(1).max(200);
const notes = z.string().max(2_000);

function deviceTool<const Name extends string, Shape extends z.ZodRawShape>(definition: {
  name: Name;
  operation: DeviceToolOperation;
  description: string;
  shape: Shape;
}) {
  const schema = z.strictObject(definition.shape);
  return {
    name: definition.name,
    operation: definition.operation,
    description: definition.description,
    schema,
  };
}

const DEVICE_TOOL_DEFINITIONS = [
  deviceTool({
    name: "calendar_list_events",
    operation: "calendar.list_events",
    description: "List events in the Calendar app of the user's phone. The range is at most 31 days.",
    shape: {
      from: isoDate.describe("Start of the range, ISO 8601."),
      to: isoDate.describe("End of the range, ISO 8601, at most 31 days after from."),
      limit: z.number().int().min(1).max(50),
    },
  }),
  deviceTool({
    name: "calendar_add_event",
    operation: "calendar.add_event",
    description: "Add an event to the Calendar app of the user's phone. The phone can ask the user first.",
    shape: {
      title,
      start: isoDate,
      end: isoDate,
      allDay: z.boolean().optional(),
      location: z.string().max(200).optional(),
      notes: notes.optional(),
    },
  }),
  deviceTool({
    name: "reminders_list",
    operation: "reminders.list",
    description: "List open or done items of the Reminders app of the user's phone.",
    shape: { status: z.enum(["open", "done"]), limit: z.number().int().min(1).max(50) },
  }),
  deviceTool({
    name: "reminders_add",
    operation: "reminders.add",
    description: "Add an item to the Reminders app of the user's phone. The phone can ask the user first.",
    shape: { title, due: isoDate.optional(), notes: notes.optional() },
  }),
  deviceTool({
    name: "contacts_find",
    operation: "contacts.find",
    description: "Find contacts by name in the Contacts app of the user's phone.",
    shape: { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(10) },
  }),
  deviceTool({
    name: "location_current",
    operation: "location.current",
    description: "Get the current position of the user's phone, rounded to 3 decimals.",
    shape: {},
  }),
] as const;

export const DEVICE_DYNAMIC_TOOLS = [
  {
    type: "namespace" as const,
    name: OPENBOT_DEVICE_NAMESPACE,
    description: "Use apps on the paired phone of the user who started this turn.",
    tools: DEVICE_TOOL_DEFINITIONS.map((definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      inputSchema: z.toJSONSchema(definition.schema, { target: "draft-7", unrepresentable: "any" }),
    })),
  },
];

export class DeviceToolArgumentsInvalid extends Error {
  constructor() {
    super("invalid_arguments");
  }
}

export function isDeviceToolName(tool: string): boolean {
  return DEVICE_TOOL_DEFINITIONS.some((definition) => definition.name === tool);
}

export function deviceToolApp(tool: string): DeviceToolApp | null {
  const definition = DEVICE_TOOL_DEFINITIONS.find((candidate) => candidate.name === tool);
  return definition ? deviceToolAppOf(definition.operation) : null;
}

/**
 * Parses the arguments of one tool into the wire request. The error holds no argument value, so a
 * caller can log it. The wire decoder runs last, so what leaves the host is what the phone accepts.
 */
export function parseDeviceToolCall(tool: string, value: unknown): DeviceToolRequest {
  const definition = DEVICE_TOOL_DEFINITIONS.find((candidate) => candidate.name === tool);
  if (!definition) throw new DeviceToolArgumentsInvalid();
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) throw new DeviceToolArgumentsInvalid();
  const args = parsed.data;
  if ("from" in args && "to" in args) {
    const from = Date.parse(args.from);
    const to = Date.parse(args.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_LIST_SPAN_MS)
      throw new DeviceToolArgumentsInvalid();
  }
  let event: DeviceToolEvent | null;
  try {
    event = deviceToolEvent({
      type: "device-tool-requested",
      requestId: "check",
      app: deviceToolAppOf(definition.operation),
      operation: definition.operation,
      args,
    });
  } catch {
    throw new DeviceToolArgumentsInvalid();
  }
  if (event?.type !== "device-tool-requested") throw new DeviceToolArgumentsInvalid();
  // The placeholder `type` and `requestId` stay on the value; a caller writes both after the spread.
  return event;
}
