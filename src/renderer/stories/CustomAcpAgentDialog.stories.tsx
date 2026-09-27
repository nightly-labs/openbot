import { CustomAcpAgentDialog } from "@openbot/ui/features/custom-providers/CustomAcpAgentDialog";
import type {
  CustomAcpAgentDraft,
  CustomAcpAgentPreset,
} from "@openbot/ui/features/custom-providers/custom-acp-agent-form";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

// The ACP launch commands from each agent's documentation and the curated-acp-agents list, read
// 2026-09-27. OpenBot has not started any of them yet, so a real host must confirm each one.
const presets: readonly CustomAcpAgentPreset[] = [
  { id: "cursor", name: "Cursor", command: "cursor-agent", args: "acp" },
  { id: "copilot", name: "Copilot CLI", command: "copilot", args: "--acp" },
  { id: "qwen", name: "Qwen Code", command: "qwen", args: "--acp" },
  { id: "goose", name: "Goose", command: "goose", args: "acp" },
];

const goose: CustomAcpAgentDraft = {
  agentId: "goose",
  displayName: "Goose",
  command: "goose",
  args: "acp",
  env: [{ name: "GOOSE_PROVIDER", value: "ollama" }],
};

const args: Parameters<typeof CustomAcpAgentDialog>[0] = {
  open: true,
  presets,
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
