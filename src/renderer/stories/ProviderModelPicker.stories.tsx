import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ProviderModelPicker } from "../src/components/ProviderModelPicker";
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

export const Field: Story = {
  args: { variant: "field", label: "Model" },
};

export const Disabled: Story = {
  args: { disabled: true, disabledReason: "Choose a provider first." },
};

export const Opens: Story = {
  args: { reasoningEffort: "medium", onReasoningEffortChange: fn() },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Agent model: GPT-5.6 Luna/ }));
    await canvas.findByRole("dialog", { name: "Choose agent model" });
  },
};

export const UnavailableProvidersOpen: Story = {
  args: {
    modelOptions: STORY_MODELS.filter((model) => model.provider === "codex"),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "codex"
          ? provider
          : {
              ...provider,
              state: "not-installed" as const,
              version: null,
              message:
                provider.id === "grok"
                  ? "Run `grok login` or set XAI_API_KEY to use Grok."
                  : "Run `claude auth login` to use Claude.",
            },
      ),
    },
  },
  play: Opens.play,
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
  play: Opens.play,
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
  play: Opens.play,
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
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Agent model:/ }));
    await canvas.findByRole("textbox", { name: "Search models" });
  },
};
