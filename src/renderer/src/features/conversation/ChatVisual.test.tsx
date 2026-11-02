import {
  CHAT_VISUAL_CONTEXT_LIMIT,
  CHAT_VISUAL_FRAME_SANDBOX,
  type ChatVisualKey,
  parseChatVisualMessage,
} from "@openbot/contracts/chat-visual";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

// The browser client shows an agent's page from its HTML. The page runs scripts next to the app
// origin, which keeps the host device keys, so the frame must give it an opaque origin.
describe("ChatVisual from HTML", () => {
  it("shows the page as srcdoc in the sandbox, never from a URL", async () => {
    render(() => <ChatVisual html="<p>Chart</p>" title="Launch chart" onOpenLink={vi.fn()} />);

    const frame = screen.getByTitle("Launch chart");
    await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("<p>Chart</p>"));
    expect(frame).not.toHaveAttribute("src");
    expect(frame.getAttribute("sandbox")).toBe(CHAT_VISUAL_FRAME_SANDBOX);
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("gives the page no same-origin access, popups, downloads or top navigation", () => {
    const tokens = CHAT_VISUAL_FRAME_SANDBOX.split(/\s+/u);
    expect(tokens).toEqual(["allow-scripts", "allow-forms"]);
  });

  it("opens no link that a window other than the frame asks for", async () => {
    const onOpenLink = vi.fn();
    render(() => <ChatVisual html="<p>Chart</p>" title="Launch chart" onOpenLink={onOpenLink} />);
    const frame = screen.getByTitle("Launch chart");
    await waitFor(() => expect(frame).toHaveAttribute("srcdoc"));

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { jsonrpc: "2.0", id: 1, method: "ui/open-link", params: { url: "https://example.com" } },
      }),
    );

    expect(onOpenLink).not.toHaveBeenCalled();
  });
});

// A page acts for the user only from its own frame, and only right after a click or a key in it.
describe("ChatVisual page requests", () => {
  const message = (text: string) => ({
    jsonrpc: "2.0",
    id: 7,
    method: "ui/message",
    params: { role: "user", content: [{ type: "text", text }] },
  });
  const context = (text: string) => ({
    jsonrpc: "2.0",
    id: 8,
    method: "ui/update-model-context",
    params: { content: [{ type: "text", text }] },
  });
  const key = (init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) => ({
    jsonrpc: "2.0",
    method: "openbot/notifications/keydown",
    params: { code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init },
  });

  async function renderPage(props: { isAppShortcut?: (key: ChatVisualKey) => boolean } = {}) {
    const onMessage = vi.fn();
    const onContext = vi.fn();
    render(() => (
      <ChatVisual
        html="<p>Choice</p>"
        title="Pick a plan"
        onOpenLink={vi.fn()}
        onMessage={onMessage}
        onContext={onContext}
        isAppShortcut={props.isAppShortcut}
      />
    ));
    const frame = screen.getByTitle<HTMLIFrameElement>("Pick a plan");
    await waitFor(() => expect(frame).toHaveAttribute("srcdoc"));
    const page = frame.contentWindow;
    if (!page) throw new Error("The frame has no window.");
    const post = (data: unknown, source: Window = page) =>
      window.dispatchEvent(new MessageEvent("message", { source, data }));
    /** The page asks for a message and the context, which both change the draft. */
    const ask = (source?: Window) => {
      post(message("Pick B"), source);
      post(context("Count 3"), source);
    };
    return { frame, onMessage, onContext, post, ask };
  }

  function userActs(active: boolean) {
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: active } });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "userActivation");
  });

  it("puts a message or the context in the composer only after the user acts in the frame", async () => {
    const { frame, onMessage, onContext, ask } = await renderPage();

    userActs(true);
    ask(window);
    userActs(false);
    frame.focus();
    ask();
    userActs(true);
    frame.blur();
    ask();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onContext).not.toHaveBeenCalled();

    frame.focus();
    ask();
    expect(onMessage).toHaveBeenCalledWith("Pick B");
    expect(onContext).toHaveBeenCalledWith("Count 3");
  });

  it("gives the app only the shortcuts that it accepts", async () => {
    const { frame, post } = await renderPage({ isAppShortcut: (shortcut) => shortcut.key === "k" });
    const keys: string[] = [];
    const onKey = (event: KeyboardEvent) => keys.push(event.key);
    window.addEventListener("keydown", onKey);
    userActs(true);
    frame.focus();

    post(key({ key: "w", metaKey: true }));
    post(key({ key: "k", metaKey: true }), window);
    userActs(false);
    post(key({ key: "k", metaKey: true }));
    userActs(true);
    post(key({ key: "k", metaKey: true }));

    window.removeEventListener("keydown", onKey);
    expect(keys).toEqual(["k"]);
  });

  it("refuses an image that is not a web or image data URL, and text over the limits", () => {
    const image = (src: string) => ({
      jsonrpc: "2.0",
      method: "openbot/notifications/open-image",
      params: { src, name: "Chart" },
    });
    expect(parseChatVisualMessage(image("https://example.com/chart.png"))).toEqual({
      type: "open-image",
      src: "https://example.com/chart.png",
      name: "Chart",
    });
    expect(parseChatVisualMessage(image("javascript:alert(1)"))).toBeNull();
    expect(parseChatVisualMessage(image("data:text/html,<script>alert(1)</script>"))).toBeNull();
    expect(parseChatVisualMessage(image("http://example.com/chart.png"))).toBeNull();

    // A request with text out of range is refused, so the page's promise fails and does not wait.
    expect(parseChatVisualMessage(message("x".repeat(INPUT_LIMITS.messageText + 1)))).toEqual({
      type: "refused",
      id: 7,
    });
    expect(parseChatVisualMessage({ ...message("Pick B"), params: { role: "assistant", content: [] } })).toEqual({
      type: "refused",
      id: 7,
    });
    expect(parseChatVisualMessage(context("x".repeat(CHAT_VISUAL_CONTEXT_LIMIT + 1)))).toEqual({
      type: "refused",
      id: 8,
    });
    expect(parseChatVisualMessage(key({ key: "a" }))).toBeNull();
  });
});
