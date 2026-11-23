import type { AgentBackupModels, AgentModelChoice } from "@openbot/contracts/ipc";
import {
  type BackupModelSource,
  BackupModelsPage,
  UsageLimitAskCard,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Conversation/Backup models",
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const OWN: AgentModelChoice = { provider: "claude", model: "claude-opus-5-5" };

const SOURCE: BackupModelSource = {
  modelOptions: STORY_MODELS,
  providers: STORY_AGENT_STATUS.providers,
  limited: (choice) => choice.provider === OWN.provider && choice.model === OWN.model,
};

const ORDER: AgentBackupModels = {
  automatic: false,
  order: [
    { provider: "codex", model: "gpt-6-luna" },
    { provider: "claude", model: "claude-sonnet-5" },
    { provider: "claude", model: "claude-opus-5-5" },
  ],
};

const RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

function Page(props: { value: AgentBackupModels | null }) {
  const [value, setValue] = createSignal(props.value);
  return (
    <div class="agent-settings-page" style={{ width: "420px" }}>
      <BackupModelsPage
        agentName="Chief"
        ownModel="Claude Sonnet 5"
        own={{ provider: "claude", model: "claude-sonnet-5" }}
        value={value()}
        source={SOURCE}
        onChange={setValue}
      />
    </div>
  );
}

export const AskFirst: Story = { render: () => <Page value={null} /> };

export const SavedOrder: Story = { render: () => <Page value={ORDER} /> };

export const AskCard: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <UsageLimitAskCard
        provider="claude"
        resetsAt={RESETS_AT}
        options={usageLimitAskOptions(OWN, ORDER, SOURCE)}
        onSend={fn(async () => undefined)}
        onWait={fn()}
      />
    </div>
  ),
};
