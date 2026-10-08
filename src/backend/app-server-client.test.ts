// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./app-server-client";
import { runCauseEffect } from "./effect-boundary";
import { type AppServerRequest, decodeRecordResponse, isRecord } from "./protocol";
import type { ProviderHistoryFragment } from "./provider-history";

const temporaryRoots: string[] = [];
const clients: CodexAppServerClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => runCauseEffect(client.stop())));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("CodexAppServerClient", () => {
  it("matches responses and receives notifications over stdio", async () => {
    const executable = await createFakeCodex();
    const client = createClient(executable, 5_000);
    const notifications: string[] = [];
    client.on("notification", (notification) => notifications.push(notification.method));
    client.start();

    const result = await runCauseEffect(client.request("test/echo", { text: "hello" }, decodeEchoResponse));

    expect(result).toEqual({ echoed: "hello" });
    await vi.waitFor(() => expect(notifications).toContain("test/notification"));
  });

  it("cancels only the interrupted turn, including late tools, and accepts tools after restart", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    const requests: AppServerRequest[] = [];
    client.on("request", (request) => requests.push(request));
    client.start();
    const tool = (threadId: string, turnId: string) =>
      runCauseEffect(client.request("test/tool", { threadId, turnId }, decodeRecordResponse));
    await tool("thread-a", "turn-a");
    await tool("thread-b", "turn-a");
    const first = requests[0]?.signal;
    const other = requests[1]?.signal;
    expect(first?.aborted).toBe(false);
    await runCauseEffect(
      client.request("turn/interrupt", { threadId: "thread-a", turnId: "turn-a" }, decodeRecordResponse),
    );
    expect(first?.aborted).toBe(true);
    expect(other?.aborted).toBe(false);
    await tool("thread-a", "turn-a");
    expect(requests[2]?.signal?.aborted).toBe(true);
    await tool("thread-a", "turn-next");
    expect(requests[3]?.signal?.aborted).toBe(false);
    await runCauseEffect(
      client.request(
        "test/complete",
        { threadId: "thread-a", turn: { id: "turn-next", status: "interrupted" } },
        decodeRecordResponse,
      ),
    );
    expect(requests[3]?.signal?.aborted).toBe(true);
    await runCauseEffect(client.stop());
    expect(other?.aborted).toBe(true);
    client.start();
    await tool("thread-a", "turn-a");
    expect(requests[4]?.signal?.aborted).toBe(false);
    await expect(runCauseEffect(client.request("test/partial-exit", {}, decodeRecordResponse))).rejects.toThrow(
      "exited",
    );
    expect(requests[4]?.signal?.aborted).toBe(true);
    client.start();
    await tool("thread-a", "turn-a");
    expect(requests[5]?.signal?.aborted).toBe(false);
  });

  it("rejects an invalid response without leaving its caller pending", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();
    await expect(runCauseEffect(client.request("test/echo", { text: 42 }, decodeEchoResponse))).rejects.toThrow(
      "Invalid echo response.",
    );
    await expect(runCauseEffect(client.request("test/echo", { text: "valid" }, decodeEchoResponse))).resolves.toEqual({
      echoed: "valid",
    });
  });

  it("rejects timed out requests", async () => {
    const executable = await createFakeCodex();
    const client = createClient(executable, 30);
    client.start();

    await expect(runCauseEffect(client.request("test/timeout", {}, decodeRecordResponse))).rejects.toThrow("timed out");
  });

  it("surfaces RPC errors with their code", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();

    await expect(runCauseEffect(client.request("test/error", {}, decodeRecordResponse))).rejects.toMatchObject({
      name: "AppServerError",
      code: 412,
      message: "Fake RPC failure",
    });
  });

  it("releases one thread with an unsubscribe and keeps the app server for the others", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    const observed: unknown[] = [];
    client.on("notification", (notification) => {
      if (notification.method === "test/unsubscribed") observed.push(notification.params);
    });
    client.start();

    await runCauseEffect(client.releaseThread("thread-7"));

    // The app server keeps the thread and its history; it unloads the thread, with the MCP servers
    // it started, once nothing is subscribed to it.
    await vi.waitFor(() => expect(observed).toEqual([{ threadId: "thread-7" }]));
    await expect(
      runCauseEffect(client.request("test/echo", { text: "still serving" }, decodeEchoResponse)),
    ).resolves.toEqual({
      echoed: "still serving",
    });
  });

  it("resets fragmented JSON state when restarted after a process crash", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();
    await expect(runCauseEffect(client.request("test/partial-exit", {}, decodeRecordResponse))).rejects.toThrow(
      "exited",
    );

    client.start();
    await expect(
      runCauseEffect(client.request("test/echo", { text: "after restart" }, decodeEchoResponse)),
    ).resolves.toEqual({
      echoed: "after restart",
    });
  });

  it("reads newest turns with bounded item pages without resuming the thread", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    const observed: Array<{ method: string; params: unknown }> = [];
    const fragments: ProviderHistoryFragment[] = [];
    client.on("notification", (notification) => {
      if (notification.method === "test/observed" && isRecord(notification.params)) {
        observed.push({ method: String(notification.params.method), params: notification.params.params });
      }
    });
    client.start();

    await runCauseEffect(
      client.readHistory({ threadId: "history-thread", cwd: "/tmp/workspace", items: "full" }, (fragment) =>
        Effect.sync(() => {
          fragments.push(fragment);
          return true;
        }),
      ),
    );
    await vi.waitFor(() => expect(observed).toHaveLength(5));

    expect(fragments).toEqual([
      {
        turnId: "turn-2",
        status: "completed",
        startedAt: 2,
        itemOffset: 0,
        items: [{ type: "userMessage", id: "item-2a", text: "first" }],
        complete: false,
      },
      {
        turnId: "turn-2",
        status: "completed",
        startedAt: 2,
        itemOffset: 1,
        items: [{ type: "agentMessage", id: "item-2b", text: "second" }],
        complete: true,
      },
      { turnId: "turn-1", status: "failed", startedAt: 1, itemOffset: 0, items: [], complete: true },
    ]);
    expect(observed).toEqual([
      {
        method: "thread/turns/list",
        params: {
          threadId: "history-thread",
          limit: 50,
          sortDirection: "desc",
          itemsView: "notLoaded",
        },
      },
      {
        method: "thread/items/list",
        params: {
          threadId: "history-thread",
          turnId: "turn-2",
          limit: 50,
          sortDirection: "asc",
        },
      },
      {
        method: "thread/items/list",
        params: {
          threadId: "history-thread",
          turnId: "turn-2",
          limit: 50,
          sortDirection: "asc",
          cursor: "item-next",
        },
      },
      {
        method: "thread/turns/list",
        params: {
          threadId: "history-thread",
          limit: 50,
          sortDirection: "desc",
          itemsView: "notLoaded",
          cursor: "turn-next",
        },
      },
      {
        method: "thread/items/list",
        params: {
          threadId: "history-thread",
          turnId: "turn-1",
          limit: 50,
          sortDirection: "asc",
        },
      },
    ]);
  });

  it("fails when Codex repeats a history cursor", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();

    await expect(
      runCauseEffect(client.readHistory({ threadId: "repeated-thread", items: "none" }, () => Effect.succeed(true))),
    ).rejects.toThrow("repeated turn history cursor");
  });

  it("stops paging when the consumer declines a fragment", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    const observed: Array<{ method: string; params: unknown }> = [];
    client.on("notification", (notification) => {
      if (notification.method === "test/observed" && isRecord(notification.params)) {
        observed.push({ method: String(notification.params.method), params: notification.params.params });
      }
    });
    client.start();
    let count = 0;

    await runCauseEffect(
      client.readHistory({ threadId: "history-thread", items: "full" }, () =>
        Effect.sync(() => {
          count += 1;
          return false;
        }),
      ),
    );

    await vi.waitFor(() => expect(observed).toHaveLength(2));
    expect(count).toBe(1);
    expect(observed.map(({ method }) => method)).toEqual(["thread/turns/list", "thread/items/list"]);
  });

  it("propagates a failed page without falling back to a full history read", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();

    await expect(
      runCauseEffect(client.readHistory({ threadId: "failed-page-thread", items: "full" }, () => Effect.succeed(true))),
    ).rejects.toThrow("Codex history page failed");
  });

  it("cancels a pending history request and clears its request slot", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    const pending = new Promise<void>((resolve) => {
      client.on("notification", (notification) => {
        if (notification.method === "test/history-pending") resolve();
      });
    });
    client.start();
    const history = Effect.runFork(
      client.readHistory({ threadId: "cancel-thread", items: "full" }, () => Effect.succeed(true)),
    );
    await pending;

    await Effect.runPromise(Fiber.interrupt(history));
    await expect(
      runCauseEffect(client.request("test/echo", { text: "after cancel" }, decodeEchoResponse)),
    ).resolves.toEqual({ echoed: "after cancel" });
  });
});

function decodeEchoResponse(value: unknown): { echoed: string } {
  if (!isRecord(value)) throw new Error("Invalid echo response.");
  const echoed = value.echoed;
  if (!isString(echoed)) throw new Error("Invalid echo response.");
  return { echoed };
}

function createClient(executable: string, timeout: number): CodexAppServerClient {
  const client = new CodexAppServerClient(executable, timeout);
  clients.push(client);
  return client;
}

async function createFakeCodex(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-fake-codex-"));
  temporaryRoots.push(root);
  const executable = join(root, "codex");
  await writeFile(
    executable,
    `#!/usr/bin/env node
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method === "test/echo") {
        const response = JSON.stringify({ id: message.id, result: { echoed: message.params.text } }) + "\\n";
        const middle = Math.floor(response.length / 2);
        process.stdout.write(response.slice(0, middle));
        process.stdout.write(response.slice(middle));
        process.stdout.write(JSON.stringify({ method: "test/notification", params: {} }) + "\\n");
      } else if (message.method === "test/tool") {
        process.stdout.write(JSON.stringify({ id: "tool-" + message.id, method: "item/tool/call", params: message.params }) + "\\n");
        process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
      } else if (message.method === "turn/interrupt" || message.method === "test/complete") {
        if (message.method === "test/complete") process.stdout.write(JSON.stringify({ method: "turn/completed", params: message.params }) + "\\n");
        process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
      } else if (message.method === "test/error") {
        process.stdout.write(JSON.stringify({ id: message.id, error: { code: 412, message: "Fake RPC failure" } }) + "\\n");
      } else if (message.method === "thread/unsubscribe") {
        process.stdout.write(JSON.stringify({ id: message.id, result: { status: "Unsubscribed" } }) + "\\n");
        process.stdout.write(JSON.stringify({ method: "test/unsubscribed", params: message.params }) + "\\n");
      } else if (message.method === "thread/resume") {
        if (message.params.threadId === "cancel-thread") {
          process.stdout.write(JSON.stringify({ method: "test/history-pending", params: {} }) + "\\n");
        } else {
          process.stdout.write(
            JSON.stringify({ id: message.id, result: { thread: { id: message.params.threadId } } }) + "\\n",
          );
          process.stdout.write(
            JSON.stringify({ method: "test/observed", params: { method: message.method, params: message.params } }) +
              "\\n",
          );
        }
      } else if (message.method === "thread/turns/list" && message.params.threadId === "cancel-thread") {
        process.stdout.write(JSON.stringify({ method: "test/history-pending", params: {} }) + "\\n");
      } else if (message.method === "thread/turns/list") {
        const page =
          message.params.threadId === "repeated-thread"
            ? { data: [], nextCursor: "same-turn-cursor" }
            : message.params.cursor === "turn-next"
              ? { data: [{ id: "turn-1", status: "failed", startedAt: 1 }], nextCursor: null }
              : { data: [{ id: "turn-2", status: "completed", startedAt: 2 }], nextCursor: "turn-next" };
        process.stdout.write(JSON.stringify({ id: message.id, result: page }) + "\\n");
        process.stdout.write(
          JSON.stringify({ method: "test/observed", params: { method: message.method, params: message.params } }) +
            "\\n",
        );
      } else if (message.method === "thread/items/list") {
        if (message.params.threadId === "failed-page-thread") {
          process.stdout.write(
            JSON.stringify({ id: message.id, error: { code: 499, message: "Codex history page failed" } }) + "\\n",
          );
        } else {
          let page;
          if (message.params.turnId === "turn-1") {
            page = { data: [], nextCursor: null };
          } else if (message.params.cursor === "item-next") {
            page = { data: [{ turnId: "turn-2", item: { type: "agentMessage", id: "item-2b", text: "second" } }], nextCursor: null };
          } else {
            page = { data: [{ turnId: "turn-2", item: { type: "userMessage", id: "item-2a", text: "first" } }], nextCursor: "item-next" };
          }
          process.stdout.write(JSON.stringify({ id: message.id, result: page }) + "\\n");
          process.stdout.write(
            JSON.stringify({ method: "test/observed", params: { method: message.method, params: message.params } }) +
              "\\n",
          );
        }
      } else if (message.method === "test/partial-exit") {
        process.stdout.write('{"id":');
        process.exit(9);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  return executable;
}
