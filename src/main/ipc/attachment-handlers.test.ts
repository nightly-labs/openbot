// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

type Invoke = (event: { senderFrame: { url: string } }, payload: unknown) => Promise<void>;
const { bound, saveDialog } = vi.hoisted(() => ({
  bound: new Map<string, Invoke>(),
  saveDialog: vi.fn<(options?: unknown) => Promise<{ canceled: boolean; filePath?: string }>>(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showSaveDialog: saveDialog },
  shell: {},
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));
const { saveAttachmentArchive, attachmentIpcHandlers } = await import("./attachment-handlers");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function destination() {
  const directory = await mkdtemp(join(tmpdir(), "attachment-zip-"));
  directories.push(directory);
  return join(directory, "attachments.zip");
}
const input = {
  attachments: [
    { id: "one", name: "../report.txt" },
    { id: "two", name: "folder\\report.txt" },
    { id: "three", name: "REPORT (2).txt" },
  ],
};

describe("attachment ZIP downloads", () => {
  it("preserves bytes and order while making duplicate and unsafe names safe", async () => {
    const path = await destination();
    await saveAttachmentArchive(
      input,
      async () => path,
      async (item) => new TextEncoder().encode(item.id),
    );
    const files = unzipSync(await readFile(path));
    expect(Object.keys(files)).toEqual(["./report.txt", "./report (2).txt", "./REPORT (2) (2).txt"]);
    expect(Object.values(files).map((bytes) => strFromU8(bytes))).toEqual(["one", "two", "three"]);
    expect(await readdir(join(path, ".."))).toEqual(["attachments.zip"]);
  });
  it("does not read any attachments when the save dialog is cancelled", async () => {
    const read = vi.fn();
    await saveAttachmentArchive(input, async () => undefined, read);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["missing", "file limit", "total limit"])("keeps the destination unchanged after %s", async (failure) => {
    const path = await destination();
    await writeFile(path, "existing");
    await expect(
      saveAttachmentArchive(
        input,
        async () => path,
        async () => {
          if (failure === "missing") throw new Error("Attachment was not found.");
          return new Uint8Array(
            failure === "file limit" ? ATTACHMENT_LIMITS.fileBytes + 1 : ATTACHMENT_LIMITS.fileBytes,
          );
        },
      ),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("existing");
    expect(await readdir(join(path, ".."))).toEqual(["attachments.zip"]);
  });
  it("removes the temporary archive if the destination cannot be replaced", async () => {
    const path = await destination();
    const directory = join(path, "..");
    await expect(
      saveAttachmentArchive(
        input,
        async () => directory,
        async () => new Uint8Array([1]),
      ),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});

describe("ZIP attachment IPC", () => {
  function register(sourcePath: string) {
    const handlers = attachmentIpcHandlers({
      getMainWindow: () => null,
      service: {
        prepareAttachments: vi.fn(),
        prepareImportedAttachments: vi.fn(),
        discardDraftAttachment: vi.fn(),
        resolveSharedFile: vi.fn(),
        resolveWorkspaceFile: vi.fn(),
      },
      mailbox: { resolveAttachment: async () => ({ path: sourcePath, mimeType: "text/plain", name: "source.txt" }) },
      remoteServers: {
        supportsCapability: vi.fn(),
        request: vi.fn(),
        downloadSharedFile: vi.fn(),
        downloadWorkspaceFile: vi.fn(),
        uploadAttachment: vi.fn(),
        downloadAttachment: async (id, serverId) => ({
          name: id,
          mimeType: "text/plain",
          bytes: new TextEncoder().encode(`${serverId}:${id}`),
        }),
      },
    });
    handlers.agentAttachments.downloadAttachments("download");
    const invoke = bound.get("download");
    if (!invoke) throw new Error("Download handler was not registered.");
    return invoke;
  }
  it.each(["local", "remote-host"])("downloads managed attachments from %s", async (serverId) => {
    const path = await destination();
    const sourcePath = join(path, "..", "source.txt");
    await writeFile(sourcePath, "local file");
    saveDialog.mockResolvedValue({ canceled: false, filePath: path });
    const invoke = register(sourcePath);
    await invoke({ senderFrame: { url: "openbot-app://app/index.html" } }, { serverId, payload: input });
    const files = unzipSync(await readFile(path));
    expect(Object.values(files).map((bytes) => strFromU8(bytes))).toEqual(
      input.attachments.map((item) => (serverId === "local" ? "local file" : `${serverId}:${item.id}`)),
    );
  });
  it("rejects an untrusted sender before opening a save dialog", async () => {
    saveDialog.mockClear();
    const invoke = register("unused");
    expect(() =>
      invoke({ senderFrame: { url: "https://example.com" } }, { serverId: "local", payload: input }),
    ).toThrow("Rejected IPC request from an untrusted renderer.");
    expect(saveDialog).not.toHaveBeenCalled();
  });
});

describe("single attachment download", () => {
  function registerSingle(resolved: { path: string; mimeType: string; name: string }) {
    const handlers = attachmentIpcHandlers({
      getMainWindow: () => null,
      service: {
        prepareAttachments: vi.fn(),
        prepareImportedAttachments: vi.fn(),
        discardDraftAttachment: vi.fn(),
        resolveSharedFile: vi.fn(),
        resolveWorkspaceFile: vi.fn(),
      },
      mailbox: { resolveAttachment: async () => resolved },
      remoteServers: {
        supportsCapability: vi.fn(),
        request: vi.fn(),
        downloadSharedFile: vi.fn(),
        downloadWorkspaceFile: vi.fn(),
        uploadAttachment: vi.fn(),
        downloadAttachment: vi.fn(),
      },
    });
    handlers.agentAttachments.openAttachment("single-download");
    const invoke = bound.get("single-download");
    if (!invoke) throw new Error("Open handler was not registered.");
    return invoke;
  }

  it("suggests the original file name instead of a mime-derived name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attachment-single-"));
    directories.push(directory);
    const sourcePath = join(directory, "launch-brief.md");
    await writeFile(sourcePath, "brief");
    const targetPath = join(directory, "saved.md");
    saveDialog.mockClear();
    saveDialog.mockResolvedValue({ canceled: false, filePath: targetPath });
    const invoke = registerSingle({ path: sourcePath, mimeType: "text/markdown", name: "launch-brief.md" });
    await invoke(
      { senderFrame: { url: "openbot-app://app/index.html" } },
      { serverId: "local", payload: { attachmentId: "some-id", action: "download" } },
    );
    expect(saveDialog).toHaveBeenCalledOnce();
    expect(saveDialog.mock.calls[0]?.[0]).toMatchObject({ defaultPath: expect.stringMatching(/launch-brief\.md$/) });
    expect(await readFile(targetPath, "utf8")).toBe("brief");
  });
});
