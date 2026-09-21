import { decodeTeamProtocolV1Event, encodeTeamProtocolV1Event } from "@openbot/contracts/team-protocol/v1";
import { describe, expect, it } from "vitest";
import { browserInputAction } from "./browser-tool-actions";
import {
  BROWSER_DYNAMIC_TOOLS,
  BROWSER_TOOL_DEFINITIONS,
  OPENBOT_BROWSER_NAMESPACE,
  parseBrowserToolArguments,
  parseBrowserToolCall,
} from "./browser-tools";

describe("browser tool catalog", () => {
  it("publishes one complete provider-neutral catalog without schema drift", () => {
    const names = BROWSER_TOOL_DEFINITIONS.map((definition) => definition.name);
    const dynamicNames = BROWSER_DYNAMIC_TOOLS[0].tools.map((definition) => definition.name);

    expect(BROWSER_DYNAMIC_TOOLS[0].name).toBe(OPENBOT_BROWSER_NAMESPACE);
    expect(dynamicNames).toEqual(names);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "request_takeover",
        "snapshot",
        "navigate",
        "click",
        "type",
        "press",
        "hover",
        "scroll",
        "select_option",
        "set_checked",
        "drag",
        "upload_files",
        "wait_for",
        "evaluate",
        "set_environment",
        "recording_start",
        "recording_stop",
        "act",
      ]),
    );
    for (const tool of BROWSER_DYNAMIC_TOOLS[0].tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(BROWSER_DYNAMIC_TOOLS[0].tools.find((tool) => tool.name === "evaluate")?.inputSchema).toMatchObject({
      type: "object",
      required: ["tabId", "expression"],
      properties: {
        expression: { type: "string", minLength: 1, maxLength: 64_000 },
        awaitPromise: { type: "boolean" },
        timeoutMs: { type: "integer", minimum: 0, maximum: 30_000 },
      },
      additionalProperties: false,
    });
  });

  it("requires an explicit submission mode instead of ambiguous auto for secret entry", () => {
    const args = {
      tabId: "tab",
      method: "otp",
      digits: 6,
      targets: [{ kind: "ref", ref: "code", revision: 1 }],
      submitTarget: { kind: "ref", ref: "continue", revision: 1 },
    };
    expect(() => parseBrowserToolArguments("submit_secret", { ...args, submission: "auto" })).toThrow(
      "Invalid browser tool arguments",
    );
    expect(parseBrowserToolArguments("submit_secret", { ...args, submission: "click" })).toMatchObject({
      submission: "click",
      submitTarget: args.submitTarget,
    });
  });

  it("bounds evaluate input and rejects remote-object mode", () => {
    expect(
      parseBrowserToolArguments("evaluate", {
        tabId: "tab",
        expression: "Promise.resolve({ ok: true })",
        awaitPromise: true,
        timeoutMs: 10_000,
      }),
    ).toMatchObject({
      expression: "Promise.resolve({ ok: true })",
      awaitPromise: true,
    });
    expect(() =>
      parseBrowserToolArguments("evaluate", {
        tabId: "tab",
        expression: "   ",
      }),
    ).toThrow("Invalid browser tool arguments");
    expect(() =>
      parseBrowserToolArguments("evaluate", {
        tabId: "tab",
        expression: "x".repeat(64_001),
      }),
    ).toThrow("Invalid browser tool arguments");
    expect(() =>
      parseBrowserToolArguments("evaluate", {
        tabId: "tab",
        expression: "1",
        returnByValue: false,
      }),
    ).toThrow("Invalid browser tool arguments");
  });

  it("types into the focused page when a canvas application has no element to target", () => {
    const typeCall = (value: unknown) => {
      const call = parseBrowserToolCall("type", value);
      if (call.tool !== "type") throw new Error(`Expected a type call, got ${call.tool}.`);
      return call;
    };

    const focusedCall = typeCall({ tabId: "tab", text: "12\tDone\n" });
    expect(focusedCall.args).toEqual({ tabId: "tab", text: "12\tDone\n" });
    expect(browserInputAction(focusedCall, {}).target).toBeUndefined();
    // Replace and append describe a node's value, so honouring either one for keystrokes the page
    // interprets itself would report an edit that never happened.
    expect(() => browserInputAction(typeCall({ tabId: "tab", text: "x", mode: "replace" }), {})).toThrow(
      "type mode requires a target",
    );
  });

  it("rejects blank semantic and CSS targets", () => {
    for (const target of [
      { kind: "role", role: "button", name: "   " },
      { kind: "role", role: "   " },
      { kind: "text", text: "\t\n" },
      { kind: "css", selector: "   " },
    ]) {
      expect(() => parseBrowserToolArguments("click", { tabId: "tab", target })).toThrow(
        "Invalid browser tool arguments",
      );
    }
  });

  it("rejects inputs that the browser host cannot execute", () => {
    for (const [tool, args] of [
      ["snapshot", { tabId: "   " }],
      ["open", { url: "\t" }],
      ["press", { tabId: "tab", key: " " }],
      ["click", { tabId: "tab", target: { kind: "point", x: 1, y: 1 }, modifiers: [] }],
      ["wait_for", { tabId: "tab", text: "", state: "load" }],
      ["wait_for", { tabId: "tab", url: " ", state: "load" }],
      ["act", { tabId: "tab", revision: 1, action: { type: "click" } }],
      ["act", { tabId: "tab", revision: 1, action: { type: "type", ref: "ref", text: "" } }],
      ["act", { tabId: "tab", revision: 1, action: { type: "key", key: "x".repeat(33) } }],
      ["act", { tabId: "tab", revision: 1, action: { type: "scroll" } }],
      ["upload_files", { tabId: "tab", target: { kind: "point", x: 1, y: 1 }, paths: [""] }],
    ] as const) {
      expect(() => parseBrowserToolCall(tool, args)).toThrow("Invalid browser tool arguments");
    }
  });

  it("preserves input text, empty selections, and legacy unused fields", () => {
    const target = { kind: "point", x: 1, y: 1 };
    expect(parseBrowserToolCall("type", { tabId: " tab ", target, text: "", timeoutMs: 0 })).toEqual({
      tool: "type",
      args: { tabId: " tab ", target, text: "", timeoutMs: 0 },
    });
    expect(parseBrowserToolCall("press", { tabId: "tab", key: " Enter " }).args).toMatchObject({ key: " Enter " });
    expect(parseBrowserToolCall("select_option", { tabId: "tab", target, values: [""] }).args).toMatchObject({
      values: [""],
    });
    expect(parseBrowserToolCall("upload_files", { tabId: "tab", target, paths: [" "] }).args).toMatchObject({
      paths: [" "],
    });
    expect(
      parseBrowserToolCall("click", { tabId: "tab", target: { kind: "ref", ref: " ", revision: 1 } }).args,
    ).toMatchObject({
      target: { ref: " " },
    });
    expect(
      parseBrowserToolCall("act", { tabId: "tab", revision: 1, action: { type: "back", ref: " ", text: "" } }).args,
    ).toMatchObject({
      action: { type: "back" },
    });
    expect(() => parseBrowserToolCall("missing-tool", {})).toThrow("Unknown browser tool: missing-tool");
  });

  it("keeps detailed local activity compatible with frozen Team API v1", () => {
    const encoded = encodeTeamProtocolV1Event({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "session",
            threadId: "thread",
            turnId: "turn",
            callId: "call",
            tabId: "tab",
            action: "snapshot",
            detailAction: "set-environment",
            phase: "acting",
            startedAt: new Date(0).toISOString(),
          },
        ],
      },
    });

    expect(encoded).not.toBeNull();
    const decoded = decodeTeamProtocolV1Event(JSON.parse(encoded ?? "null"));
    expect(decoded.kind).toBe("known");
    expect(encoded).not.toContain("detailAction");
  });
});
