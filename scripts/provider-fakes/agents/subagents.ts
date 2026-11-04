// The ACP agent of `acp-subagents-e2e.ts`. `FAKE_STYLE` selects how it reports its subagents, as the
// pinned agents do:
// - `opencode` (OpenCode 2.2.5): a `subagent` tool call in the parent session, and the child sessions'
//   work in `opencode/session/child_update` notifications, but only for a client that sets
//   `_meta["opencode/child-session-updates"]` in `initialize` (packages/cli/src/acp/child.ts).
// - `kimi` (Kimi 1.52.0): an `Agent` tool call with no `rawInput`; its content is the arguments as JSON
//   while it runs, and its result at the end.
// - `cline` (Cline 3.0.68): a `spawn_agent: <task>` tool call with `rawInput` `{ systemPrompt, task }`.
// - `hermes`: a `delegate_task: <goal>` tool call with no `rawInput`.
// The prompt `work` starts the foreground subagents; `background` starts one that runs on after the turn,
// for `FAKE_BACKGROUND_MS` (200 by default).
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { type AcpPeer, logEntry, serveFakeAcpAgent } from "../acp-agent";

const STYLE = process.env.FAKE_STYLE ?? "";
const BACKGROUND_MS = Number(process.env.FAKE_BACKGROUND_MS ?? 200);
const MODEL = "fake/model";
const CHILD_METHOD = "opencode/session/child_update";
const NL = "\n";

let childUpdates = false;
let count = 0;

function notify(method: string, params: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}${NL}`);
}

function text(value: string) {
  return { type: "content", content: { type: "text", text: value } } as const;
}

/** A child session's notification. OpenCode sends it only to a client that asked for it. */
/** The fields of `opencode/session/child_update` after the session ids (packages/cli/src/acp/child.ts). */
type ChildFields =
  | { title: string; type: "status"; status: string; error?: { type: string; message: string } }
  | { title: string; type: "update"; update: SessionUpdate };

function child(root: string, childId: string, fields: ChildFields): void {
  if (childUpdates)
    notify(CHILD_METHOD, { rootSessionId: root, childSessionId: childId, parentSessionId: root, depth: 1, ...fields });
}

function openCodeWork(peer: AcpPeer, root: string): void {
  const input = { description: "Review the parser", prompt: "Read parser.ts and list its bugs.", agent: "general" };
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "call_review",
    title: "subagent",
    kind: "other",
    status: "pending",
    rawInput: input,
  });
  const review = "ses_child_review";
  const title = { title: "Review the parser" };
  child(root, review, { ...title, type: "status", status: "created" });
  child(root, review, { ...title, type: "status", status: "running" });
  child(root, review, {
    ...title,
    type: "update",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: `${review}:read_1`,
      title: "Review the parser: read",
      kind: "read",
      status: "in_progress",
      rawInput: { filePath: "/work/parser.ts" },
    },
  });
  child(root, review, {
    ...title,
    type: "update",
    update: { sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "The loop " } },
  });
  child(root, review, {
    ...title,
    type: "update",
    update: {
      sessionUpdate: "agent_thought_chunk",
      messageId: "m1",
      content: { type: "text", text: "skips the last token." },
    },
  });
  // A subagent of the subagent shows its work in the top subagent.
  if (childUpdates) {
    const grandchild = {
      rootSessionId: root,
      childSessionId: "ses_grandchild",
      parentSessionId: review,
      depth: 2,
      title: "Search",
    };
    notify(CHILD_METHOD, { ...grandchild, type: "status", status: "created" });
    notify(CHILD_METHOD, {
      ...grandchild,
      type: "update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "ses_grandchild:grep_1",
        title: "Search: grep",
        kind: "search",
        status: "in_progress",
        rawInput: { pattern: "TODO" },
      },
    });
  }
  child(root, review, {
    ...title,
    type: "update",
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "m2",
      content: { type: "text", text: "Found two bugs." },
    },
  });
  child(root, review, { ...title, type: "status", status: "completed" });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call_review",
    status: "completed",
    rawOutput: { output: "Found two bugs." },
  });

  const failing = { description: "Run the tests", prompt: "Run the unit tests.", agent: "general" };
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "call_tests",
    title: "subagent",
    kind: "other",
    status: "pending",
    rawInput: failing,
  });
  child(root, "ses_child_tests", { title: "Run the tests", type: "status", status: "created" });
  child(root, "ses_child_tests", {
    title: "Run the tests",
    type: "status",
    status: "failed",
    error: { type: "unknown", message: "The model is rate limited." },
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call_tests",
    status: "failed",
    rawOutput: { error: "The model is rate limited." },
  });
}

/** A subagent that the parent leaves running, which ends after the turn. */
function openCodeBackground(peer: AcpPeer, root: string): void {
  const input = {
    description: "Index the repository",
    prompt: "Index every file.",
    agent: "explore",
    background: true,
  };
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "call_index",
    title: "subagent",
    kind: "other",
    status: "pending",
    rawInput: input,
  });
  const id = "ses_child_index";
  child(root, id, { title: "Index the repository", type: "status", status: "created" });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call_index",
    status: "completed",
    rawOutput: { output: "Started.", metadata: { status: "running", sessionID: id } },
  });
  setTimeout(() => {
    child(root, id, {
      title: "Index the repository",
      type: "update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `${id}:ls_1`,
        title: "Index the repository: bash",
        kind: "execute",
        status: "completed",
        rawInput: { command: "ls -R" },
      },
    });
    child(root, id, { title: "Index the repository", type: "status", status: "completed" });
    logEntry({ event: "background-ended" });
  }, BACKGROUND_MS);
}

function kimiWork(peer: AcpPeer, root: string): void {
  const args = {
    description: "Find the tests",
    prompt: "List the test files.",
    subagent_type: "explore",
    run_in_background: false,
  };
  // The arguments stream: the first content is not yet JSON.
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "agent_1",
    title: "Agent",
    kind: "other",
    status: "pending",
    content: [text('{"descr')],
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "agent_1",
    title: "Agent: Find the tests",
    status: "in_progress",
    content: [text(JSON.stringify(args))],
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "agent_1",
    status: "completed",
    content: [text("There are 12 test files.")],
  });
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "agent_2",
    title: "Agent: Fix the build",
    kind: "other",
    status: "in_progress",
    content: [text(JSON.stringify({ ...args, description: "Fix the build", prompt: "Fix it." }))],
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "agent_2",
    status: "failed",
    content: [text("Subagent crashed: context window exceeded.")],
  });
  // A background call has no end signal, so it is not shown.
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "agent_3",
    title: "Agent: Watch the logs",
    kind: "other",
    status: "in_progress",
    content: [text(JSON.stringify({ ...args, description: "Watch the logs", run_in_background: true }))],
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "agent_3",
    status: "completed",
    content: [text("Started in the background.")],
  });
}

function clineWork(peer: AcpPeer, root: string): void {
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "spawn_1",
    title: "spawn_agent: Audit the dependencies",
    kind: "think",
    status: "pending",
    rawInput: { systemPrompt: "You audit packages.", task: "Audit the dependencies." },
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "spawn_1",
    status: "completed",
    rawOutput: { text: "No known vulnerabilities.", iterations: 3, finishReason: "completed" },
  });
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "spawn_2",
    title: "spawn_agent: Update the lockfile",
    kind: "think",
    status: "pending",
    rawInput: { systemPrompt: "", task: "Update the lockfile." },
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "spawn_2",
    status: "failed",
    rawOutput: "The subagent hit its iteration limit.",
  });
  // Another tool is not a subagent.
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "read_1",
    title: "read_file",
    kind: "read",
    status: "completed",
    rawInput: { path: "package.json" },
  });
}

function hermesWork(peer: AcpPeer, root: string): void {
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "delegate_1",
    title: "delegate_task: Summarize the logs",
    kind: "other",
    status: "in_progress",
    content: [text("Delegating task:\nSummarize the logs")],
  });
  peer.update(root, {
    sessionUpdate: "tool_call_update",
    toolCallId: "delegate_1",
    status: "completed",
    content: [text("The logs show three restarts.")],
  });
}

/** A foreground subagent that runs when the person stops the turn. */
function stoppedWork(peer: AcpPeer, root: string): void {
  peer.update(root, {
    sessionUpdate: "tool_call",
    toolCallId: "spawn_stop",
    title: "spawn_agent: Rewrite the docs",
    kind: "think",
    status: "pending",
    rawInput: { systemPrompt: "", task: "Rewrite the docs." },
  });
}

const prompts = new Map<string, { peer: AcpPeer; reply: () => void }>();

serveFakeAcpAgent(
  {
    initialize: (request, peer) => {
      childUpdates = request.params.clientCapabilities?._meta?.["opencode/child-session-updates"] === true;
      logEntry({ event: "initialize", childUpdates });
      peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] });
    },
    "session/new": (request, peer) => {
      count += 1;
      peer.reply(request, {
        sessionId: `ses_${process.pid}_${count}`,
        models: { availableModels: [{ modelId: MODEL, name: "Fake" }], currentModelId: MODEL },
      });
    },
    "session/prompt": (request, peer) => {
      const root = request.params.sessionId ?? "";
      // The agent service puts its instructions before the user's text, and they use these words too.
      const text = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
      const prompt = text.split("</openbot-developer-instructions>").at(-1) ?? "";
      const reply = () => peer.reply(request, { stopReason: "end_turn" });
      if (prompt.includes("stop")) {
        stoppedWork(peer, root);
        prompts.set(root, { peer, reply: () => peer.reply(request, { stopReason: "cancelled" }) });
        return;
      }
      if (prompt.includes("background")) openCodeBackground(peer, root);
      else if (STYLE === "opencode") openCodeWork(peer, root);
      else if (STYLE === "kimi") kimiWork(peer, root);
      else if (STYLE === "cline") clineWork(peer, root);
      else if (STYLE === "hermes") hermesWork(peer, root);
      peer.say(root, "Done.");
      reply();
    },
  },
  {
    onNotification: (method, params) => {
      if (method !== "session/cancel") return;
      const waiting = prompts.get(params.sessionId ?? "");
      prompts.delete(params.sessionId ?? "");
      waiting?.reply();
    },
  },
);
