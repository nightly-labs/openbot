import type { ConversationMessage } from "@openbot/contracts/ipc";
import type { WebRuntimeFactory } from "../features/web-client/web-client-context";
import type { WebWorkspaceRuntime } from "../features/web-client/web-runtime";
import { createMockOpenBot } from "./mock-openbot";
import { mockWebRuntimeFor } from "./mock-web-runtime";

/**
 * The mock host for `bun run perf:web` (`scripts/web-client-perf-e2e.ts`) and
 * `scripts/web-client-conversation-trim-e2e.ts`. The first agent has a long conversation, and the
 * scripts stream a reply into it and count the host requests that the web client makes. The scripts
 * read the driver from `globalThis.openbotWebBench`.
 */
interface WebBench {
  /** Resolves when the host has the long conversation. */
  ready: Promise<string>;
  /** Host requests per runtime method since the last reset. `conversationOlder` counts older-page reads. */
  calls: Record<string, number>;
  /** The names of the agent with the long conversation and of another agent, set when `ready` resolves. */
  agentNames: { open: string; other: string };
  resetCalls: () => void;
  /** Resolves when no host request is running for one macrotask. */
  idle: () => Promise<void>;
  /**
   * One turn: start, `tokens` stream chunks in separate tasks, final page, completion. The turn is
   * in the open conversation, or with `other` in the conversation of another agent.
   */
  stream: (tokens: number, marker: string, other?: boolean) => Promise<void>;
  /**
   * Adds `count` messages, `<prefix> <index>: ...`, to the conversation of another agent on the host
   * only, with no event, as when they arrive while that conversation is not open.
   */
  append: (count: number, prefix: string) => void;
}

const SEEDED_MESSAGES = 160;
const START = Date.parse("2026-10-01T09:00:00.000Z");

function seededText(index: number): string {
  if (index % 2 === 0)
    return `Question ${index}: can you check the release notes and the open issues for item ${index}?`;
  const body = [
    `Here is what I found for item ${index - 1}.`,
    "",
    `- **Status:** the change is ready, with ${index} files touched.`,
    "- **Risk:** low; the tests pass on every platform.",
    "",
  ];
  if (index % 6 === 1) body.push("```ts", `export const item${index} = { id: ${index}, ready: true };`, "```", "");
  body.push("I will keep watching the build and tell you when it finishes.");
  return body.join("\n");
}

function token(index: number): string {
  if (index % 40 === 39) return "\n\n";
  return `word${index % 97} `;
}

const nextTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

export const createBenchWebRuntime: WebRuntimeFactory = (_accountId, events) => {
  const mock = createMockOpenBot();
  const base = mockWebRuntimeFor(mock, events);
  const calls: Record<string, number> = {};
  let running = 0;
  let resolveReady: (agentId: string) => void = () => {};
  const ready = new Promise<string>((resolve) => {
    resolveReady = resolve;
  });
  let agentId = "";
  let otherAgentId = "";
  const agentNames = { open: "", other: "" };

  async function seed(): Promise<void> {
    const [agent, other] = await mock.api.agent.listAgents();
    if (!agent || !other) throw new Error("The mock host needs two agents.");
    agentId = agent.id;
    otherAgentId = other.id;
    agentNames.open = agent.name;
    agentNames.other = other.name;
    mock.updateConversationSnapshot(agentId, (snapshot) => {
      const messages: ConversationMessage[] = [];
      for (let index = 0; index < SEEDED_MESSAGES; index++) {
        const user = index % 2 === 0;
        messages.push({
          id: `bench-${index}`,
          turnId: `bench-turn-${Math.floor(index / 2)}`,
          author: user ? "user" : "assistant",
          source: user ? "user" : "assistant",
          text: seededText(index),
          createdAt: new Date(START + index * 60_000).toISOString(),
          status: "completed",
        });
      }
      snapshot.messages = messages;
      snapshot.activeTurnId = null;
    });
    resolveReady(agentId);
  }

  // Count each host request on the paths the script measures, and track the ones that run, so the
  // script can wait for quiet.
  function counted<Args extends unknown[], Result>(
    name: string,
    call: (...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result> {
    return async (...args) => {
      calls[name] = (calls[name] ?? 0) + 1;
      running += 1;
      try {
        return await call(...args);
      } finally {
        running -= 1;
      }
    };
  }
  const runtime: WebWorkspaceRuntime = {
    ...base,
    // The fixture seeds the conversation before the web client reads it.
    connect: counted("connect", async (...args) => {
      await seed();
      return base.connect(...args);
    }),
    listHosts: counted("listHosts", base.listHosts),
    listAgents: counted("listAgents", base.listAgents),
    conversation: counted("conversation", (id, before) => {
      if (before !== undefined) calls.conversationOlder = (calls.conversationOlder ?? 0) + 1;
      return base.conversation(id, before);
    }),
    conversationReads: counted("conversationReads", base.conversationReads),
    markRead: counted("markRead", base.markRead),
    queue: counted("queue", base.queue),
    status: counted("status", base.status),
    models: counted("models", base.models),
    ...(base.getSidebarLayout && { getSidebarLayout: counted("getSidebarLayout", base.getSidebarLayout) }),
    ...(base.accountUsage && { accountUsage: counted("accountUsage", base.accountUsage) }),
  };

  async function idle(): Promise<void> {
    for (let quiet = 0; quiet < 3; ) {
      await nextTask();
      quiet = running === 0 ? quiet + 1 : 0;
    }
  }

  async function stream(tokens: number, marker: string, other = false): Promise<void> {
    const target = other ? otherAgentId : agentId;
    const threadId = mock.readConversationSnapshot(target).threadId ?? `thread-${target}`;
    const turnId = `bench-stream-${Date.now()}`;
    const messageId = `${turnId}-reply`;
    const createdAt = new Date().toISOString();
    mock.emitAgentEvent({ type: "turn-started", agentId: target, threadId, turnId });
    await idle();
    let text = "";
    for (let index = 0; index < tokens; index++) {
      const delta = index === tokens - 1 ? marker : token(index);
      text += delta;
      mock.emitConversationDelta({ agentId: target, threadId, turnId, messageId, delta, createdAt });
      await nextTask();
    }
    mock.updateConversationSnapshot(target, (snapshot) => {
      snapshot.activeTurnId = null;
      snapshot.messages = [
        ...snapshot.messages,
        { id: messageId, turnId, author: "assistant", source: "assistant", text, createdAt, status: "completed" },
      ];
    });
    mock.emitAgentEvent({ type: "turn-completed", agentId: target, threadId, turnId, status: "completed" });
    await idle();
  }

  function append(count: number, prefix: string): void {
    const createdAt = new Date().toISOString();
    mock.updateConversationSnapshot(otherAgentId, (snapshot) => {
      const added: ConversationMessage[] = [];
      for (let index = 0; index < count; index++) {
        added.push({
          id: `bench-${prefix}-${index}`,
          turnId: `bench-${prefix}-turn-${index}`,
          author: "assistant",
          source: "assistant",
          text: `${prefix} ${index}: the build is still running.`,
          createdAt,
          status: "completed",
        });
      }
      snapshot.messages = [...snapshot.messages, ...added];
    });
  }

  const bench: WebBench = {
    ready,
    calls,
    agentNames,
    resetCalls: () => {
      for (const name of Object.keys(calls)) delete calls[name];
    },
    idle,
    stream,
    append,
  };
  Object.assign(globalThis, { openbotWebBench: bench });
  return runtime;
};
