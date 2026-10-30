// The `cline --acp` of `cline-free-models-e2e.ts`, which answers as Cline 3.0.73 does: a provider
// option of the model category comes before the model option, the model option does not list the
// `cline-free/*` models, and the agent takes any model value.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const LISTED = [
  { modelId: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { modelId: "openai/gpt-6-astra", name: "GPT-6 Astra" },
];
const PROVIDERS = ["cline", "cline-pass", "openai-codex"];

interface Session {
  provider: string;
  model: string;
}
const sessions = new Map<string, Session>();
let count = 0;

function configOptions(session: Session) {
  return [
    {
      id: "provider",
      name: "Provider",
      category: "model",
      type: "select",
      currentValue: session.provider,
      options: PROVIDERS.map((value) => ({ value, name: value })),
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: session.model,
      options: LISTED.map((entry) => ({ value: entry.modelId, name: entry.name })),
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "act",
      options: [
        { value: "act", name: "Act" },
        { value: "plan", name: "Plan" },
      ],
    },
  ];
}

function sessionOf(sessionId: string | undefined): Session {
  const session = sessions.get(sessionId ?? "");
  if (!session) throw new Error(`Unknown session ${sessionId}`);
  return session;
}

serveFakeAcpAgent({
  initialize: (request, peer) => peer.reply(request, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    const sessionId = `s-${count}`;
    const session = { provider: "cline-pass", model: LISTED[0]?.modelId ?? "" };
    sessions.set(sessionId, session);
    peer.reply(request, {
      sessionId,
      configOptions: configOptions(session),
      models: { availableModels: LISTED, currentModelId: session.model },
    });
  },
  "session/set_config_option": (request, peer) => {
    const { sessionId, configId, value = "" } = request.params;
    const session = sessionOf(sessionId);
    logEntry({ event: "set", sessionId, configId, value });
    // As Cline's acpAgent.ts: a provider must be one it knows, and a model is taken as it is.
    if (configId === "provider" && !PROVIDERS.includes(value)) {
      peer.fail(request, { code: -32602, message: `Invalid provider ${value}` });
      return;
    }
    if (configId === "provider") session.provider = value;
    if (configId === "model") session.model = value;
    peer.reply(request, { configOptions: configOptions(session) });
  },
  "session/prompt": (request, peer) => {
    const session = sessionOf(request.params.sessionId);
    logEntry({
      event: "prompt",
      sessionId: request.params.sessionId,
      provider: session.provider,
      model: session.model,
    });
    peer.say(request.params.sessionId, "ok");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
