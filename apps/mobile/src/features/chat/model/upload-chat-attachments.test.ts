import { describe, expect, it } from "vitest";
import { uploadChatAttachments } from "./upload-chat-attachments";

const files = ["first.txt", "second.csv"].map((name) => ({ name, mimeType: "text/plain", base64: btoa(name) }));
describe("chat attachment send", () => {
  it("associates all uploaded IDs with one message in selection order", async () => {
    const progress: number[] = [];
    const sent: string[][] = [];
    const result = await uploadChatAttachments(files, {
      upload: async (file) => ({ id: file.name }),
      discard: async () => {},
      send: async (ids) => {
        sent.push(ids);
        return "message";
      },
      cancelled: () => false,
      progress: (count) => progress.push(count),
    });
    expect({ result, sent, progress }).toEqual({
      result: "message",
      sent: [["first.txt", "second.csv"]],
      progress: [0, 1, 2],
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
