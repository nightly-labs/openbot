// The `opencode acp` of `opencode-background-turn-e2e.ts`. OpenCode 2.2.0 sends session updates only
// for the execution that a prompt starts. When a background subagent ends, OpenCode answers it in a
// turn of its own: that turn reaches only its store, the session's `updatedAt` in `session/list`
// changes, and `session/load` replays it (#3406). This fake keeps each session's history the same way.
//
// A prompt with `steps` writes text, calls a tool, and then writes the answer in two steps, each a
// message of its own with no tool call between them, as OpenCode 2.2.0 can. A prompt with
// `background` also starts a subagent that stays running. Its turn comes in parts, each at a
// `session/list`: first a tool call that runs, then, after the test creates the file named after the
// session in the folder `FAKE_RELEASE`, the tool's end and an answer with no text yet. The answer's
// text then comes in two more parts, as a replay can find a message that grows. Any other prompt
// answers `pong`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { type AcpPeer, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const RELEASE = process.env.FAKE_RELEASE ?? "";

interface Session {
  id: string;
  cwd: string;
  history: SessionUpdate[];
  updatedAt: number;
  /** The next part of the background turn that a `session/list` adds: 0 none. */
  pending: 0 | 1 | 2 | 3 | 4;
  prompts: number;
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

/** The background answer, which the later parts fill in. */
const ANSWER = ["", "The background task", "The background task finished: DONE."] as const;

function tool(toolCallId: string, status: "in_progress" | "completed", rawOutput?: unknown): SessionUpdate[] {
  return [
    { sessionUpdate: "tool_call", toolCallId, title: "bash", kind: "execute", status: "pending", rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId, status, ...(rawOutput === undefined ? {} : { rawOutput }) },
  ];
}

/** Sends the updates of a prompt's own execution and keeps them in the history. */
function send(peer: AcpPeer, session: Session, updates: SessionUpdate[]): void {
  for (const update of updates) {
    session.history.push(update);
    peer.update(session.id, update);
  }
}

/** Adds the background turn's part to the history only, as OpenCode 2.2.0 does. */
function advance(session: Session): void {
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
      text("msg_bg_2", ANSWER[0]),
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
      answer.content = { type: "text", text: ANSWER[session.pending === 3 ? 1 : 2] };
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
    } else if (prompt.includes("background")) {
      send(peer, session, [
        text(`${turn}_a`, "Starting a background task."),
        ...tool(`${turn}_subagent`, "completed", { metadata: { sessionID: `ses_child_${turn}`, status: "running" } }),
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
