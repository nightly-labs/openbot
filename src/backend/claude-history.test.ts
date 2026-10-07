// @vitest-environment node

import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeHistoryReader } from "./claude-history";
import { isRecord } from "./protocol";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const PROJECT_DIR = "/openbot-history-fixture";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

interface TranscriptFixture {
  uuid: string;
  type: string;
  session_id: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  subtype?: string;
  compactMetadata?: { preservedMessages: { uuids: string[]; anchorUuid: string } };
  message: {
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          tool_use_id?: string;
          content?: string;
        }>;
  };
}

function record(input: TranscriptFixture, newline = true): string {
  return `${JSON.stringify(input)}${newline ? "\n" : ""}`;
}

async function fixture(
  lines: string,
): Promise<{ root: string; path: string; reader: ReturnType<typeof claudeHistoryReader> }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-claude-history-test-"));
  roots.push(root);
  const project = join(root, "projects", "-openbot-history-fixture");
  await mkdir(project, { recursive: true });
  const path = join(project, `${SESSION_ID}.jsonl`);
  await writeFile(path, lines);
  return {
    root,
    path,
    reader: claudeHistoryReader({
      configDirectory: root,
      indexDirectory: join(root, "state"),
      projectDirectoryName: "-openbot-history-fixture",
    }),
  };
}

function user(uuid: string, parentUuid: string | null, text: string): string {
  return record({ uuid, type: "user", session_id: SESSION_ID, parentUuid, message: { role: "user", content: text } });
}

function assistant(uuid: string, parentUuid: string, text: string): string {
  return record({
    uuid,
    type: "assistant",
    session_id: SESSION_ID,
    parentUuid,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("claude disk history", () => {
  it("keeps the active parent branch and matches the installed SDK fixture", async () => {
    const fixtureData = await fixture(
      user("u1", null, "first") +
        assistant("a1", "u1", "old") +
        record({
          uuid: "branch",
          type: "assistant",
          session_id: SESSION_ID,
          parentUuid: "u1",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "side" }] },
        }) +
        assistant("a2", "a1", "new"),
    );
    vi.stubEnv("CLAUDE_CONFIG_DIR", fixtureData.root);
    const sdkMessages = await getSessionMessages(SESSION_ID, { dir: PROJECT_DIR, includeSystemMessages: true });
    expect(sdkMessages.map((message) => message.uuid)).toEqual(["u1", "a1", "a2"]);
    const fragments: Array<{ items: Array<{ id?: string; type: string; text?: string }>; complete: boolean }> = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, cwd: PROJECT_DIR, items: "full" }, (fragment) =>
        Effect.sync(() => {
          fragments.push(fragment);
          return true;
        }),
      ),
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.items.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
    expect(fragments[0]?.items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual([
      "old",
      "new",
    ]);
  });

  it("pages one turn without retaining all items and preserves tool calls", async () => {
    let lines = user("u1", null, "run");
    let parent = "u1";
    for (let index = 0; index < 60; index += 1) {
      const uuid = `a${index}`;
      lines += assistant(uuid, parent, `part-${index}`);
      parent = uuid;
    }
    lines += record({
      uuid: "tool",
      type: "assistant",
      session_id: SESSION_ID,
      parentUuid: parent,
      message: { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "read" }] },
    });
    lines += record({
      uuid: "result",
      type: "user",
      session_id: SESSION_ID,
      parentUuid: "tool",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "done" }] },
    });
    const fixtureData = await fixture(lines);
    const fragments: Array<{ items: unknown[]; itemOffset?: number; complete: boolean }> = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "full" }, (fragment) =>
        Effect.sync(() => {
          fragments.push(fragment);
          return true;
        }),
      ),
    );
    expect(fragments.map((fragment) => [fragment.items.length, fragment.itemOffset, fragment.complete])).toEqual([
      [50, 0, false],
      [13, 50, true],
    ]);
    expect(fragments.flatMap((fragment) => fragment.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "call-1", type: "toolCall", status: "in_progress" }),
        expect.objectContaining({ id: "call-1", type: "toolCall", status: "completed", text: "done" }),
      ]),
    );
  });

  it("keeps preserved messages across a Claude compaction boundary", async () => {
    const summary = "This session is being continued from a previous conversation that ran out of context.";
    const fixtureData = await fixture(
      record({
        uuid: "anchor",
        type: "system",
        session_id: SESSION_ID,
        message: { role: "system", content: "anchor" },
      }) +
        user("u1", "anchor", "before") +
        assistant("a1", "u1", "old answer") +
        record({
          uuid: "boundary",
          type: "system",
          subtype: "compact_boundary",
          session_id: SESSION_ID,
          parentUuid: "a1",
          compactMetadata: { preservedMessages: { uuids: ["u1", "a1"], anchorUuid: "anchor" } },
          message: { role: "system", content: "compacted" },
        }) +
        user("u2", "boundary", summary) +
        assistant("a2", "u2", "after"),
    );
    vi.stubEnv("CLAUDE_CONFIG_DIR", fixtureData.root);
    const sdkMessages = await getSessionMessages(SESSION_ID, { dir: PROJECT_DIR, includeSystemMessages: true });
    const sdkNormalized = sdkMessages
      .filter((message) => message.type === "user" || message.type === "assistant")
      .filter((message) => {
        if (message.type !== "user" || !isRecord(message.message)) return true;
        const content = message.message.content;
        return content !== summary;
      })
      .map((message) => message.uuid);
    expect(sdkNormalized).toEqual(["u1", "a1", "a2"]);
    const metadata: Array<{ turnId: string }> = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "none" }, (fragment) =>
        Effect.sync(() => {
          metadata.push(fragment);
          return true;
        }),
      ),
    );
    expect(metadata.map((fragment) => fragment.turnId)).toEqual(["u1"]);
    const full: string[] = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "full" }, (fragment) =>
        Effect.sync(() => {
          full.push(...fragment.items.flatMap((item) => (item.id ? [item.id] : [])));
          return true;
        }),
      ),
    );
    expect(full).toEqual(sdkNormalized);
  });

  it("retries a partial record, then rebuilds after replacement", async () => {
    const first = user("u1", null, "partial");
    const fixtureData = await fixture(first.slice(0, -1));
    const firstRead: unknown[] = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "none" }, (fragment) =>
        Effect.sync(() => {
          firstRead.push(fragment);
          return true;
        }),
      ),
    );
    expect(firstRead).toEqual([]);
    await appendFile(fixtureData.path, "\n");
    const secondRead: Array<{ turnId: string }> = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "none" }, (fragment) =>
        Effect.sync(() => {
          secondRead.push(fragment);
          return true;
        }),
      ),
    );
    expect(secondRead.map((fragment) => fragment.turnId)).toEqual(["u1"]);
    await writeFile(fixtureData.path, user("u2", null, "replacement"));
    const replaced: Array<{ turnId: string }> = [];
    await Effect.runPromise(
      fixtureData.reader({ threadId: SESSION_ID, items: "none" }, (fragment) =>
        Effect.sync(() => {
          replaced.push(fragment);
          return true;
        }),
      ),
    );
    expect(replaced.map((fragment) => fragment.turnId)).toEqual(["u2"]);
    expect(await readFile(fixtureData.path, "utf8")).toContain("replacement");
  });

  it("stops the transcript scan when the consumer is cancelled", async () => {
    const fixtureData = await fixture(user("u1", null, "cancel") + assistant("a1", "u1", "answer"));
    const controller = new AbortController();
    await expect(
      Effect.runPromise(
        fixtureData.reader({ threadId: SESSION_ID, items: "full" }, () =>
          Effect.sync(() => {
            controller.abort();
            return true;
          }),
        ),
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});
