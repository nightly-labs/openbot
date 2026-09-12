import type { InstalledSkill } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { expect, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_INSTALLED_SKILLS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

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
        onOpenUsage={fn()}
        agent={STORY_AGENTS[0]}
        runtimeSettings={{
          provider: STORY_AGENTS[0].provider,
          model: STORY_AGENTS[0].model,
          reasoningEffort: STORY_AGENTS[0].reasoningEffort,
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
    agent: STORY_AGENTS[0],
    runtimeSettings: {
      provider: STORY_AGENTS[0].provider,
      model: STORY_AGENTS[0].model,
      reasoningEffort: STORY_AGENTS[0].reasoningEffort,
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
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: /Skills/ })).toHaveTextContent("3 assigned"));
  },
};

export const OpenModal: Story = {
  render: () => (
    <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} onAddFromMarketplace={addFromMarketplace} />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Skills" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).queryByText("Managed")).toBeNull();
    await expect(within(dialog).queryByText("openbot-site-hosting")).toBeNull();
    await expect(within(dialog).getByText("Release notes")).toBeVisible();
    await expect(within(dialog).getByText("Local changes")).toBeVisible();
    await expect(within(dialog).getByText("Update available")).toBeVisible();
  },
};

export const OpenDetail: Story = {
  render: () => (
    <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} onAddFromMarketplace={addFromMarketplace} />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: /^Inbox triage/ }));
    const dialog = await body.findByRole("dialog", { name: "Inbox triage" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Skills" })).toBeVisible();
    await expect(within(dialog).getByText(/Sorts a morning inbox/)).toBeVisible();
  },
};

export const EmptyState: Story = {
  render: () => <AgentSkillsStory skills={[]} onAddFromMarketplace={addFromMarketplace} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Skills" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByText("This agent has no assigned skills yet.")).toBeVisible();
    await expect(within(dialog).getAllByRole("button", { name: "Add from marketplace" }).length).toBeGreaterThan(0);
  },
};

export const RemoteReadOnly: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.research ?? []} skillsMode="readonly" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await expect(await body.findByText("Skills for this agent are managed on the host.")).toBeVisible();
    await expect(body.queryByRole("button", { name: "Add from marketplace" })).toBeNull();
    await expect(body.queryByRole("switch")).toBeNull();
  },
};

export const RemoveConfirm: Story = {
  render: () => (
    <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} onAddFromMarketplace={addFromMarketplace} />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "More for Inbox triage" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Uninstall" }));
    await expect(await body.findByRole("dialog", { name: "Remove this skill?" })).toBeVisible();
  },
};
