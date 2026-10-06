import { CHAT_HTML_PREVIEW_POLICY } from "@openbot/contracts/chat-preview";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { render, screen } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";

// Agent HTML, also from a teammate's host, renders inside the renderer that holds the IPC bridge.
it("shows agent HTML in a frame that runs no scripts and loads nothing from a server", async () => {
  const body = ["```html", '<img src="https://example.com/pixel.png"><script>parent.openbot</script>', "```"].join(
    "\n",
  );
  render(() => <MarkdownMessageText body={body} agents={[]} onSelectAgent={vi.fn()} onOpenLink={vi.fn()} />);

  const frame = await screen.findByTitle("HTML preview");
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
  const page = frame.getAttribute("srcdoc") ?? "";
  expect(page.indexOf(CHAT_HTML_PREVIEW_POLICY)).toBeGreaterThan(-1);
  expect(page.indexOf(CHAT_HTML_PREVIEW_POLICY)).toBeLessThan(page.indexOf("<script>"));
  expect(CHAT_HTML_PREVIEW_POLICY).toContain("default-src 'none'");
  expect(CHAT_HTML_PREVIEW_POLICY).not.toContain("script-src");
});
