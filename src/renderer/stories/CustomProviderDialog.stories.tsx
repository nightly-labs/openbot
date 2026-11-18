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

/** An endpoint on this computer: each model can set its context window, max output, efforts and inputs. */
export const DialogContextWindows: Story = {
  args: {
    contextWindows: true,
    draft: {
      ...localEndpoint,
      models: [
        {
          id: "qwen3-coder:30b",
          name: "Qwen3 Coder 30B",
          contextWindow: "262,144",
          maxOutput: "65,536",
          reasoningEfforts: ["low", "high", "max"],
          inputs: ["image"],
        },
        { id: "gpt-oss:120b", name: "GPT-OSS 120B", contextWindow: "" },
      ],
    },
  },
};

/** This computer: the endpoint can run on each provider that can run it now. */
/** Models of a large endpoint, with the limits that the model catalog gives for them. */
const MANY_MODELS: readonly (readonly [string, string, string, string])[] = [
  ["relace/relace-search", "Relace Search", "256,000", "128,000"],
  ["moondream/moondream3-preview", "Moondream 3 Preview", "32,000", "4,096"],
  ["z-ai/glm-5", "GLM-5", "204,800", "131,072"],
  ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "Nemotron 3 Nano Omni (free)", "256,000", "65,536"],
  ["sao10k/l3-lunaris-8b", "Llama 3 8B Lunaris", "8,192", "7,372"],
  ["openrouter/fusion", "Fusion", "1,000,000", "128,000"],
  ["bytedance/ui-tars-1.5-7b", "UI-TARS 7B", "128,000", "2,048"],
  ["openai/gpt-5.1-codex-mini", "GPT-5.1 Codex mini", "400,000", "128,000"],
  ["openai/gpt-5.4-pro", "GPT-5.4 Pro", "1,050,000", "128,000"],
  ["openai/gpt-chat-latest", "GPT Chat Latest", "400,000", "128,000"],
  ["openai/gpt-4o-mini-2024-07-18", "GPT-4o-mini (2024-07-18)", "128,000", "16,384"],
  ["mistralai/ministral-3b-2512", "Ministral 3 3B 2512", "131,072", "104,857"],
  ["anthropic/claude-fable-5.1", "Claude Fable 5.1", "1,000,000", "128,000"],
  ["anthropic/claude-opus-4.5", "Claude Opus 4.5 (latest)", "200,000", "64,000"],
  ["gryphe/mythomax-l2-13b", "MythoMax L2 13B", "8,192", "3,686"],
  ["perplexity/sonar", "Sonar", "127,072", "114,364"],
  ["morph/morph-v3-fast", "Morph V3 Fast", "262,144", "131,072"],
  ["qwen/qwen-plus", "Qwen Plus", "1,000,000", "32,768"],
  ["qwen/qwen3-235b-a22b-2507", "Qwen3 235B A22B Instruct 2507", "262,144", "117,964"],
  ["qwen/qwen3-14b", "Qwen3 14B", "40,960", "36,864"],
  ["google/gemini-3.7-flash", "Gemini 3.7 Flash", "1,048,576", "65,536"],
  ["google/gemini-3.6-flash", "Gemini 3.6 Flash", "1,048,576", "65,536"],
  ["deepseek/deepseek-v4-flash-0731", "DeepSeek V4 Flash 0731", "1,048,576", "943,718"],
  ["bytedance-seed/seed-2.0-lite", "Seed 2.0 Lite", "262,144", "131,072"],
];

/** The model table with many models: the rows scroll and the footer stays in view. */
export const DialogContextWindowsMany: Story = {
  args: {
    contextWindows: true,
    draft: {
      ...localEndpoint,
      models: MANY_MODELS.map(([id, name, contextWindow, maxOutput]) => ({ id, name, contextWindow, maxOutput })),
    },
  },
};

export const DialogRunsOn: Story = {
  args: {
    contextWindows: true,
    draft: localEndpoint,
    harnesses: [
      { id: "opencode", ready: true },
      { id: "pi", ready: true },
    ],
  },
};

/** Pi is not downloaded: a choice of it chooses it and downloads it. */
export const DialogRunsOnDownload: Story = {
  args: {
    contextWindows: true,
    draft: localEndpoint,
    onDownloadHarness: fn(),
    harnesses: [
      { id: "opencode", ready: true },
      { id: "pi", ready: false, runtime: { phase: "not-downloaded", progress: null, message: null, version: null } },
    ],
  },
};

/** Pi is chosen and downloads: the field shows the progress. */
export const DialogRunsOnDownloading: Story = {
  args: {
    contextWindows: true,
    draft: { ...localEndpoint, harness: "pi" },
    onDownloadHarness: fn(),
    harnesses: [
      { id: "opencode", ready: true },
      { id: "pi", ready: false, runtime: { phase: "downloading", progress: 42, message: null, version: null } },
    ],
  },
};

/** The download of the chosen Pi failed: its item retries, and the field says why. */
export const DialogRunsOnDownloadError: Story = {
  args: {
    contextWindows: true,
    draft: { ...localEndpoint, harness: "pi" },
    onDownloadHarness: fn(),
    harnessError: "Could not download Pi. Check your connection and try again.",
    harnesses: [
      { id: "opencode", ready: true },
      { id: "pi", ready: false, runtime: { phase: "download-error", progress: null, message: null, version: null } },
    ],
  },
};

export const DialogContextWindowError: Story = {
  args: {
    contextWindows: true,
    showErrors: true,
    draft: {
      ...localEndpoint,
      models: [
        { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B", contextWindow: "128k" },
        { id: "gpt-oss:120b", name: "GPT-OSS 120B", contextWindow: "131,072" },
      ],
    },
  },
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

/** An endpoint that lists more models than one endpoint can hold: the search narrows what Select all adds. */
export const DiscoveryFoundMany: Story = {
  args: {
    draft: ollama,
    onDiscoverModels: fn(),
    discovery: {
      status: "found",
      models: ["qwen3-coder", "gpt-oss", "devstral", "llama3.3", "mistral-small", "gemma3"].flatMap((family) =>
        Array.from({ length: 20 }, (_, index) => ({ id: `${family}:${index + 1}b` })),
      ),
    },
  },
};

/**
 * After Find models, the list gives a window, a max output and input kinds (#3946): they fill the empty
 * fields of the rows that it names, and a line says where they come from.
 */
export const DiscoveryFoundValues: Story = {
  args: {
    contextWindows: true,
    draft: {
      ...ollama,
      models: [
        { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B", contextWindow: "262,144", maxOutput: "65,536", inputs: [] },
        { id: "gpt-oss:120b", name: "GPT-OSS 120B", contextWindow: "131,072" },
      ],
    },
    onDiscoverModels: fn(),
    discovery: {
      status: "found",
      models: [
        { id: "qwen3-coder:30b", contextWindow: 262_144, maxOutput: 65_536, inputs: [] },
        { id: "gpt-oss:120b", contextWindow: 131_072 },
        { id: "gemma3:27b", contextWindow: 131_072, inputs: ["image"] },
      ],
    },
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
