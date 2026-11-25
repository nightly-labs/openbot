import type { AgentModelId, AgentProviderId, AgentStatus, ProviderAccountPool } from "@openbot/contracts/ipc";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const args: Parameters<typeof ProviderModelPicker>[0] = {
  provider: "codex",
  value: "gpt-5.6-luna",
  modelOptions: STORY_MODELS,
  agentStatus: STORY_AGENT_STATUS,
  onChange: fn(),
};

const meta = {
  title: "Conversation/ProviderModelPicker",
  component: ProviderModelPicker,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ProviderModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pill: Story = {
  args: { reasoningEffort: "medium", onReasoningEffortChange: fn() },
};

export const AllEffortLevels: Story = {
  args: {
    provider: "claude",
    value: "claude-opus-5-5",
    modelOptions: STORY_MODELS.map((model) =>
      model.id === "claude-opus-5-5"
        ? { ...model, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }
        : model,
    ),
    reasoningEffort: "high",
    onReasoningEffortChange: fn(),
  },
};

export const LimitedEffort: Story = {
  args: {
    provider: "claude",
    value: "claude-opus-5-5",
    modelOptions: STORY_MODELS.map((model) =>
      model.id === "claude-opus-5-5" ? { ...model, supportedReasoningEfforts: ["low", "medium"] } : model,
    ),
    reasoningEffort: "medium",
    onReasoningEffortChange: fn(),
  },
};

export const Ultrafast: Story = {
  args: {
    value: "gpt-5.6-sol",
    reasoningEffort: "high",
    onReasoningEffortChange: fn(),
    fastMode: true,
    ultrafast: true,
    onFastModeChange: fn(),
  },
};

export const Field: Story = {
  args: { variant: "field", label: "Model" },
};

export const Disabled: Story = {
  args: { disabled: true, disabledReason: "Choose a provider first." },
};

export const UnavailableProvidersOpen: Story = {
  args: {
    modelOptions: STORY_MODELS.filter((model) => model.provider === "claude"),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "claude"
          ? provider
          : {
              ...provider,
              state: "not-installed" as const,
              version: null,
              message: provider.id === "codex" ? "Run `codex login` to use Codex." : null,
            },
      ),
    },
  },
};

export const ConnectedProvidersOnly: Story = {
  args: {
    onManageProviders: fn(),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "codex" || provider.id === "claude"
          ? provider
          : { ...provider, state: "sign-in-required" as const },
      ),
    },
  },
};

export const ProviderDownloadsOpen: Story = {
  args: {
    modelOptions: STORY_MODELS.filter((model) => model.provider === "codex"),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      phase: "blocked",
      providers: STORY_AGENT_STATUS.providers?.map((provider) => ({
        ...provider,
        state: "not-installed" as const,
        version: null,
        message: null,
      })),
    },
    runtimeStatuses: {
      codex: { phase: "downloading", progress: 24, message: null, version: null },
      claude: { phase: "downloading", progress: 48, message: null, version: null },
      grok: { phase: "downloading", progress: 72, message: null, version: null },
    },
    onDownloadProvider: fn(),
    onCancelProviderDownload: fn(),
    onConnectProvider: fn(),
  },
};

export const DiscoveredModels: Story = {
  args: {
    modelOptions: [
      ...STORY_MODELS,
      {
        provider: "codex",
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        description: "Codex model discovered from the local CLI.",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      },
    ],
  },
};

export const OpenCodeCatalog: Story = {
  args: {
    provider: "opencode",
    value: "opencode/example-free/low",
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: [{ id: "opencode", state: "available", version: "1.3.13", message: null }],
    },
    modelOptions: [
      ["cerebras/qwen", "Cerebras/Qwen"],
      ["openai/gpt", "OpenAI/GPT"],
      ["opencode/example-free", "OpenCode Zen/Example Free"],
      ["opencode/another-free", "OpenCode Zen/Another Free"],
      ["opencode/example", "OpenCode Zen/Example"],
      ["zai/glm", "Z.AI/GLM"],
    ].flatMap(([id, name]) =>
      ["", "low", "medium", "high", "xhigh"].map((effort) => ({
        provider: "opencode" as const,
        id: effort ? `${id}/${effort}` : id,
        name: effort ? `${name} (${effort})` : name,
        description: "Example model catalog",
        defaultReasoningEffort: "medium" as const,
        supportedReasoningEfforts: ["medium" as const],
      })),
    ),
  },
};

const openCodeCatalog = (entries: [string, string][]) =>
  entries.map(([id, name]) => ({
    provider: "opencode" as const,
    id,
    name,
    description: "Example model catalog",
    defaultReasoningEffort: "medium" as const,
    supportedReasoningEfforts: ["medium" as const],
  }));

export const OpenCodeLocalModels: Story = {
  args: {
    provider: "opencode",
    value: "ollama/qwen3-coder:30b",
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: [{ id: "opencode", state: "available", version: "1.3.13", message: null }],
    },
    modelOptions: openCodeCatalog([
      ["ollama/qwen3-coder:30b", "Ollama/Qwen3 Coder 30B"],
      ["ollama/gpt-oss:120b", "Ollama/GPT-OSS 120B"],
      ["lmstudio/glm-5-air", "LM Studio/GLM-5 Air"],
      ["opencode/example-free", "OpenCode Zen/Example Free"],
      ["opencode/example", "OpenCode Zen/Example"],
      ["zai/glm", "Z.AI/GLM"],
      ["openai/gpt", "OpenAI/GPT"],
    ]),
  },
};

const openCodeStatus = {
  ...STORY_AGENT_STATUS,
  providers: [{ id: "opencode" as const, state: "available" as const, version: "1.18.27", message: null }],
};

const customProviders = [
  {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    hasApiKey: false,
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
  },
  {
    id: "house-router",
    name: "House Router",
    baseUrl: "https://models.example.com/v1",
    hasApiKey: true,
    models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
  },
];

export const CustomTabEmpty: Story = {
  args: {
    provider: "opencode",
    value: "opencode/example",
    agentStatus: openCodeStatus,
    modelOptions: openCodeCatalog([["opencode/example", "OpenCode Zen/Example"]]),
    onAddCustomProvider: fn(),
  },
};

export const CustomTabWithModels: Story = {
  args: {
    provider: "opencode",
    value: "studio-local/qwen3-coder:30b",
    agentStatus: openCodeStatus,
    customProviders,
    onAddCustomProvider: fn(),
    modelOptions: openCodeCatalog([
      ["studio-local/qwen3-coder:30b", "Studio Local/Qwen3 Coder 30B"],
      ["studio-local/gpt-oss:120b", "Studio Local/GPT-OSS 120B"],
      ["house-router/glm-5-air", "House Router/GLM-5 Air"],
      ["opencode/example-free", "OpenCode Zen/Example Free"],
      ["openai/gpt", "OpenAI/GPT"],
    ]),
  },
};

export const CustomTabPending: Story = {
  args: {
    provider: "opencode",
    value: "opencode/example",
    agentStatus: { ...STORY_AGENT_STATUS, providers: [{ ...openCodeStatus.providers[0], endpointsPending: true }] },
    customProviders,
    onAddCustomProvider: fn(),
    onManageProviders: fn(),
    modelOptions: openCodeCatalog([["opencode/example", "OpenCode Zen/Example"]]),
  },
};

export const CustomTabUnlisted: Story = {
  args: {
    ...CustomTabPending.args,
    agentStatus: { ...STORY_AGENT_STATUS, providers: [{ ...openCodeStatus.providers[0], endpointsPending: false }] },
  },
};

export const OpenCodeTabExcludesCustom: Story = {
  args: {
    ...CustomTabWithModels.args,
    value: "opencode/example-free",
  },
};

const spentWeekResetsAt = Math.floor(Date.now() / 1_000) + 3 * 24 * 60 * 60;

const usageLimitArgs: Parameters<typeof ProviderModelPicker>[0] = {
  ...args,
  provider: "claude",
  value: "claude-opus-5-5",
  reasoningEffort: "high",
  onReasoningEffortChange: fn(),
  accountUsage: {
    limits: [
      {
        id: "claude",
        primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: spentWeekResetsAt - 2 * 24 * 60 * 60 },
        secondary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: spentWeekResetsAt },
      },
      {
        id: "codex",
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: spentWeekResetsAt },
        secondary: null,
      },
    ],
  },
};

export const UsageLimitReached: Story = { render: () => <ProviderModelPicker {...usageLimitArgs} /> };

const codexOllamaModels = ["gemma4:latest", "qwen3.6:latest", "glm-5.2:cloud", "kimi-k2.7-code:cloud"].map((id) => ({
  provider: "codex" as const,
  id,
  name: id,
  description: "Codex model discovered from the local CLI.",
  defaultReasoningEffort: "medium" as const,
  supportedReasoningEfforts: ["medium" as const],
}));

const codexStatusWithSource = (modelSource: { kind: "provider"; name: string } | { kind: "catalog" }) => ({
  ...STORY_AGENT_STATUS,
  providers: STORY_AGENT_STATUS.providers?.map((provider) =>
    provider.id === "codex" ? { ...provider, modelSource } : provider,
  ),
});

export const CodexModelProviderSource: Story = {
  args: {
    value: "gemma4:latest",
    modelOptions: [...codexOllamaModels, ...STORY_MODELS.filter((model) => model.provider !== "codex")],
    agentStatus: codexStatusWithSource({ kind: "provider", name: "Ollama" }),
  },
};

export const CodexModelCatalogSource: Story = {
  args: {
    value: "gemma4:latest",
    modelOptions: [...codexOllamaModels, ...STORY_MODELS.filter((model) => model.provider !== "codex")],
    agentStatus: codexStatusWithSource({ kind: "catalog" }),
  },
};

const POOL_ACCOUNTS = [
  { id: "default", label: null, email: "person@example.com", state: "connected" as const, message: null },
  { id: "a1111111111111111", label: "Work", email: null, state: "connected" as const, message: null },
  { id: "a2222222222222222", label: "Reserved", email: null, state: "connected" as const, message: null },
];

const poolStatus = (accountPool: ProviderAccountPool): AgentStatus => ({
  ...STORY_AGENT_STATUS,
  providers: STORY_AGENT_STATUS.providers?.map((provider) =>
    provider.id === "codex" ? { ...provider, accounts: POOL_ACCOUNTS, accountPool } : provider,
  ),
});

function PoolPicker(props: { accountPool: ProviderAccountPool }) {
  const [provider, setProvider] = createSignal<AgentProviderId>("codex");
  const [model, setModel] = createSignal<AgentModelId>("gpt-5.6-luna");
  const [account, setAccount] = createSignal<string | undefined>("a1111111111111111");
  return (
    <ProviderModelPicker
      {...args}
      agentStatus={poolStatus(props.accountPool)}
      provider={provider()}
      value={model()}
      accountChoice
      leftOutAccountChoice
      providerAccountId={account()}
      onChange={(nextModel, nextProvider, accountId) => {
        setModel(nextModel);
        setProvider(nextProvider);
        if (accountId !== undefined) setAccount(accountId ?? undefined);
      }}
    />
  );
}

export const PoolWithAccountLeftOut: Story = {
  render: () => <PoolPicker accountPool={{ leftOut: ["a2222222222222222"], inUse: "a1111111111111111" }} />,
};

export const PoolWithOwnSignInLeftOut: Story = {
  render: () => <PoolPicker accountPool={{ leftOut: ["default"], inUse: "a1111111111111111" }} />,
};
