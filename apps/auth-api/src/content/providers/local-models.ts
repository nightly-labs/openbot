import type { ProviderPage } from "./provider-page";

// Every statement about Ollama and LM Studio here is taken from ollama.com,
// docs.ollama.com and lmstudio.ai. Each page used is in `sources`. OpenBot finds both
// servers at their default addresses (`DEFAULT_MODEL_SERVERS` in
// packages/contracts/src/ipc-provider-detection.ts) and runs them through OpenCode as a
// custom OpenAI-compatible provider. Check the sources again, and move `checkedAt`,
// whenever this file changes.

export const LOCAL_MODELS_PROVIDER: ProviderPage = {
  provider: "custom",
  name: "Ollama and LM Studio",
  answer:
    "OpenBot runs a coding agent on a model from Ollama or LM Studio, on macOS, Windows or Linux. The model, your files and your chats stay on your computer, and your agents work in a team with an app on your phone.",
  connect:
    "Start Ollama or LM Studio. OpenBot looks at their usual addresses, 127.0.0.1:11434 and 127.0.0.1:1234, and shows the server under Found on this computer, in onboarding and in Settings. Press Add, and OpenCode runs your agents on its models.",
  adds: [
    {
      icon: "laptop",
      title: "Model requests stay on your computer",
      text: "With a local model, the requests go to a server on your computer, not to a provider. Any other OpenAI-compatible server works too.",
    },
    {
      icon: "cloud",
      title: "Local and hosted models in one team",
      text: "Give the simple jobs to a local model, and the hard ones to Claude Code or Codex, in the same channel.",
    },
  ],
  vendor: "Ollama and LM Studio",
  officialApps: [
    {
      name: "Ollama",
      platforms: "macOS 14+, Windows 10 22H2+, Linux",
      note: "A model server with a chat app on macOS and Windows. Its OpenAI-compatible API supports tools.",
    },
    {
      name: "LM Studio",
      platforms: "macOS 14+ on Apple silicon, Windows x64 and Arm, Linux x64 and arm64",
      note: "A desktop app to download and chat with models, with a local server. Free at home and at work.",
    },
  ],
  comparisons: ["best-ai-agent-apps"],
  faq: [
    {
      question: "Can I use Ollama or LM Studio with a coding agent?",
      answer:
        "Yes. In OpenBot, OpenCode runs the agent on the OpenAI-compatible server of Ollama or LM Studio. Choose a model that supports tool calls: smaller models and models not trained for tools can send tool calls in the wrong format.",
    },
    {
      question: "How much context does a local model need?",
      answer:
        "More than the default. Ollama says that agents and coding tools need at least 64,000 tokens of context, and its default can be 4,000 tokens on a smaller graphics card. Set it higher in Ollama before you start.",
    },
    {
      question: "Does a local model need an account?",
      answer: "No. Ollama and LM Studio need no account for local models.",
    },
    {
      question: "Can I use a model server on another computer?",
      answer:
        "Yes. Add the address of any OpenAI-compatible server in OpenBot's settings, with a key if the server needs one.",
    },
  ],
  sources: [
    { label: "Ollama: download", url: "https://ollama.com/download" },
    { label: "Ollama: macOS", url: "https://docs.ollama.com/macos" },
    { label: "Ollama: Windows", url: "https://docs.ollama.com/windows" },
    { label: "Ollama: OpenAI compatibility", url: "https://docs.ollama.com/api/openai-compatibility" },
    { label: "Ollama: context length", url: "https://docs.ollama.com/context-length" },
    { label: "Ollama: the new app", url: "https://ollama.com/blog/new-app" },
    { label: "LM Studio: system requirements", url: "https://lmstudio.ai/docs/app/system-requirements" },
    { label: "LM Studio: OpenAI compatibility", url: "https://lmstudio.ai/docs/developer/openai-compat" },
    { label: "LM Studio: tool use", url: "https://lmstudio.ai/docs/developer/openai-compat/tools" },
    { label: "LM Studio: free for work", url: "https://lmstudio.ai/blog/free-for-work" },
  ],
  checkedAt: "2026-10-03",
};
