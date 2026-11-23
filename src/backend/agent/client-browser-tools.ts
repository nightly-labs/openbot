import { createHash } from "node:crypto";
import { isString } from "@openbot/contracts/runtime-values";
import {
  CLIENT_BROWSER_FAILURE_CODES,
  type ClientBrowserCommand,
  type ClientBrowserFailureCode,
  type ClientBrowserResult,
  type ClientBrowserTarget,
  type ClientTab,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import { Effect, Schema } from "effect";
import { type BrowserToolArguments, parseBrowserToolCall } from "../browser-tools";
import { type DynamicToolResult, isRecord } from "../protocol";

const TAB_PREFIX = "chrome:";

export class ClientBrowserFailed extends Schema.TaggedError<ClientBrowserFailed>()("ClientBrowserFailed", {
  code: Schema.Literals(CLIENT_BROWSER_FAILURE_CODES),
  message: Schema.String,
}) {}

export interface ClientBrowser {
  tabs(memberId: string): ClientTab[] | null;
  call(
    memberId: string,
    agent: { id: string; name: string },
    command: ClientBrowserCommand,
  ): Effect.Effect<ClientBrowserResult, ClientBrowserFailed>;
}

function memberKey(memberId: string): string {
  return createHash("sha256").update(memberId).digest("hex").slice(0, 8);
}

function sharedTab(memberId: string, tab: ClientTab): ClientTab {
  return { ...tab, id: `${TAB_PREFIX}${memberKey(memberId)}:${tab.id}` };
}

export function isClientBrowserCall(tool: string, args: unknown): boolean {
  if (!isRecord(args)) return false;
  return tool === "open" ? args.browser === "chrome" : isString(args.tabId) && args.tabId.startsWith(TAB_PREFIX);
}

const NOTE =
  'chromeTabs are tabs of the person\'s own Chrome, shared with you. They take snapshot, screenshot, navigate, click, type, press, scroll, wait_for and close_tab; open with browser: "chrome" opens one there. The person approves each new site; a denied action is final.';

export function withClientTabs(
  result: DynamicToolResult,
  browser: ClientBrowser | null,
  requesters: readonly string[],
): DynamicToolResult {
  const shared = requesters.flatMap((memberId) => {
    const tabs = browser?.tabs(memberId);
    return tabs ? [tabs.map((tab) => sharedTab(memberId, tab))] : [];
  });
  if (!shared.length) return result;
  const text = JSON.stringify({ chromeTabs: shared.flat(), note: NOTE });
  return { ...result, contentItems: [...result.contentItems, { type: "inputText", text }] };
}

const TOOLS = "snapshot, screenshot, navigate, click, type, press, scroll, wait_for and close_tab";
const UNSUPPORTED = `On a Chrome tab, use only ${TOOLS}.`;
const PERSON_TYPES_SECRETS =
  "On a Chrome tab, the person types passwords and other secrets. Ask the person to type it in that tab, then go on.";
const NOT_SHARED =
  "No person who requested this turn shares Chrome tabs now. Use the OpenBot browser, or ask the person to share tabs with the OpenBot Chrome extension.";

const FAILURES: Record<ClientBrowserFailureCode, string> = {
  denied: "The person denied this action in Chrome. Do not try it again in another way; tell the person.",
  "not-shared": NOT_SHARED,
  "not-found": "The tab is not shared now. Call list_tabs.",
  timeout: "Chrome did not answer in time. The person may not have approved the action yet.",
  failed: "Chrome could not do the action.",
};

function failure(text: string): DynamicToolResult {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

type Target = BrowserToolArguments<"click">["target"];

function clientTarget(target: Target): ClientBrowserTarget | string {
  if (target.kind === "ref") return { ref: target.ref };
  if (target.kind === "point") return { x: target.x, y: target.y };
  if (target.kind === "role") return "On a Chrome tab, use a ref, text, css or point target.";
  if (target.nth !== undefined) return "On a Chrome tab, a target has no nth: use a ref or a more exact selector.";
  return target.kind === "css" ? { css: target.selector } : { text: target.text };
}

function clientCommand(tool: string, args: unknown, tabId: string): ClientBrowserCommand | string {
  if (tool === "submit_secret" || tool === "request_takeover") return PERSON_TYPES_SECRETS;
  let call: ReturnType<typeof parseBrowserToolCall>;
  try {
    call = parseBrowserToolCall(tool, args);
  } catch (error) {
    return error instanceof Error ? error.message : UNSUPPORTED;
  }
  switch (call.tool) {
    case "open":
      return { kind: "open", url: call.args.url };
    case "snapshot":
    case "close_tab":
      return { kind: call.tool, tabId };
    case "screenshot":
      return call.args.ref === undefined ? { kind: "screenshot", tabId } : "On a Chrome tab, screenshot takes no ref.";
    case "navigate":
      if (call.args.url !== undefined) return { kind: "navigate", tabId, url: call.args.url };
      if (call.args.direction !== undefined) return { kind: "navigate", tabId, direction: call.args.direction };
      return "navigate needs url or direction.";
    case "click": {
      const { button, clickCount, modifiers } = call.args;
      if ((button ?? "left") !== "left" || (clickCount ?? 1) !== 1 || modifiers)
        return "On a Chrome tab, click is one left click.";
      const target = clientTarget(call.args.target);
      return isString(target) ? target : { kind: "click", tabId, target };
    }
    case "type": {
      if (!call.args.target) return "On a Chrome tab, type needs a target.";
      if ((call.args.mode ?? "replace") !== "replace") return "On a Chrome tab, type replaces the text.";
      const target = clientTarget(call.args.target);
      if (isString(target)) return target;
      return { kind: "type", tabId, target, text: call.args.text, submit: call.args.submit ?? false };
    }
    case "press":
      return call.args.target
        ? "On a Chrome tab, press takes no target."
        : { kind: "press", tabId, key: call.args.key };
    case "scroll":
      return call.args.target
        ? "On a Chrome tab, scroll takes no target."
        : { kind: "scroll", tabId, deltaX: call.args.deltaX ?? 0, deltaY: call.args.deltaY ?? 0 };
    case "wait_for": {
      const { target, url, state, text, timeoutMs } = call.args;
      if (target || url || state) return "On a Chrome tab, wait_for takes text or timeoutMs only.";
      if (text !== undefined) return { kind: "wait_for", tabId, text };
      return timeoutMs === undefined ? "wait_for needs text or timeoutMs." : { kind: "wait_for", tabId, ms: timeoutMs };
    }
    default:
      return UNSUPPORTED;
  }
}

function toolResult(memberId: string, result: ClientBrowserResult): DynamicToolResult["contentItems"] {
  return [
    ...(result.tab
      ? [{ type: "inputText" as const, text: JSON.stringify({ tab: sharedTab(memberId, result.tab) }) }]
      : []),
    ...(result.text ? [{ type: "inputText" as const, text: result.text }] : []),
    ...(result.image ? [{ type: "inputImage" as const, imageUrl: `data:image/jpeg;base64,${result.image}` }] : []),
  ];
}

export const runClientBrowserTool = Effect.fn("runClientBrowserTool")(function* (
  browser: ClientBrowser | null,
  requesters: readonly string[],
  agent: { id: string; name: string },
  tool: string,
  args: unknown,
) {
  const sharing = requesters.filter((memberId) => browser?.tabs(memberId));
  let memberId: string | undefined;
  let tabId = "";
  if (tool === "open") memberId = sharing[0];
  else if (isRecord(args) && isString(args.tabId)) {
    const [key, ...rest] = args.tabId.slice(TAB_PREFIX.length).split(":");
    memberId = sharing.find((id) => memberKey(id) === key);
    tabId = rest.join(":");
  }
  if (!browser || !memberId) return failure(NOT_SHARED);
  const command = clientCommand(tool, args, tabId);
  if (isString(command)) return failure(command);
  const member = memberId;
  const run = (next: ClientBrowserCommand) =>
    browser.call(member, agent, next).pipe(
      Effect.map((result) => toolResult(member, result)),
      Effect.catchTag("ClientBrowserFailed", (error) =>
        Effect.fail(
          error.code === "failed" && error.message ? `${FAILURES.failed} ${error.message}` : FAILURES[error.code],
        ),
      ),
    );
  const followed =
    isRecord(args) && args.snapshot === true && ["click", "type", "press", "scroll"].includes(tool)
      ? run(command).pipe(
          Effect.flatMap((items) => run({ kind: "snapshot", tabId }).pipe(Effect.map((more) => [...items, ...more]))),
        )
      : run(command);
  return yield* followed.pipe(
    Effect.map(
      (contentItems): DynamicToolResult => ({
        success: true,
        contentItems: contentItems.length ? contentItems : [{ type: "inputText", text: "Done." }],
      }),
    ),
    Effect.catch((text) => Effect.succeed(failure(text))),
  );
});
