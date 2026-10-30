import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { BROWSER_TAKEOVER_REASONS, VAULT_TEXT_LIMIT, type VaultContactFields } from "@openbot/contracts/ipc";
import { z } from "zod";
import { advertisedJsonSchema } from "./agent/advertised-json-schema";
import {
  BROWSER_FILL_FIELDS_MAX_FIELDS,
  BROWSER_FILL_FIELDS_MAX_TEXT_BYTES,
  BROWSER_FILL_FIELDS_MAX_TIMEOUT_MS,
} from "./browser-fill-fields";

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

const browserTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ref"), ref: identifier, revision }),
  z.object({
    kind: z.literal("role"),
    role: nonBlankString(64),
    name: nonBlankString(500).exactOptional(),
    exact: z.boolean().exactOptional(),
  }),
  z.object({ kind: z.literal("text"), text: nonBlankString(500), exact: z.boolean().exactOptional() }),
  z.object({ kind: z.literal("css"), selector: nonBlankString(2_000) }),
  z.object({
    kind: z.literal("point"),
    x: z.number().min(0).max(INPUT_LIMITS.browserCoordinate),
    y: z.number().min(0).max(INPUT_LIMITS.browserCoordinate),
  }),
]);

const vaultText = z.string().max(VAULT_TEXT_LIMIT).optional();

const vaultContactShape = {
  fullName: vaultText.describe("Contact: the full name."),
  address: vaultText.describe("Contact: the street address."),
  address2: vaultText.describe("Contact: the apartment, suite or floor."),
  city: vaultText.describe("Contact: the city."),
  region: vaultText.describe("Contact: the state, province or region."),
  postalCode: vaultText.describe("Contact: the postal code."),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$|^$/u)
    .optional()
    .describe("Contact: the ISO 3166-1 alpha-2 country code, such as US or DE."),
  phone: vaultText.describe("Contact: the phone number."),
  email: vaultText.describe("Contact: the email address."),
} satisfies { [Key in Exclude<keyof VaultContactFields, "label">]: z.ZodType };

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

const BROWSER_TOOL_DEFINITIONS = [
  browserTool({
    name: "open",
    description: "Open an HTTP(S) URL in a new persistent private-browser tab.",
    shape: { url: requiredString(INPUT_LIMITS.browserUrl) },
  }),
  browserTool({
    name: "list_tabs",
    description:
      "List browser tabs owned by this agent, including popup openerTabId and blocked-popup feedback. After a sign-in click, check for a new tab, take a fresh snapshot there, and continue the sign-in. When it closes, return to the opener and verify sign-in succeeded.",
    shape: {},
  }),
  browserTool({
    name: "status",
    description: "Get tabs, active control state, environments, recordings, and diagnostic error counts.",
    shape: {},
  }),
  browserTool({
    name: "snapshot",
    description:
      "Read the current semantic page and obtain revision-bound element references. An adaptive image is returned separately when useful. The output is bounded: text in the viewport comes first, and truncated is true when text or elements were left out. Scroll, or wait for text, to read more.",
    shape: { tabId, image },
  }),
  browserTool({
    name: "submit_secret",
    description:
      "Request the secret card for the active authentication step discovered in a fresh page snapshot. Identify password, email/SMS code, or authenticator-app code from the page instructions before calling. Select any login-method option first. The user authorizes one fill-and-submit action to the shown HTTPS origin. Never pass a secret as an argument. Use takeover if the method or code length is unclear, for nonnumeric/recovery codes, CAPTCHA, passkeys, or payment confirmation. Fill saved cards with fill_card.",
    shape: {
      tabId,
      method: z
        .enum(["password", "otp", "authenticator"])
        .describe(
          "Selects the card: password for an account password; otp for a numeric email/SMS code; authenticator for a numeric authenticator-app code. Generic 2FA labels or masked inputs do not establish the method.",
        ),
      targets: z
        .array(browserTargetSchema)
        .min(1)
        .max(12)
        .describe(
          "Only the active step: one password/whole-code field, or all single-digit fields in entry order. Use fresh snapshot refs; exclude username fields.",
        ),
      digits: z
        .number()
        .int()
        .min(0)
        .max(12)
        .default(6)
        .describe(
          "For codes, explicitly supply the required length from page instructions or the count of single-digit fields. Codes require 4–12 digits; do not infer six from the default. For passwords, omit digits or use 0; no digit limit applies to the password.",
        ),
      submission: z
        .enum(["click", "enter", "on_input"])
        .describe(
          "Use click with submitTarget when the page has a Continue, Verify, Next, or Sign in button, even if disabled before entry. OpenBot fills the fields then clicks that button. Use enter only for a form submitted by Enter. on_input ONLY fills fields; use it only when the site explicitly submits on the final digit without a button. It does not find or click a button.",
        ),
      submitTarget: browserTargetSchema
        .optional()
        .describe(
          "Required with click: the active step’s Continue, Verify, Next, or Sign in button from the same fresh snapshot. A currently disabled button can become enabled after entry.",
        ),
      loginId: identifier
        .optional()
        .describe(
          "For password or authenticator: the id of a saved login from list_logins. OpenBot fills its password or current code without asking the user.",
        ),
      username: z
        .string()
        .max(VAULT_TEXT_LIMIT)
        .optional()
        .describe(
          "For password without loginId: the username or email of this sign-in, as typed on the page. When the user saves the password in the OpenBot Vault from the card, the login gets this username.",
        ),
    },
  }),
  browserTool({
    name: "list_logins",
    description:
      "List 1Password, Bitwarden and OpenBot Vault logins for the tab's HTTPS site: id, title, username and hasOneTimePassword. Use it to log in with a password manager. No passwords or codes. Type the username, then call submit_secret with loginId.",
    shape: { tabId },
  }),
  browserTool({
    name: "list_vault_items",
    description:
      "List what the user saved in the OpenBot Vault, not 1Password or Bitwarden. A login shows id, website and username; its password and notes are never returned, so sign in with list_logins and submit_secret. A card shows id, label, nameOnCard, brand, last4, expiry and hasSecurityCode; its number and security code are never returned, so fill card fields with fill_card. A contact shows every field: type them with fill_fields, type, or select_option. addedBy, when present, names the agent that added the item.",
    shape: {},
  }),
  browserTool({
    name: "save_vault_item",
    description:
      "Add contact info to the OpenBot Vault, or change a saved item. A contact without id is new; with id, it changes. A login or a card needs its id from list_vault_items (not from list_logins). A login changes only its username; a card changes only fields that are not secret. You cannot set a password, a website, a card number or a security code. An omitted field keeps its value. Returns the id, kind and name, never a secret.",
    shape: {
      kind: z.enum(["contact", "login", "card"]),
      id: identifier.optional().describe("The item to change. Omit it to add a contact."),
      label: vaultText.describe("Contact or card: a short name, such as Home or Work card."),
      ...vaultContactShape,
      username: vaultText.describe("Login: the username or email."),
      nameOnCard: vaultText.describe("Card: the name on the card."),
      expMonth: z.number().int().min(1).max(12).optional().describe("Card: the expiry month."),
      expYear: z.number().int().min(2000).max(2099).optional().describe("Card: the four-digit expiry year."),
      billingContactId: identifier
        .nullable()
        .optional()
        .describe("Card: the id of the contact for the billing address, or null for none."),
    },
  }),
  browserTool({
    name: "delete_vault_item",
    description:
      "Delete a login, card or contact from the OpenBot Vault by its id from list_vault_items (not from list_logins). A card that uses a deleted contact for billing keeps no billing address. This cannot be undone: ask first unless you added the item or the user asked for the delete.",
    shape: { id: identifier },
  }),
  browserTool({
    name: "fill_card",
    description:
      "Type a saved card from list_vault_items into card fields from one fresh snapshot: the number, and any of the security code, a single expiry field or month and year fields (inputs or native selects), and the name on the card. Fields can be on the HTTPS page or in an HTTPS payment frame. You never see the number or the security code: snapshots hide them. Does not submit. The first fill of a card on a site waits for the server owner's approval. Returns the filled field names and a fresh snapshot. Screenshots, evaluate and recording are unavailable until the page navigates.",
    shape: {
      tabId,
      cardId: identifier,
      targets: z
        .strictObject({
          number: browserTargetSchema,
          securityCode: browserTargetSchema.optional(),
          expiry: browserTargetSchema.optional().describe("One field for month and year, such as MM/YY."),
          expMonth: browserTargetSchema.optional(),
          expYear: browserTargetSchema.optional(),
          nameOnCard: browserTargetSchema.optional(),
        })
        .refine((targets) => !(targets.expiry && (targets.expMonth || targets.expYear)), {
          message: "Use expiry, or expMonth and expYear, not both.",
        }),
      timeoutMs: timeout,
    },
  }),
  browserTool({
    name: "request_takeover",
    description:
      "Ask the user to take over a tab for unclear OAuth account selection, CAPTCHA, passkeys, payment confirmation such as 3-D Secure, or when secure password/code handoff or card fill is unavailable.",
    shape: {
      tabId,
      reason: z
        .enum(BROWSER_TAKEOVER_REASONS)
        .optional()
        .describe("sign-in-blocked: the site refused the sign-in from the browser's network address."),
    },
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
    description:
      "Enter text in a unique target using trusted CDP input and return a fresh snapshot. Omit the target to send the text as keystrokes to whatever the page has focused, which is how an application that draws its own surface, such as a spreadsheet grid on a canvas, takes input: click or navigate to the cell first, then type. In that mode a tab character moves to the next column and a newline commits the row, so one call can fill a row or a column, and the snapshot's focus field says where those keystrokes will land. Mode applies only to an element target.",
    shape: {
      tabId,
      target: browserTargetSchema.optional(),
      timeoutMs: timeout,
      text: z.string().max(INPUT_LIMITS.browserActionText),
      mode: z.enum(["replace", "append"]).optional(),
      submit: z.boolean().optional(),
    },
  }),
  browserTool({
    name: "fill_fields",
    description:
      "Replace 1 to 16 already inspected ordinary main-frame text fields from one fresh snapshot, with at most 16 KiB combined UTF-8 text. Performs one queued operation and returns one final snapshot. Does not submit. Refuses known password, code, and payment fields: use fill_card for card fields. Partial results report confirmed and uncertain zero-based indices. Read the page before continuing; never automatically retry or undo a partial fill.",
    shape: {
      tabId,
      revision,
      fields: z
        .array(z.strictObject({ ref: identifier, text: z.string().max(BROWSER_FILL_FIELDS_MAX_TEXT_BYTES) }))
        .min(1)
        .max(BROWSER_FILL_FIELDS_MAX_FIELDS)
        .refine((fields) => new Set(fields.map((field) => field.ref)).size === fields.length, "Duplicate field refs.")
        .refine(
          (fields) =>
            fields.reduce((bytes, field) => bytes + new TextEncoder().encode(field.text).byteLength, 0) <=
            BROWSER_FILL_FIELDS_MAX_TEXT_BYTES,
          "Combined field text exceeds 16 KiB UTF-8.",
        ),
      timeoutMs: z.number().int().min(1).max(BROWSER_FILL_FIELDS_MAX_TIMEOUT_MS).optional(),
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
      "Set local files on a file input or the file chooser a clicked target opens, then return a fresh snapshot.",
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
      inputSchema: advertisedJsonSchema(definition.schema),
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
