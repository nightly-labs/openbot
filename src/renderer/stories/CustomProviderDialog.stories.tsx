import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import type { CustomProviderDraft } from "@openbot/ui/features/custom-providers/custom-provider-form";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const localEndpoint: CustomProviderDraft = {
  providerId: "studio-local",
  displayName: "Studio Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  // Never a shape that could be mistaken for a live key, here or in any other story.
  apiKey: "story-placeholder-not-a-key",
  models: [
    { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
    { id: "gpt-oss:120b", name: "GPT-OSS 120B" },
  ],
  headers: [{ name: "X-Tenant", value: "studio" }],
};

const args: Parameters<typeof CustomProviderDialog>[0] = {
  open: true,
  onSubmit: fn(),
  onCancel: fn(),
};

const meta = {
  title: "Conversation/CustomProviderDialog",
  component: CustomProviderDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CustomProviderDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DialogBlank: Story = {};

export const DialogFilled: Story = {
  args: { draft: localEndpoint, onBack: fn() },
};

export const DialogErrors: Story = {
  args: {
    showErrors: true,
    draft: {
      providerId: "My Provider",
      displayName: "",
      baseUrl: "127.0.0.1:11434",
      apiKey: "",
      models: [
        { id: "qwen 3", name: "Qwen 3" },
        { id: "qwen 3", name: "Qwen 3 again" },
      ],
      headers: [{ name: "X Tenant", value: "" }],
    },
  },
};

export const DialogSubmits: Story = {
  args: { draft: localEndpoint },
};

export const DialogBusy: Story = {
  args: { draft: localEndpoint, busy: true },
};

export const DialogSubmitError: Story = {
  args: { draft: localEndpoint, submitError: "OpenBot could not reach http://127.0.0.1:11434/v1." },
};

/** Long enough to scroll, which is the only way to see the top and bottom fades. */
export const DialogScrolls: Story = {
  args: {
    draft: {
      ...localEndpoint,
      models: Array.from({ length: 9 }, (_, index) => ({
        id: `qwen3-coder:${index + 1}b`,
        name: `Qwen3 Coder ${index + 1}B`,
      })),
    },
  },
};

const ollama: CustomProviderDraft = {
  providerId: "ollama",
  displayName: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  models: [{ id: "", name: "" }],
  headers: [{ name: "", value: "" }],
};

const discovered = [{ id: "qwen3-coder:30b" }, { id: "gpt-oss:120b" }, { id: "devstral:24b" }, { id: "llama3.3:70b" }];

/** The find control appears only when the host can ask the endpoint for its models. */
export const DiscoveryIdle: Story = {
  args: { draft: ollama, onDiscoverModels: fn() },
};

export const DiscoveryLoading: Story = {
  args: { draft: ollama, onDiscoverModels: fn(), discovery: { status: "loading" } },
};

/** Two of the four models are already rows, so their boxes open selected. */
export const DiscoveryFound: Story = {
  args: {
    draft: { ...ollama, models: localEndpoint.models },
    onDiscoverModels: fn(),
    discovery: { status: "found", models: discovered },
  },
};

export const DiscoveryEmpty: Story = {
  args: { draft: ollama, onDiscoverModels: fn(), discovery: { status: "found", models: [] } },
};

export const DiscoveryFailed: Story = {
  args: {
    draft: ollama,
    onDiscoverModels: fn(),
    discovery: { status: "failed", message: "OpenBot could not reach http://127.0.0.1:11434/v1/models." },
  },
};
