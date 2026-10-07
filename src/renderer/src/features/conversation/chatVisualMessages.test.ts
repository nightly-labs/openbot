import {
  CHAT_VISUAL_MAX_HEIGHT,
  chatVisualDocument,
  chatVisualFrameHeight,
  parseChatVisualMessage,
} from "@openbot/contracts/chat-visual";
import { describe, expect, it } from "vitest";

// A visual reply page runs the agent's scripts, so every message it posts is untrusted input.
describe("parseChatVisualMessage", () => {
  it("reads a size report and a web link request", () => {
    expect(
      parseChatVisualMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 312.5 } }),
    ).toEqual({ type: "size", height: 312.5 });
    expect(
      parseChatVisualMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "ui/open-link",
        params: { url: "https://openbot.run/docs" },
      }),
    ).toEqual({ type: "open-link", id: 3, url: "https://openbot.run/docs" });
  });

  it.each([
    ["no JSON-RPC version", { method: "ui/notifications/size-changed", params: { height: 10 } }],
    ["an unknown method", { jsonrpc: "2.0", method: "ui/message", params: { text: "hi" } }],
    [
      "a height that is not a number",
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: "9" } },
    ],
    ["an infinite height", { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Infinity } }],
    ["a negative height", { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: -1 } }],
    ["a script link", { jsonrpc: "2.0", id: 1, method: "ui/open-link", params: { url: "javascript:alert(1)" } }],
    ["a file link", { jsonrpc: "2.0", id: 1, method: "ui/open-link", params: { url: "file:///etc/passwd" } }],
    ["a link without an id", { jsonrpc: "2.0", method: "ui/open-link", params: { url: "https://openbot.run" } }],
    ["a string", "ui/open-link https://openbot.run"],
    ["null", null],
  ])("rejects %s", (_name, data) => {
    expect(parseChatVisualMessage(data)).toBeNull();
  });

  it("keeps a huge reported height inside the frame limit and the agent's height", () => {
    expect(chatVisualFrameHeight(1e9)).toBe(CHAT_VISUAL_MAX_HEIGHT);
    expect(chatVisualFrameHeight(1e9, 400)).toBe(400);
  });
});

describe("chatVisualDocument", () => {
  const bootstrapBefore = (document: string, marker: string) =>
    document.indexOf('id="openbot-visual-bootstrap"') < document.indexOf(marker);

  it("puts the bootstrap before the agent's first script in its head", () => {
    const page = chatVisualDocument(
      '<!doctype html><html><head><script src="https://cdn.test/a.js"></script></head></html>',
    );
    expect(page.startsWith("<!doctype html><html><head><meta")).toBe(true);
    expect(bootstrapBefore(page, "cdn.test")).toBe(true);
  });

  it("does not take a head tag from a comment or a script", () => {
    for (const html of [
      "<!-- <head> --><script>window.agent = 1</script>",
      '<script>document.write("<head>")</script><p>agent</p>',
    ]) {
      const page = chatVisualDocument(html);
      expect(bootstrapBefore(page, "agent")).toBe(true);
    }
  });

  it("wraps a fragment in a page", () => {
    const page = chatVisualDocument("<p>Runs</p>");
    expect(page.startsWith("<!doctype html><html><head>")).toBe(true);
    expect(bootstrapBefore(page, "<p>Runs</p>")).toBe(true);
  });
});
