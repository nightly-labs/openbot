// @vitest-environment node

// Who may read and change the host machine's storage from a joined server. The authority is
// deliberate and frozen by `storage-v1`: every member reads sizes, chat titles and file names;
// only an owner or an admin deletes a file or clears caches and logs.

import { decodeStorageUsage, type GetStorageUsageInput, type StorageUsage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { StorageNotFoundError } from "../backend/storage-usage";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const usage: StorageUsage = {
  scope: "host",
  agentId: null,
  conversationId: null,
  scannedAt: "2026-09-23T10:00:00.000Z",
  freeBytes: 1_000,
  breakdown: [{ category: "logs", bytes: 6, removable: true }],
  agents: [],
  conversations: [],
  files: [
    {
      id: "sent",
      name: "report.pdf",
      size: 5,
      kind: "file",
      mimeType: "application/pdf",
      previewKind: "pdf",
      previewUrl: null,
      source: "attachment",
      agentId: "chief",
      conversation: { id: "thread-chief", title: "Quarterly report" },
      messageId: "message-1",
      createdAt: "2026-09-02T00:00:00.000Z",
      status: "available",
      deletable: true,
    },
  ],
  truncated: false,
};

function createStorage(): NonNullable<TeamApiOptions["storage"]> & {
  requests: GetStorageUsageInput[];
  deleted: string[];
  cleared: string[];
} {
  const requests: GetStorageUsageInput[] = [];
  const deleted: string[] = [];
  const cleared: string[] = [];
  return {
    requests,
    deleted,
    cleared,
    usage: async (input) => {
      requests.push(input);
      return usage;
    },
    deleteFile: async (fileId) => {
      if (fileId !== "sent") throw new StorageNotFoundError("The file does not exist or is already deleted.");
      deleted.push(fileId);
    },
    clear: async (category) => {
      cleared.push(category);
    },
  };
}

describe("Team API storage access", () => {
  it("lets every member read and only an admin delete or clear", async () => {
    const storage = createStorage();
    const fixture = await createTeamApiFixture("storage", { configure: true });
    const { base } = await fixture.start({ storage });
    const headers = {
      Authorization: `Bearer ${await fixture.signIn()}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "storage-v1",
      "Content-Type": "application/json",
    };
    const invite = await fixture.store.createInvite("member");
    const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
    const asMember = { ...headers, Authorization: `Bearer ${member.sessionToken}` };
    const post = (path: string, body: Record<string, string | boolean>, as = headers) =>
      fetch(`${base}${path}`, { method: "POST", headers: as, body: JSON.stringify(body) });

    // Without the capability the routes answer 400: the connection did not ask for the feature.
    expect(
      (await post("/v1/storage/usage", { scope: "host" }, { ...headers, "OpenBot-Capabilities": "" })).status,
    ).toBe(400);

    const read = await post("/v1/storage/usage", { scope: "host", force: true }, asMember);
    expect(read.status).toBe(200);
    expect(decodeStorageUsage(await read.json())).toEqual(usage);
    expect(storage.requests).toEqual([{ scope: "host", force: true }]);

    expect((await post("/v1/storage/delete-file", { fileId: "sent" }, asMember)).status).toBe(403);
    expect((await post("/v1/storage/clear", { category: "logs" }, asMember)).status).toBe(403);
    expect(storage.deleted).toEqual([]);
    expect(storage.cleared).toEqual([]);

    const deleted = await post("/v1/storage/delete-file", { fileId: "sent" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({});
    const missing = await post("/v1/storage/delete-file", { fileId: "sent-again" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "The file does not exist or is already deleted." });
    // Only caches and logs can be cleared; the codec refuses anything else before the host sees it.
    expect((await post("/v1/storage/clear", { category: "workspaces" })).status).toBe(400);
    expect((await post("/v1/storage/clear", { category: "caches" })).status).toBe(200);
    expect(storage.deleted).toEqual(["sent"]);
    expect(storage.cleared).toEqual(["caches"]);

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility).toMatchObject({ capabilities: expect.arrayContaining(["storage-v1"]) });
  });

  it("does not advertise storage when the host has no storage service", async () => {
    const fixture = await createTeamApiFixture("storage-absent", { configure: true });
    const { base } = await fixture.start({});
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).not.toContain("storage-v1");
  });
});
