import type { InstalledSkill } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_INSTALLED_SKILLS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgent = STORY_AGENT;

function AgentSkillsStory(props: {
  skills: InstalledSkill[];
  skillsMode?: "mutable" | "readonly" | "hidden";
  onAddFromMarketplace?: (agentId: string) => void;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ installedSkills: { chief: props.skills } });
  window.openbot = mock.api;

  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });

  return (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel
        onCreateSkill={fn()}
        onTrySkill={fn()}
        onOpenUsage={fn()}
        agent={storyAgent}
        runtimeSettings={{
          provider: storyAgent.provider,
          model: storyAgent.model,
          reasoningEffort: storyAgent.reasoningEffort,
        }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={fn()}
        onWidthChange={fn()}
        skillsMode={props.skillsMode}
        onAddFromMarketplace={props.onAddFromMarketplace}
        onUpdateAgent={async (agentId, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
        }}
        onUpdateRuntimeSettings={async (agentId, _settings, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
          return true;
        }}
        onSetAgentAvatar={async (agentId, image) => {
          await mock.api.agent.setAvatar({ agentId, image });
        }}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Skills",
  component: AgentSettingsPanel,
  args: {
    agent: storyAgent,
    runtimeSettings: {
      provider: storyAgent.provider,
      model: storyAgent.model,
      reasoningEffort: storyAgent.reasoningEffort,
    },
    agentStatus: STORY_AGENT_STATUS,
    modelOptions: STORY_MODELS,
    working: false,
    maxWidth: () => 640,
    onClose: fn(),
    onWidthChange: fn(),
    onUpdateAgent: fn(async () => undefined),
    onUpdateRuntimeSettings: fn(async () => true),
    onSetAgentAvatar: fn(async () => undefined),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const addFromMarketplace = fn();

export const SettingsRow: Story = {
  render: () => (
    <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} onAddFromMarketplace={addFromMarketplace} />
  ),
};

export const EmptyState: Story = {
  render: () => <AgentSkillsStory skills={[]} onAddFromMarketplace={addFromMarketplace} />,
};

export const RemoteReadOnly: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.research ?? []} skillsMode="readonly" />,
};
