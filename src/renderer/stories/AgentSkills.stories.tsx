import type { InstalledSkill } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { expect, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_INSTALLED_SKILLS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

function AgentSkillsStory(props: {
  skills: InstalledSkill[];
  localState?: "empty" | "error" | "loading" | "update";
  detailState?: "long" | "error" | "loading" | "reduced-motion";
  skillsMode?: "mutable" | "readonly" | "hidden";
  onAddFromMarketplace?: (agentId: string) => void;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ installedSkills: { chief: props.skills } });
  if (props.localState === "empty") mock.api.skills.localList = async () => [];
  if (props.localState === "error")
    mock.api.skills.localList = async () => {
      throw new Error("Unavailable");
    };
  if (props.localState === "loading") mock.api.skills.localList = async () => new Promise(() => undefined);
  if (props.localState === "update")
    void mock.api.skills.localRevise({
      agentId: "chief",
      skillId: "local-skill-11111111-1111-4111-8111-111111111111",
      expectedRevision: 1,
      sourcePath: "draft",
    });
  const getDetail = mock.api.skills.get;
  mock.api.skills.get = async (id) => {
    if (props.detailState === "error") throw new Error("Could not load skill details.");
    if (props.detailState === "loading") return new Promise(() => undefined);
    const detail = await getDetail(id);
    return props.detailState === "long"
      ? {
          ...detail,
          name: "Release notes for a large project with many teams and services",
          examplePrompt:
            "Review the latest commits, group them by service, explain the impact on users, and include the steps needed for an upgrade. ".repeat(
              5,
            ),
          instructions:
            "## What this skill does\n\nSummarize changes and explain their impact.\n\n## How it works\n\n" +
            "- Read the commits and check the linked issues.\n".repeat(20),
        }
      : detail;
  };
  const matchMedia = window.matchMedia;
  if (props.detailState === "reduced-motion")
    window.matchMedia = (query) =>
      matchMedia.call(window, query === "(prefers-reduced-motion: reduce)" ? "all" : query);
  window.openbot = mock.api;

  onCleanup(() => {
    window.matchMedia = matchMedia;
    mock.dispose();
    window.openbot = previousApi;
  });

  return (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel
        onCreateSkill={fn()}
        onTrySkill={fn()}
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
    await expect(await within(dialog).findByText(/Sorts a morning inbox/)).toBeVisible();
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

export const AuthorExample: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: /^Release notes/ }));
    await expect(await body.findByText(/Turn the latest commits/)).toBeVisible();
    await expect(await body.findByRole("button", { name: "Try skill" })).toBeEnabled();
  },
};

export const DisabledDetail: Story = {
  render: () => (
    <AgentSkillsStory skills={(STORY_INSTALLED_SKILLS.chief ?? []).map((skill) => ({ ...skill, enabled: false }))} />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: /^Release notes/ }));
    await expect(await body.findByRole("button", { name: "Try skill" })).toBeEnabled();
  },
};

export const LongDetail: Story = {
  ...OpenDetail,
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} detailState="long" />,
};
export const ReducedMotion: Story = {
  ...OpenDetail,
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} detailState="reduced-motion" />,
  play: async (context) => {
    await OpenDetail.play?.(context);
    await expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    await expect(document.querySelector(".skill-preview-gradient canvas")).toBeNull();
  },
};
export const DetailError: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} detailState="error" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: /^Release notes/ }));
    await expect(await body.findByRole("alert")).toHaveTextContent("Could not load skill details.");
  },
};
export const DetailLoading: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} detailState="loading" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: /^Release notes/ }));
    await expect(await body.findByText("Loading details…")).toBeVisible();
  },
};

export const LocalLibrary: Story = {
  render: () => <AgentSkillsStory skills={STORY_INSTALLED_SKILLS.chief ?? []} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Local" }));
    await expect(await body.findByRole("button", { name: /Weekly summary/ })).toBeVisible();
  },
};
export const LocalLibraryDetail: Story = {
  ...LocalLibrary,
  play: async (context) => {
    await LocalLibrary.play?.(context);
    const body = within(document.body);
    await context.userEvent.click(await body.findByRole("button", { name: /Weekly summary/ }));
    await expect(await body.findByRole("button", { name: "Add skill" })).toBeEnabled();
  },
};
export const LocalLibraryEmpty: Story = {
  render: () => <AgentSkillsStory skills={[]} localState="empty" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Local" }));
    await expect(await body.findByText("No local skills yet.")).toBeVisible();
  },
};
export const LocalLibraryError: Story = {
  ...LocalLibraryEmpty,
  render: () => <AgentSkillsStory skills={[]} localState="error" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Local" }));
    await expect(await body.findByRole("button", { name: "Retry" })).toBeVisible();
  },
};
export const LocalLibraryLoading: Story = {
  ...LocalLibraryEmpty,
  render: () => <AgentSkillsStory skills={[]} localState="loading" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Local" }));
    await expect(await body.findByRole("status")).toHaveTextContent("Loading local skills");
  },
};

export const LocalLibraryUpdate: Story = {
  render: () => (
    <AgentSkillsStory
      localState="update"
      skills={[
        {
          skillId: "local-skill-11111111-1111-4111-8111-111111111111",
          slug: "weekly-summary",
          name: "Weekly summary",
          installedVersion: 1,
          availableVersion: 2,
          enabled: false,
          origin: "local",
          state: "update-available",
        },
      ]}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Skills/ }));
    const body = within(document.body);
    await expect(await body.findByRole("button", { name: "Update Weekly summary" })).toBeEnabled();
  },
};
