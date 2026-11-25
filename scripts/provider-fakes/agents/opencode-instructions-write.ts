import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "opencode/fake-free", name: "Fake Free" }],
  currentModelId: "opencode/fake-free",
};
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN ?? "", "utf8"));
const outsideEdit = isDynamicRecord(plan) && typeof plan.outsideEdit === "string" ? plan.outsideEdit : null;
const shellWrite = isDynamicRecord(plan) && typeof plan.shellWrite === "string" ? plan.shellWrite : null;
const writes =
  isDynamicRecord(plan) && Array.isArray(plan.writes)
    ? plan.writes.filter((value): value is string => typeof value === "string")
    : [];
const goFile = isDynamicRecord(plan) && typeof plan.goFile === "string" ? plan.goFile : "";
const workspaces = new Map<string, string>();

function waitForGo(): Promise<void> {
  return new Promise((ready) => {
    const timer = setInterval(() => {
      if (!existsSync(goFile)) return;
      clearInterval(timer);
      ready();
    }, 10);
  });
}
let count = 0;

function promptText(blocks: AcpRequest["params"]["prompt"]): string {
  return (blocks ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
    .trim();
}

function allowed(reply: unknown): boolean {
  const outcome = isDynamicRecord(reply) ? reply.outcome : undefined;
  return isDynamicRecord(outcome) && outcome.optionId === "allow";
}

async function writeInstructions(peer: AcpPeer, sessionId: string, file: string, content: string, index: number) {
  const toolCallId = `write-${index}`;
  const locations = [{ path: file }];
  peer.update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId,
    title: "write",
    kind: "edit",
    status: "in_progress",
    ...(index === 2 ? { locations } : {}),
  });
  const reply = await peer.ask("session/request_permission", {
    sessionId,
    toolCall: {
      toolCallId,
      title: file,
      kind: "edit",
      status: "pending",
      locations,
      rawInput: { path: file, content },
    },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
  });
  const accepted = allowed(reply);
  logEntry({ event: "permission", sessionId, text: toolCallId, accepted });
  if (accepted) writeFileSync(file, content);
  peer.update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: accepted ? "completed" : "failed",
  });
}

function writeWithShell(peer: AcpPeer, sessionId: string, file: string, content: string) {
  const toolCallId = "shell-1";
  const rawInput = { command: `sed -i 's/old-place/shell-place/' ${file}` };
  peer.update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId,
    title: "bash",
    kind: "execute",
    status: "in_progress",
    rawInput,
  });
  writeFileSync(file, content);
  peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "OpenCode", version: "2.3.0" },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    const sessionId = `ses-${process.pid}-${count}`;
    workspaces.set(sessionId, request.params.cwd ?? process.cwd());
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/prompt": async (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const prompt = promptText(request.params.prompt);
    logEntry({ event: "prompt", sessionId, text: prompt });
    if (!/(^|>)rewrite$/u.test(prompt)) {
      peer.say(sessionId, "ok");
      peer.reply(request, { stopReason: "end_turn" });
      return;
    }
    const file = join(workspaces.get(sessionId) ?? process.cwd(), "AGENTS.md");
    await waitForGo();
    if (outsideEdit !== null) writeFileSync(file, outsideEdit);
    if (shellWrite !== null) writeWithShell(peer, sessionId, file, shellWrite);
    for (const [index, content] of writes.entries()) await writeInstructions(peer, sessionId, file, content, index + 1);
    peer.say(sessionId, "done");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
