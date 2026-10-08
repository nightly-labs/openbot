// @vitest-environment node

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, ConversationMessage, SaveRemoteWorkspaceInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { type RemoteWorkspaceCacheCipher, RemoteWorkspaceCacheStore } from "./remote-workspace-cache";

// Failure modes, one test each:
// - another account reads a copy it does not own -> "keeps each account's copy apart..."
// - a request queued before an account switch writes the next account's copy -> "does not let a request..."
// - a sign-out leaves a copy on disk -> "deletes every copy at sign-out"
// - a removed server keeps its copy -> "deletes the copy of a server that leaves the list"
// - the setting is off and a copy is still written or read -> "keeps nothing while the setting is off"
// - turning the setting off leaves the copy -> "deletes every copy when the setting is turned off"
// - newer data does not replace the copy -> "replaces the copy with what the server sent last"
// - attachments, prompts or plain text reach the disk -> "keeps text only, encrypted"
// - a damaged or moved file is shown -> "reads a damaged or moved file as no copy"
// - no secret storage, and the copy is kept unencrypted -> "keeps nothing without secret storage"

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A reversible cipher that does not keep the plain text, so a test can see what reaches the disk. */
function testCipher(available = true): RemoteWorkspaceCacheCipher {
  return {
    canPersist: () => available,
    encrypt: (value) => Buffer.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a)),
    decrypt: (value) => Buffer.from(value.map((byte) => byte ^ 0x5a)).toString("utf8"),
  };
}

async function createStore(options: { enabled?: boolean; cipher?: RemoteWorkspaceCacheCipher; root?: string } = {}) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "openbot-saved-copy-")));
  if (!options.root) roots.push(root);
  const store = new RemoteWorkspaceCacheStore({
    directory: join(root, "remote-workspace-cache"),
    preferencePath: join(root, "openbot-remote-workspace-cache-v1.json"),
    cipher: options.cipher ?? testCipher(),
    now: () => new Date("2026-10-08T10:00:00.000Z"),
  });
  await runCauseEffect(store.load());
  if (options.enabled !== false) await runCauseEffect(store.setEnabled({ enabled: true }));
  return { store, root, directory: join(root, "remote-workspace-cache") };
}

function agent(id: string, overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id,
    name: id,
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: `thread-${id}`,
    workspacePath: "/host/workspace",
    preview: `Preview of ${id}`,
    updatedAt: "2026-10-08T09:00:00.000Z",
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
    ...overrides,
  };
}

function workspace(serverId: string, agents: AgentSummary[]): SaveRemoteWorkspaceInput {
  return {
    serverId,
    memberId: "member-1",
    agents,
    reads: Object.fromEntries(
      agents.map((item) => [item.id, { unreadCount: 2, firstUnreadMessageId: "m-1", throughMessageId: null }]),
    ),
    layout: null,
  };
}

function message(id: string, text: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-10-08T09:00:00.000Z", status: "completed", ...overrides };
}

async function filesUnder(path: string): Promise<string[]> {
  return readdir(path, { recursive: true }).catch(() => []);
}

describe("remote workspace cache", () => {
  it("keeps each account's copy apart and deletes the other account's copy on a switch", async () => {
    const { store, directory } = await createStore();
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    expect(await Effect.runPromise(store.read("server-1"))).toMatchObject({ agents: [{ id: "chief" }] });

    await Effect.runPromise(store.setPrincipal("account-b"));
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
    expect(await filesUnder(directory)).toEqual([]);

    // Account A comes back after B: its copy went with the switch and is not restored.
    await Effect.runPromise(store.setPrincipal("account-a"));
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
  });

  it("does not let a request queued for one account reach the copy of the next account", async () => {
    const { store, directory } = await createStore();
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));

    // The first save holds the permit, so account A's next requests wait while the account changes to B.
    const queued = [
      Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")]))),
      Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")]))),
      Effect.runPromise(
        store.saveConversation({ serverId: "server-1", agentId: "chief", messages: [message("m-1", "A's chat")] }),
      ),
      Effect.runPromise(store.read("server-1")),
    ] as const;
    const switched = Effect.runPromise(store.setPrincipal("account-b"));
    const [, , , readForA] = await Promise.all(queued);
    await switched;

    expect(readForA).toBeNull();
    expect(await filesUnder(directory)).toEqual([]);
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
  });

  it("deletes every copy at sign-out and keeps nothing while nobody is signed in", async () => {
    const { store, directory } = await createStore();
    await Effect.runPromise(store.setServers(["server-1", "server-2"]));
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    await Effect.runPromise(store.saveWorkspace(workspace("server-2", [agent("scout")])));

    await Effect.runPromise(store.setPrincipal(null));
    expect(await filesUnder(directory)).toEqual([]);
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    expect(await filesUnder(directory)).toEqual([]);
  });

  it("deletes the copy of a server that leaves the list, and refuses a server that is not joined", async () => {
    const { store } = await createStore();
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1", "server-2"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    await Effect.runPromise(store.saveWorkspace(workspace("server-2", [agent("scout")])));

    await Effect.runPromise(store.setServers(["server-2"]));
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
    expect(await Effect.runPromise(store.read("server-2"))).toMatchObject({ agents: [{ id: "scout" }] });

    // A server joined again starts without the old copy, and an unknown server gets none.
    await Effect.runPromise(store.setServers(["server-1", "server-2"]));
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
    await Effect.runPromise(store.saveWorkspace(workspace("server-9", [agent("chief")])));
    expect(await Effect.runPromise(store.read("server-9"))).toBeNull();
  });

  it("keeps nothing while the setting is off, which is the default", async () => {
    const { store, directory } = await createStore({ enabled: false });
    expect(store.preference()).toEqual({ enabled: false });
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    expect(await filesUnder(directory)).toEqual([]);
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
  });

  it("deletes every copy when the setting is turned off, and remembers the choice", async () => {
    const { store, root, directory } = await createStore();
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    expect(await filesUnder(directory)).not.toEqual([]);

    await runCauseEffect(store.setEnabled({ enabled: false }));
    expect(await filesUnder(directory)).toEqual([]);

    const restarted = await createStore({ root, enabled: false });
    expect(restarted.store.preference()).toEqual({ enabled: false });
  });

  it("replaces the copy with what the server sent last", async () => {
    const { store } = await createStore();
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief"), agent("scout")])));
    await Effect.runPromise(
      store.saveConversation({ serverId: "server-1", agentId: "scout", messages: [message("m-1", "Old reply")] }),
    );
    await Effect.runPromise(
      store.saveConversation({ serverId: "server-1", agentId: "chief", messages: [message("m-2", "Chief reply")] }),
    );

    // Scout was deleted on the host: its row and its chat leave the copy.
    await Effect.runPromise(
      store.saveWorkspace({ ...workspace("server-1", [agent("chief", { preview: "Newer" })]), reads: {} }),
    );
    const copy = await Effect.runPromise(store.read("server-1"));
    expect(copy?.agents.map((item) => [item.id, item.preview])).toEqual([["chief", "Newer"]]);
    expect(copy?.reads).toEqual({});
    expect(copy?.conversations.map((conversation) => conversation.agentId)).toEqual(["chief"]);

    // A chat of an agent that the roster does not list is not kept.
    await Effect.runPromise(
      store.saveConversation({ serverId: "server-1", agentId: "scout", messages: [message("m-3", "Ghost")] }),
    );
    expect((await Effect.runPromise(store.read("server-1")))?.conversations).toHaveLength(1);
  });

  it("keeps text only, within the limits, encrypted", async () => {
    const { store, directory } = await createStore();
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(
      store.saveWorkspace(workspace("server-1", [agent("chief", { avatarUrl: "openbot-remote-avatar://chief" })])),
    );
    const messages = Array.from({ length: 40 }, (_, index) => message(`m-${index}`, `Reply ${index}`));
    messages[39] = message("m-39", "Secret plan", {
      attachments: [
        {
          id: "file-1",
          name: "plan.pdf",
          size: 10,
          kind: "file",
          mimeType: "application/pdf",
          previewKind: "pdf",
          previewUrl: null,
        },
      ],
    });
    messages.push(message("m-40", "Still writing", { status: "streaming" }));
    await Effect.runPromise(store.saveConversation({ serverId: "server-1", agentId: "chief", messages }));

    const copy = await Effect.runPromise(store.read("server-1"));
    const saved = copy?.conversations[0]?.messages ?? [];
    expect(saved).toHaveLength(30);
    expect(saved.at(-1)).toEqual(message("m-39", "Secret plan"));
    expect(copy?.agents[0]?.avatarUrl).toBeNull();
    const files = (await filesUnder(directory)).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(1);
    const onDisk = await readFile(join(directory, files[0] ?? ""), "utf8");
    expect(onDisk).not.toContain("Secret plan");
    expect(onDisk).not.toContain("chief");
  });

  it("reads a damaged or moved file as no copy and deletes it", async () => {
    const { store, directory } = await createStore();
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1", "server-2"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    const [principalDirectory] = await readdir(directory);
    const [file] = await readdir(join(directory, principalDirectory ?? ""));
    const path = join(directory, principalDirectory ?? "", file ?? "");

    // Server 1's file under server 2's name: the names inside it do not match.
    await Effect.runPromise(store.saveWorkspace(workspace("server-2", [agent("scout")])));
    const otherFile = (await readdir(join(directory, principalDirectory ?? ""))).find((name) => name !== file);
    await writeFile(join(directory, principalDirectory ?? "", otherFile ?? ""), await readFile(path));
    expect(await Effect.runPromise(store.read("server-2"))).toBeNull();

    await writeFile(path, "{not json");
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
    expect(await readdir(join(directory, principalDirectory ?? ""))).toEqual([]);
  });

  it("keeps nothing without secret storage", async () => {
    const { store, directory } = await createStore({ cipher: testCipher(false) });
    await Effect.runPromise(store.setPrincipal("account-a"));
    await Effect.runPromise(store.setServers(["server-1"]));
    await Effect.runPromise(store.saveWorkspace(workspace("server-1", [agent("chief")])));
    expect(await filesUnder(directory)).toEqual([]);
    expect(await Effect.runPromise(store.read("server-1"))).toBeNull();
  });
});
