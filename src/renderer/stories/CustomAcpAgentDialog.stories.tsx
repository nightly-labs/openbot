import { ACP_AGENT_PRESETS } from "@openbot/contracts/ipc";
import { CustomAcpAgentDialog } from "@openbot/ui/features/custom-providers/CustomAcpAgentDialog";
import {
  type CustomAcpAgentDraft,
  savedAcpAgentDraft,
} from "@openbot/ui/features/custom-providers/custom-acp-agent-form";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const goose: CustomAcpAgentDraft = {
  agentId: "goose",
  displayName: "Goose",
  command: "goose",
  args: "acp",
  env: [{ name: "GOOSE_PROVIDER", value: "ollama" }],
  usagePrompt: "",
};

const args: Parameters<typeof CustomAcpAgentDialog>[0] = {
  open: true,
  presets: ACP_AGENT_PRESETS,
  onCheck: fn(),
  onSubmit: fn(),
  onCancel: fn(),
};

const meta = {
  title: "Conversation/CustomAcpAgentDialog",
  component: CustomAcpAgentDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CustomAcpAgentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentBlank: Story = {};

export const AgentFilled: Story = {
  args: { draft: goose, onBack: fn() },
};

/** A saved agent: the ID is locked, and the saved key shows as kept. */
export const AgentEdit: Story = {
  args: {
    editing: true,
    draft: savedAcpAgentDraft({
      id: "goose",
      name: "Goose",
      command: "/opt/homebrew/bin/goose",
      args: ["acp"],
      envNames: ["GOOSE_PROVIDER", "OPENAI_API_KEY"],
      resolvedCommand: "/opt/homebrew/bin/goose",
      usagePrompt: "/usage",
    }),
  },
};

export const AgentChecking: Story = {
  args: { draft: goose, check: { status: "checking" } },
};

export const AgentCheckPassed: Story = {
  args: {
    draft: goose,
    check: {
      status: "ok",
      agentName: "goose",
      version: "1.9.0",
      protocolVersion: 1,
      capabilities: ["loadSession", "image", "mcp"],
      models: [
        "Claude Sonnet 5.5",
        "Claude Opus 5.5",
        "GPT-5.5",
        "Gemini 3 Pro",
        "Kimi K3",
        "Qwen 4 Coder",
        "DeepSeek V4",
        "GLM 5",
        "Grok 5",
        "Mistral Large 3",
      ],
    },
  },
};

export const AgentCheckFailed: Story = {
  args: {
    draft: { ...goose, command: "gooose" },
    check: { status: "failed", message: "OpenBot could not find gooose on your PATH." },
  },
};

export const AgentErrors: Story = {
  args: {
    showErrors: true,
    takenAgentIds: ["goose"],
    draft: { agentId: "goose", displayName: "", command: "", args: "", env: [{ name: "1BAD", value: "x" }] },
  },
};

export const AgentBusy: Story = {
  args: { draft: goose, busy: true },
};
