import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { type AcpPeer, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const RELEASE = process.env.FAKE_RELEASE ?? "";
const CHILD_MS = Number(process.env.FAKE_CHILD_MS ?? 5_000);
const CHILD_METHOD = "opencode/session/child_update";
const NL = "\n";

interface Session {
  id: string;
  cwd: string;
  history: SessionUpdate[];
  updatedAt: number;
  pending: 0 | 1 | 2 | 3 | 4;
  prompts: number;
  followsChildren: boolean;
  tagged: boolean;
  loaded: boolean;
}

const sessions = new Map<string, Session>();
let clock = Date.parse("2026-10-27T12:00:00.000Z");

function touch(session: Session): void {
  clock += 1_000;
  session.updatedAt = clock;
}

function text(messageId: string, value: string) {
  return {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text: value },
  } satisfies SessionUpdate;
}

const ANSWER = ["", "The background task", "The background task finished: DONE."] as const;
const TAGGED_ANSWER = [
  "<think>The",
  "<think>The task",
  "<think>The task is done.</think>The background task finished: DONE.",
] as const;

function tool(toolCallId: string, status: "in_progress" | "completed", rawOutput?: unknown): SessionUpdate[] {
  return [
    { sessionUpdate: "tool_call", toolCallId, title: "bash", kind: "execute", status: "pending", rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId, status, ...(rawOutput === undefined ? {} : { rawOutput }) },
  ];
}

function childStatus(session: Session, childSessionId: string, status: "created" | "completed"): void {
  if (!session.followsChildren) return;
  const params = {
    rootSessionId: session.id,
    childSessionId,
    parentSessionId: session.id,
    depth: 1,
    title: "Index the repository",
    type: "status",
    status,
  };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: CHILD_METHOD, params })}${NL}`);
}

function send(peer: AcpPeer, session: Session, updates: SessionUpdate[]): void {
  for (const update of updates) {
    session.history.push(update);
    peer.update(session.id, update);
  }
}

function advance(session: Session): void {
  if (session.tagged && session.pending >= 3 && !session.loaded) return;
  session.loaded = false;
  if (session.pending === 1) {
    session.history.push(
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "msg_bg_1:reasoning:0",
        content: { type: "text", text: "The subagent is done." },
      },
      text("msg_bg_1", "Checking its file."),
      ...tool("tool_bg_check", "in_progress"),
    );
    session.pending = 2;
    touch(session);
    logEntry({ event: "background-started", session: session.id });
    return;
  }
  if (session.pending === 2 && RELEASE && existsSync(join(RELEASE, session.id))) {
    session.history.push(
      { sessionUpdate: "tool_call_update", toolCallId: "tool_bg_check", status: "completed" },
      text("msg_bg_2", (session.tagged ? TAGGED_ANSWER : ANSWER)[0]),
    );
    session.pending = 3;
    touch(session);
    return;
  }
  if (session.pending === 3 || session.pending === 4) {
    const answer = session.history.findLast(
      (update) => update.sessionUpdate === "agent_message_chunk" && update.messageId === "msg_bg_2",
    );
    if (answer?.sessionUpdate === "agent_message_chunk")
      answer.content = {
        type: "text",
        text: (session.tagged ? TAGGED_ANSWER : ANSWER)[session.pending === 3 ? 1 : 2],
      };
    touch(session);
    if (session.pending === 4) logEntry({ event: "background-ended", session: session.id });
    session.pending = session.pending === 3 ? 4 : 0;
  }
}

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    const session: Session = {
      id: `ses_${process.pid}_${count}`,
      cwd: request.params.cwd ?? "",
      history: [],
      updatedAt: 0,
      pending: 0,
      prompts: 0,
      followsChildren: true,
      tagged: false,
      loaded: false,
    };
    touch(session);
    sessions.set(session.id, session);
    peer.reply(request, {
      sessionId: session.id,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
  "session/list": (request, peer) => {
    for (const session of sessions.values()) advance(session);
    const listed = [...sessions.values()]
      .filter((session) => session.cwd === request.params.cwd)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => ({
        sessionId: session.id,
        cwd: session.cwd,
        title: "Session",
        updatedAt: new Date(session.updatedAt).toISOString(),
      }));
    peer.reply(request, { sessions: listed });
  },
  "session/load": (request, peer) => {
    const session = sessions.get(request.params.sessionId ?? "");
    if (!session) {
      peer.fail(request, { code: -32002, message: "Resource not found" });
      return;
    }
    logEntry({ event: "load", session: session.id });
    session.loaded = true;
    session.followsChildren = false;
    for (const update of session.history) peer.update(session.id, update);
    peer.reply(request, {});
  },
  "session/prompt": (request, peer) => {
    const session = sessions.get(request.params.sessionId ?? "");
    if (!session) {
      peer.fail(request, { code: -32002, message: "Resource not found" });
      return;
    }
    session.prompts += 1;
    const turn = `msg_${session.prompts}`;
    const prompt = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    session.tagged = prompt.includes("tagged");
    session.history.push({
      sessionUpdate: "user_message_chunk",
      messageId: `${turn}_user`,
      content: { type: "text", text: prompt },
    });
    if (prompt.includes("steps")) {
      send(peer, session, [
        text(`${turn}_a`, "I will check the file."),
        ...tool(`${turn}_tool`, "completed"),
        text(`${turn}_b`, "The file is fine."),
        text(`${turn}_c`, ""),
        text(`${turn}_c`, "Nothing to change."),
      ]);
    } else if (prompt.includes("child")) {
      const childId = `ses_child_${turn}`;
      const rawInput = {
        description: "Index the repository",
        prompt: "Index every file.",
        agent: "explore",
        background: true,
      };
      send(peer, session, [
        text(`${turn}_a`, "Starting a subagent."),
        {
          sessionUpdate: "tool_call",
          toolCallId: `${turn}_subagent`,
          title: "subagent",
          kind: "other",
          status: "pending",
          rawInput,
        },
      ]);
      childStatus(session, childId, "created");
      send(peer, session, [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: `${turn}_subagent`,
          status: "completed",
          rawOutput: { output: "Started.", metadata: { status: "running", sessionID: childId } },
        },
        text(`${turn}_b`, "I started it."),
      ]);
      setTimeout(() => {
        childStatus(session, childId, "completed");
        logEntry({ event: "child-ended", session: session.id, sent: session.followsChildren });
        session.pending = 1;
      }, CHILD_MS);
    } else if (prompt.includes("background")) {
      const metadata = prompt.includes("shell")
        ? { status: "running", truncated: false, shellID: `shl_${turn}` }
        : { sessionID: `ses_child_${turn}`, status: "running" };
      send(peer, session, [
        text(`${turn}_a`, "Starting a background task."),
        ...tool(`${turn}_task`, "completed", { metadata }),
        text(`${turn}_b`, "I started it."),
      ]);
      session.pending = 1;
    } else {
      send(peer, session, [text(`${turn}_a`, "pong")]);
    }
    touch(session);
    peer.reply(request, { stopReason: "end_turn" });
  },
});
