import { messageImageFiles } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { describe, expect, it, vi } from "vitest";
import { createMessageImageFiles } from "./message-image-files";

// A 1x1 PNG, so a real image takes the same path a named image takes.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

const SCOPE = { serverId: "local", messageId: "message-1", agentId: "agent-1" };

describe("named message images", () => {
  it("reads a file name, and not a line reference after it", () => {
    // `MessageRendering.tsx:433` names a line of another repository's file, not a workspace path.
    expect(messageImageFiles(["`MessageRendering.tsx:433`"])).toEqual([]);
    expect(messageImageFiles(["`example.png`"])).toEqual([{ path: "example.png", kind: "workspace" }]);
  });

  it("shows no preview for a file that is not there, and asks once", async () => {
    const previewWorkspaceFile = vi.fn(async () => ({
      name: "example.png",
      size: 0,
      mimeType: "application/octet-stream",
      previewKind: "none" as const,
      bytes: null,
      missing: true,
    }));
    const files = createMessageImageFiles({ previewSharedFile: vi.fn(), previewWorkspaceFile });
    const file = { path: "example.png", kind: "workspace" as const };

    await expect(files(file, SCOPE)).resolves.toBeNull();
    await expect(files(file, SCOPE)).resolves.toBeNull();
    expect(previewWorkspaceFile).toHaveBeenCalledTimes(1);
  });

  it("shows a real workspace image inline, and reads it once", async () => {
    const previewWorkspaceFile = vi.fn(async () => ({
      name: "dot.png",
      size: PNG.byteLength,
      mimeType: "image/png",
      previewKind: "image" as const,
      bytes: PNG,
    }));
    const files = createMessageImageFiles({ previewSharedFile: vi.fn(), previewWorkspaceFile });
    const file = { path: "dot.png", kind: "workspace" as const };

    const shown = await files(file, SCOPE);
    expect(shown).toMatch(/^data:image\/png;base64,/u);
    await expect(files(file, SCOPE)).resolves.toBe(shown);
    expect(previewWorkspaceFile).toHaveBeenCalledTimes(1);
  });
});
