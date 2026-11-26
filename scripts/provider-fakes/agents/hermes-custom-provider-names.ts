import { type AcpHandler, serveFakeAcpAgent } from "../acp-agent";

const availableModels = [
  {
    modelId: "anthropic:claude-fable-5-1",
    name: "Anthropic · claude-fable-5-1",
    description: "Provider: Anthropic • current",
  },
  { modelId: "custom:arena:claude-fable-5-1", name: "claude-fable-5-1", description: "Provider: Arena" },
  { modelId: "custom:lab-key:qwen2.5:7b", name: "qwen2.5:7b", description: "Provider: Lab R&D" },
  { modelId: "custom:llama3:8b", name: "llama3:8b", description: "Provider: Custom" },
  { modelId: "custom:ollama:mistral:latest", name: "Ollama · mistral:latest", description: "Provider: Ollama" },
  { modelId: "custom:spare:gpt-oss-20b", name: "gpt-oss-20b" },
  { modelId: "anthropic:model-4", name: "Anthropic · model-4", description: "Provider: Anthropic" },
  {
    modelId: "custom:east-west:model-3",
    name: "model-3",
    description: "Provider: East • West · Lab 9 • current\nSynthetic provider detail",
  },
];

const openSession: AcpHandler = (request, peer) =>
  peer.reply(request, {
    sessionId: request.params.sessionId ?? "hermes-catalog",
    models: { currentModelId: "anthropic:claude-fable-5-1", availableModels },
  });

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "hermes-agent", version: "0.22.3" },
      agentCapabilities: { loadSession: true, promptCapabilities: {} },
      authMethods: [],
    }),
  "session/new": openSession,
  "session/load": openSession,
});
