import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("kiro-cli 2.37.1\n");
  process.exit(0);
}

const PROMPT_MS = Number(process.env.FAKE_PROMPT_MS ?? 1500);
const DEFAULT_MODEL = "other-model";
const MODELS = [
  { value: DEFAULT_MODEL, name: "Other model", description: "Another fake model with 200K context window" },
  { value: "fake-model", name: "Fake model", description: "A fake model with 1M context window" },
];
const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const CONTEXT_PERCENT = 2.5;
let sessions = 0;
let active = 0;
const current = new Map<string, { model: string; effort: string }>();

function configOptions(sessionId: string): SessionConfigOption[] {
  const state = current.get(sessionId) ?? { model: DEFAULT_MODEL, effort: "medium" };
  return [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "vibe",
      options: [{ value: "vibe", name: "Vibe" }],
    },
    { id: "model", name: "Model", type: "select", category: "model", currentValue: state.model, options: MODELS },
    {
      id: "effortLevel",
      name: "Effort",
      type: "select",
      category: "thought_level",
      currentValue: state.effort,
      options: EFFORTS.map((value) => ({ value, name: value })),
    },
  ];
}

serveFakeAcpAgent({
  initialize: (request, peer) => {
    logEntry({ event: "initialize", argv: process.argv.slice(2) });
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: true },
        promptCapabilities: { image: true, embeddedContext: true },
        sessionCapabilities: { list: {}, close: {}, delete: {}, fork: {} },
        _meta: { kiro: { extensionMethods: [] } },
      },
      authMethods: [
        { id: "aws-builder-id", name: "AWS Builder ID" },
        { id: "aws-iam-identity-center", name: "AWS IAM Identity Center" },
      ],
    });
  },
  "session/new": (request, peer) => {
    sessions += 1;
    const sessionId = `kiro-session-${process.pid}-${sessions}`;
    current.set(sessionId, { model: DEFAULT_MODEL, effort: "medium" });
    logEntry({ event: "session/new", sessionId, cwd: request.params.cwd });
    peer.reply(request, { sessionId, configOptions: configOptions(sessionId) });
  },
  "session/set_config_option": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const state = current.get(sessionId);
    const { configId, value } = request.params;
    if (state && configId === "model" && value) state.model = value;
    if (state && configId === "effortLevel" && value) state.effort = value;
    logEntry({ event: "set-config", sessionId, configId, value });
    peer.reply(request, { configOptions: configOptions(sessionId) });
  },
  "session/set_model": (request, peer) => {
    logEntry({ event: "set-model", sessionId: request.params.sessionId });
    peer.fail(request, {
      code: -32603,
      message: '[PersistenceClassification] Ext method "session/set_model" has no persistence classification',
    });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    const message = text.split("</openbot-developer-instructions>").at(-1) ?? "";
    active += 1;
    logEntry({
      event: "prompt-start",
      sessionId,
      at: Date.now(),
      active,
      message: message.trim().slice(0, 40),
      model: current.get(sessionId)?.model,
    });
    peer.update(sessionId, {
      sessionUpdate: "session_info_update",
      _meta: { kiro: { kind: "turn_start" } },
    });
    setTimeout(() => {
      active -= 1;
      logEntry({ event: "prompt-end", sessionId, at: Date.now(), active });
      peer.update(sessionId, {
        sessionUpdate: "session_info_update",
        _meta: { kiro: { kind: "context_usage", contextUsage: { usagePercentage: CONTEXT_PERCENT } } },
      });
      peer.say(sessionId, "Done.");
      peer.reply(request, { stopReason: "end_turn" });
    }, PROMPT_MS);
  },
});
