import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

export const OPENBOT_BROWSER_NAMESPACE = "openbot_browser";

const identifier = z.string().min(1).max(INPUT_LIMITS.identifier);
const requiredString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);
const tabId = requiredString(INPUT_LIMITS.identifier);
const revision = z.number().int().nonnegative();
const timeout = z.number().int().min(0).max(30_000).optional();
const image = z.enum(["auto", "always", "never"]).optional();
const nonBlankString = (max: number) => z.string().max(max).trim().min(1);
const modifiers = z
  .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
  .min(1)
  .max(4)
  .optional();

export const browserTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ref"), ref: identifier, revision }),
  z.object({
    kind: z.literal("role"),
    role: nonBlankString(64),
    name: nonBlankString(500).optional(),
    exact: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("text"), text: nonBlankString(500), exact: z.boolean().optional() }),
  z.object({ kind: z.literal("css"), selector: nonBlankString(2_000) }),
  z.object({
    kind: z.literal("point"),
    x: z.number().min(0).max(INPUT_LIMITS.browserCoordinate),
    y: z.number().min(0).max(INPUT_LIMITS.browserCoordinate),
  }),
]);

function browserTool<const Name extends string, Shape extends z.ZodRawShape>(definition: {
  name: Name;
  description: string;
  shape: Shape;
}) {
  const schema = z.strictObject(definition.shape);
  return {
    ...definition,
    schema,
    parse(value: unknown) {
      const result = schema.safeParse(value);
      if (!result.success) throw new Error(`Invalid browser tool arguments: ${z.prettifyError(result.error)}`);
      return { tool: definition.name, args: result.data };
    },
  };
}

// Keep unused legacy fields accepted, but require the fields each action reads.
const legacyActionFields = {
  ref: identifier.optional(),
  text: z.string().max(INPUT_LIMITS.browserActionText).optional(),
  submit: z.boolean().optional(),
  key: z.string().max(128).optional(),
  deltaY: z.number().optional(),
};
const legacyActionSchema = z.discriminatedUnion("type", [
  z.object({ ...legacyActionFields, type: z.literal("click"), ref: tabId }),
  z.object({
    ...legacyActionFields,
    type: z.literal("type"),
    ref: tabId,
    text: requiredString(INPUT_LIMITS.browserActionText),
  }),
  z.object({ ...legacyActionFields, type: z.literal("key"), key: requiredString(32) }),
  z.object({ ...legacyActionFields, type: z.literal("scroll"), deltaY: z.number() }),
  z.object({ ...legacyActionFields, type: z.literal("back") }),
  z.object({ ...legacyActionFields, type: z.literal("forward") }),
  z.object({ ...legacyActionFields, type: z.literal("reload") }),
]);

const targetAction = { tabId, target: browserTargetSchema, timeoutMs: timeout };

export const BROWSER_TOOL_DEFINITIONS = [
  browserTool({
    name: "open",
    description: "Open an HTTP(S) URL in a new persistent private-browser tab.",
    shape: { url: requiredString(INPUT_LIMITS.browserUrl) },
  }),
  browserTool({ name: "list_tabs", description: "List browser tabs owned by this agent.", shape: {} }),
  browserTool({
    name: "status",
    description: "Get tabs, active control state, environments, recordings, and diagnostic error counts.",
    shape: {},
  }),
  browserTool({
    name: "snapshot",
    description:
      "Read the current semantic page and obtain revision-bound element references. An adaptive image is returned separately when useful.",
    shape: { tabId, image },
  }),
  browserTool({
    name: "request_takeover",
    description:
      "Ask the user to take over a tab for login, consent, CAPTCHA, passkey, two-factor authentication, or another authorization step.",
    shape: { tabId },
  }),
  browserTool({
    name: "navigate",
    description:
      "Navigate to an HTTP(S) URL, history entry, or reload, wait for the page to settle, and return a fresh snapshot.",
    shape: {
      tabId,
      url: requiredString(INPUT_LIMITS.browserUrl).optional(),
      direction: z.enum(["back", "forward", "reload"]).optional(),
      timeoutMs: timeout,
    },
  }),
  browserTool({
    name: "click",
    description:
      "Click a unique semantic, CSS, ref, or coordinate target using trusted CDP input and return a fresh snapshot.",
    shape: {
      ...targetAction,
      button: z.enum(["left", "middle", "right"]).optional(),
      clickCount: z.number().int().min(1).max(2).optional(),
      modifiers,
    },
  }),
  browserTool({
    name: "type",
    description: "Enter text in a unique target using trusted CDP input and return a fresh snapshot.",
    shape: {
      ...targetAction,
      text: z.string().max(INPUT_LIMITS.browserActionText),
      mode: z.enum(["replace", "append"]).optional(),
      submit: z.boolean().optional(),
    },
  }),
  browserTool({
    name: "press",
    description: "Press a key or shortcut such as Enter, Control+A, or Meta+Shift+P and return a fresh snapshot.",
    shape: { tabId, key: requiredString(128), target: browserTargetSchema.optional(), timeoutMs: timeout },
  }),
  browserTool({
    name: "hover",
    description: "Hover a unique target with trusted CDP pointer input and return a fresh snapshot.",
    shape: targetAction,
  }),
  browserTool({
    name: "scroll",
    description: "Scroll the page or a target container by X/Y pixels and return a fresh snapshot.",
    shape: {
      tabId,
      target: browserTargetSchema.optional(),
      deltaX: z.number().min(-100_000).max(100_000).optional(),
      deltaY: z.number().min(-100_000).max(100_000).optional(),
      timeoutMs: timeout,
    },
  }),
  browserTool({
    name: "select_option",
    description: "Select one or more native select options by value or label and return a fresh snapshot.",
    shape: { ...targetAction, values: z.array(z.string().max(1_000)).min(1).max(100) },
  }),
  browserTool({
    name: "set_checked",
    description: "Set a checkbox or radio target to the requested checked state and return a fresh snapshot.",
    shape: { ...targetAction, checked: z.boolean() },
  }),
  browserTool({
    name: "drag",
    description: "Drag from one unique target to another with trusted CDP pointer input and return a fresh snapshot.",
    shape: { tabId, source: browserTargetSchema, target: browserTargetSchema, timeoutMs: timeout },
  }),
  browserTool({
    name: "upload_files",
    description:
      "Set local files readable by OpenBot on a file input after validating paths, then return a fresh snapshot.",
    shape: {
      ...targetAction,
      paths: z.array(z.string().min(1).max(INPUT_LIMITS.path)).min(1).max(INPUT_LIMITS.attachments),
    },
  }),
  browserTool({
    name: "wait_for",
    description:
      "Wait for a URL, text, semantic target, load state, or DOM quiet condition, then return a fresh snapshot.",
    shape: {
      tabId,
      target: browserTargetSchema.optional(),
      text: requiredString(2_000).optional(),
      url: requiredString(INPUT_LIMITS.browserUrl).optional(),
      state: z.enum(["load", "domcontentloaded", "dom-quiet"]).optional(),
      timeoutMs: timeout,
    },
  }),
  browserTool({
    name: "evaluate",
    description:
      "Evaluate JavaScript in the main frame's own page context, with the same access to page scripts, DOM and cookies as the page itself. Prefer snapshots and semantic actions; use this for inspection or unsupported interactions. Returns only a JSON-serializable value up to 64 KB.",
    shape: {
      tabId,
      expression: z
        .string()
        .min(1)
        .max(64_000)
        .refine((value) => value.trim().length > 0, {
          message: "expression must not be blank",
        }),
      awaitPromise: z.boolean().optional(),
      timeoutMs: timeout,
    },
  }),
  browserTool({
    name: "set_environment",
    description:
      "Set a memory-bounded viewport, color scheme, and reduced-motion emulation without changing browser identity or user agent.",
    shape: {
      tabId,
      preset: z.enum(["fill", "desktop", "tablet", "mobile", "custom"]).optional(),
      width: z.number().int().min(320).max(INPUT_LIMITS.browserDimension).optional(),
      height: z.number().int().min(240).max(INPUT_LIMITS.browserDimension).optional(),
      deviceScaleFactor: z.number().min(0.5).max(4).optional(),
      colorScheme: z.enum(["light", "dark", "system"]).optional(),
      reducedMotion: z.boolean().optional(),
    },
  }),
  browserTool({
    name: "recording_start",
    description:
      "Start a sandboxed video-only WebM recording of a tab. It stops automatically after 5 minutes or 100 MB.",
    shape: { tabId },
  }),
  browserTool({
    name: "recording_stop",
    description: "Stop a tab recording and return the saved Downloads path and artifact metadata.",
    shape: { tabId },
  }),
  browserTool({
    name: "act",
    description:
      "Legacy compatibility tool. Prefer the specialized tools. Click, type, press, scroll, navigate history, or reload.",
    shape: {
      tabId,
      revision,
      action: legacyActionSchema,
    },
  }),
  browserTool({
    name: "screenshot",
    description: "Capture the visible page as a separate image content item.",
    shape: { tabId },
  }),
  browserTool({
    name: "close_tab",
    description: "Close a browser tab and clean up its CDP leases and recorder.",
    shape: { tabId },
  }),
] as const;

export const BROWSER_DYNAMIC_TOOLS = [
  {
    type: "namespace" as const,
    name: OPENBOT_BROWSER_NAMESPACE,
    description: "Operate OpenBot's private, persistent native Electron/CDP browser.",
    tools: BROWSER_TOOL_DEFINITIONS.map((definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      inputSchema: z.toJSONSchema(definition.schema, { target: "draft-7", unrepresentable: "any" }),
    })),
  },
];

export type BrowserToolCall = ReturnType<(typeof BROWSER_TOOL_DEFINITIONS)[number]["parse"]>;
export type BrowserToolArguments<Name extends BrowserToolCall["tool"]> = Extract<
  BrowserToolCall,
  { tool: Name }
>["args"];

export function parseBrowserToolCall(tool: string, value: unknown): BrowserToolCall {
  const definition = BROWSER_TOOL_DEFINITIONS.find((candidate) => candidate.name === tool);
  if (!definition) throw new Error(`Unknown browser tool: ${tool}`);
  return definition.parse(value);
}

// Upload staging parses the same arguments before it resolves and authorizes local files.
export function parseBrowserToolArguments(tool: "upload_files", value: unknown): BrowserToolArguments<"upload_files">;
export function parseBrowserToolArguments(tool: string, value: unknown): BrowserToolCall["args"];
export function parseBrowserToolArguments(tool: string, value: unknown): BrowserToolCall["args"] {
  return parseBrowserToolCall(tool, value).args;
}
