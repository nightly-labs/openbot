import { CHAT_VISUAL_FRAME_SANDBOX } from "@openbot/contracts/chat-visual";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

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
