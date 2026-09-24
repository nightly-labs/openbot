import { describe, expect, it } from "vitest";
import type { RemoteFileUpload } from "./file-upload";
import { type TeamApiRequest, uploadAttachmentDraft } from "./team-api-requests";

describe("shared Team API requests", () => {
  it("sends an attachment draft with its name and type, and rejects a body that is not an attachment", async () => {
    const sent: { method: string; path: string; upload?: RemoteFileUpload }[] = [];
    const reply =
      (body: unknown): TeamApiRequest =>
      async (method, path, decode, _body, upload) => {
        sent.push({ method, path, upload });
        return decode(body);
      };
    const upload = { name: "notes one.txt", mimeType: "text/plain", base64: "aGk=" };
    const attachment = {
      id: "draft-1",
      name: "notes one.txt",
      mimeType: "text/plain",
      size: 2,
      kind: "file",
      previewKind: "text",
      previewUrl: null,
    };

    await expect(uploadAttachmentDraft(reply(attachment), upload)).resolves.toEqual(attachment);
    expect(sent).toEqual([{ method: "POST", path: "/v1/attachments?name=notes+one.txt&mime=text%2Fplain", upload }]);
    await expect(uploadAttachmentDraft(reply({ id: "draft-1" }), upload)).rejects.toThrow(
      "The host returned an invalid attachment.",
    );
  });
});
