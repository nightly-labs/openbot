import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { AttachmentCards } from "./AttachmentCards";

const attachment = {
  id: "brief",
  name: "launch-brief.md",
  size: 1_024,
  kind: "file" as const,
  mimeType: "text/markdown",
  previewKind: "text" as const,
  previewUrl: null,
};

describe("AttachmentCards download", () => {
  it("sends the download action for the selected file", async () => {
    const onAction = vi.fn();
    render(() => <AttachmentCards attachments={[attachment]} onPreview={vi.fn()} onAction={onAction} />);

    const download = await screen.findByRole("button", { name: "Download launch-brief.md" });
    await fireEvent.click(download);

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(attachment, "download");
  });
});
