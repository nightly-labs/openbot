import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { describe, expect, it } from "vitest";
import { type ChatMessage, type PendingChatMessage, presentChatMessages } from "./chat-messages";
import { retainConfirmedAttachments, uploadChatAttachments } from "./upload-chat-attachments";

const files = ["first.txt", "second.csv"].map((name) => ({ name, mimeType: "text/plain", base64: btoa(name) }));
describe("chat attachment send", () => {
  it.each([true, false])("associates uploads with one message (progress enabled: %s)", async (showProgress) => {
    const progress: number[] = [];
    const sent: string[][] = [];
    const result = await uploadChatAttachments(files, {
      upload: async (file) => ({ id: file.name }),
      discard: async () => {},
      send: async (ids) => {
        sent.push(ids);
        return "message";
      },
      ...(showProgress ? { cancelled: () => false, progress: (count: number) => progress.push(count) } : {}),
    });
    expect({ result, sent, progress }).toEqual({
      result: "message",
      sent: [["first.txt", "second.csv"]],
      progress: showProgress ? [0, 1, 2] : [],
    });
  });
  it.each(["cancel", "failure"])(
    "discards only this attempt's drafts on %s and leaves selected files for retry",
    async (mode) => {
      const discarded: string[] = [];
      let cancelled = false;
      let sent = false;
      await expect(
        uploadChatAttachments(files, {
          upload: async (file) => {
            if (file.name === "second.csv") throw new Error("upload failed");
            cancelled = mode === "cancel";
            return { id: file.name };
          },
          discard: async (id) => {
            discarded.push(id);
          },
          send: async () => {
            sent = true;
            return "message";
          },
          cancelled: () => cancelled,
          progress: () => {},
        }),
      ).rejects.toThrow(mode === "cancel" ? "cancelled" : "upload failed");
      expect({ discarded, sent, names: files.map((file) => file.name) }).toEqual({
        discarded: ["first.txt"],
        sent: false,
        names: ["first.txt", "second.csv"],
      });
    },
  );
});

it("keeps local images until the receipt maps them to final attachment IDs", () => {
  const local = { ...files[0], uri: "file:///photo.png" };
  const pending: PendingChatMessage = {
    serverId: "receipt",
    baseline: new Set(),
    message: { id: "local", kind: "message", author: "user", body: "photo", streaming: false },
  };
  const confirmed: ChatMessage = {
    ...pending.message,
    id: "receipt",
    attachments: [
      {
        id: "final-id",
        name: local.name,
        mimeType: local.mimeType,
        size: 5,
        kind: "image",
        previewKind: "none",
        previewUrl: null,
      },
    ],
  };
  const retained = new Map<string, RemoteFileUpload & { localUri?: string }>();
  const retain = (id: string, file: RemoteFileUpload & { localUri?: string }) => retained.set(id, file);
  expect(retainConfirmedAttachments([confirmed], "another-receipt", [local], retain)).toBe(false);
  expect(retained.size).toBe(0);
  expect(presentChatMessages([confirmed], pending, new Map())[0]).toBe(pending.message);
  expect(retainConfirmedAttachments([confirmed], "receipt", [local], retain)).toBe(true);
  expect(retained.get("final-id")).toEqual({
    name: local.name,
    mimeType: local.mimeType,
    base64: local.base64,
    localUri: local.uri,
  });
  expect(presentChatMessages([confirmed], null, new Map())[0]).toBe(confirmed);
});
