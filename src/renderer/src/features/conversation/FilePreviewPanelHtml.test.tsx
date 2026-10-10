import type { FilePreview } from "@openbot/contracts/ipc";
import FilePreviewPanel from "@openbot/ui/features/conversation/FilePreviewPanel";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { expect, it, vi } from "vitest";
import { createServerConversationState } from "./conversation-controller";

it("keeps the page through source toggles and view disposal, then releases it with preview state", async () => {
  const release = vi.fn();
  const html = "<h1>Local report</h1>";
  const bytes = new TextEncoder().encode(html);
  const pageUrl = "openbot-visual://preview/6e25cdd3-e985-4b45-8f86-572bb037ed50";
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createServerConversationState(release);
  });
  const setPreview = (preview: FilePreview) =>
    state.setSidebarFilePreview({
      ownerAgentId: "preview-test",
      source: { kind: "workspace", path: preview.name },
      preview,
    });
  const preview = () => state.sidebarFilePreview()?.preview;
  setPreview({
    name: "report.html",
    size: bytes.byteLength,
    mimeType: "text/html",
    previewKind: "text",
    bytes,
    pageUrl,
  });
  const view = render(() => (
    <FilePreviewPanel
      preview={preview() ?? null}
      pageUrl={preview()?.pageUrl}
      agents={[]}
      defaultWidth={() => 480}
      maxWidth={() => 900}
      onWidthChange={vi.fn()}
      readWidth={(width) => width}
      onResizeEnd={vi.fn()}
      onResetWidth={vi.fn()}
      readWrapLines={() => false}
      onWrapLinesChange={vi.fn()}
      onOpenLink={vi.fn()}
      onOpenSharedFile={vi.fn()}
      onOpenWorkspaceFile={vi.fn()}
      onOpenExternally={vi.fn()}
      onClose={vi.fn()}
    />
  ));

  await screen.findByRole("button", { name: "Show HTML source" });
  await fireEvent.click(screen.getByRole("button", { name: "Show HTML source" }));
  expect(await screen.findByText(html)).toBeInTheDocument();
  expect(release).not.toHaveBeenCalledWith(pageUrl);
  await fireEvent.click(screen.getByRole("button", { name: "Show HTML source" }));
  expect(screen.queryByText(html)).not.toBeInTheDocument();
  expect(release).not.toHaveBeenCalledWith(pageUrl);

  const nextUrl = "openbot-visual://preview/48f67909-d4c9-46b5-b973-1e87b68af721";
  setPreview({
    name: "next.html",
    size: bytes.byteLength,
    mimeType: "text/html",
    previewKind: "text",
    bytes,
    pageUrl: nextUrl,
  });
  await screen.findByRole("heading", { name: "next.html" });
  expect(release).toHaveBeenCalledWith(pageUrl);
  view.unmount();
  expect(release).not.toHaveBeenCalledWith(nextUrl);
  dispose();
  expect(release).toHaveBeenLastCalledWith(nextUrl);
});
