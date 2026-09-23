import { describe, expect, it } from "vitest";
import { isStorageRoute, STORAGE_ROUTES, storageRequest, storageResponse } from "./storage-v1";

const file = {
  id: "thread-1:message-1:attachment-1",
  name: "report.pdf",
  size: 2_048,
  kind: "file",
  mimeType: "application/pdf",
  previewKind: "pdf",
  previewUrl: "openbot-attachment://attachment-1",
  source: "attachment",
  agentId: "agent-1",
  conversation: { id: "thread-1", title: "Quarterly report" },
  messageId: "message-1",
  createdAt: "2026-09-20T10:00:00.000Z",
  status: "available",
  deletable: true,
};

const usage = {
  scope: "host",
  agentId: null,
  conversationId: null,
  scannedAt: "2026-09-23T10:00:00.000Z",
  freeBytes: 1_000_000,
  breakdown: [{ category: "attachments", bytes: 2_048, removable: false }],
  agents: [{ agentId: "agent-1", bytes: 2_048, fileCount: 1, conversationCount: 1 }],
  conversations: [
    { id: "thread-1", title: "Quarterly report", agentId: "agent-1", bytes: 4_096, fileCount: 1, messageCount: 3 },
  ],
  files: [file],
  truncated: false,
};

describe("storage-v1", () => {
  it("matches only its own routes", () => {
    for (const route of Object.values(STORAGE_ROUTES)) expect(isStorageRoute(route)).toBe(true);
    expect(isStorageRoute("/v1/mcp-servers")).toBe(false);
    expect(isStorageRoute("/v1/storage/unknown")).toBe(false);
  });

  it("round-trips every request and drops an absent optional field", () => {
    expect(storageRequest(STORAGE_ROUTES.usage, { scope: "host" })).toEqual({ scope: "host" });
    expect(storageRequest(STORAGE_ROUTES.usage, { scope: "agent", agentId: "agent-1", force: true })).toEqual({
      scope: "agent",
      agentId: "agent-1",
      force: true,
    });
    expect(storageRequest(STORAGE_ROUTES.deleteFile, { fileId: file.id })).toEqual({ fileId: file.id });
    expect(storageRequest(STORAGE_ROUTES.clear, { category: "logs" })).toEqual({ category: "logs" });
  });

  // Only caches and logs can be cleared: every other category holds chats, sent files or agent work.
  it("rejects a malformed request", () => {
    expect(() => storageRequest(STORAGE_ROUTES.usage, { scope: "disk" })).toThrow();
    expect(() => storageRequest(STORAGE_ROUTES.deleteFile, { fileId: "" })).toThrow();
    expect(() => storageRequest(STORAGE_ROUTES.clear, { category: "workspaces" })).toThrow();
    expect(() => storageRequest("/v1/storage/unknown", {})).toThrow();
  });

  it("round-trips a usage answer and drops a field the contract does not name", () => {
    expect(storageResponse(STORAGE_ROUTES.usage, 200, usage)).toEqual(usage);
    const withPath = { ...usage, files: [{ ...file, path: "/Users/one/OpenBot/Shared/Transfers/report.pdf" }] };
    expect(storageResponse(STORAGE_ROUTES.usage, 200, withPath)).toEqual(usage);
    expect(storageResponse(STORAGE_ROUTES.deleteFile, 200, {})).toEqual({});
    expect(storageResponse(STORAGE_ROUTES.clear, 403, { error: "Only an admin can do this." })).toEqual({
      error: "Only an admin can do this.",
    });
  });

  // Workspace files and downloads travel only as category totals, never as rows.
  it("rejects a row from a source or status the wire does not carry", () => {
    const withFile = (patch: Partial<Record<keyof typeof file, string>>) => ({
      ...usage,
      files: [{ ...file, ...patch }],
    });
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, withFile({ source: "download" }))).toThrow();
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, withFile({ source: "workspace" }))).toThrow();
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, withFile({ status: "remote" }))).toThrow();
  });

  it("rejects a value past each limit", () => {
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, files: Array(2_001).fill(file) })).toThrow();
    const conversation = usage.conversations[0];
    expect(() =>
      storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, conversations: Array(201).fill(conversation) }),
    ).toThrow();
    expect(() =>
      storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, agents: Array(501).fill(usage.agents[0]) }),
    ).toThrow();
    expect(() =>
      storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, breakdown: Array(9).fill(usage.breakdown[0]) }),
    ).toThrow();
    const longTitle = { ...usage, conversations: [{ ...conversation, title: "x".repeat(256) }] };
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, longTitle)).toThrow();
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, freeBytes: -1 })).toThrow();
    expect(() => storageResponse(STORAGE_ROUTES.usage, 200, { ...usage, freeBytes: 2 ** 53 })).toThrow();
  });
});
