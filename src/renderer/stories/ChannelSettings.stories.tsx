import { onCleanup } from "solid-js";
import { expect, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  SettingsField,
  SettingsLinkGroup,
  SettingsLinkRow,
  SettingsPanel,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "../src/components/SettingsPanel";
import {
  Badge,
  Button,
  buttonVariants,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Plus,
  Textarea,
  X,
} from "../src/components/ui";
import { ChannelMemberRow } from "../src/features/channels/ChannelMemberRow";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

/*
 * The channel panel and the agent panel open in the same slot, so this file draws them together:
 * a mismatch in header height, divider, field rhythm or link row is only visible side by side.
 *
 * The channel body is written out here rather than mounted from `ChannelEditor`, because that
 * component reads the channels context, which needs the account, server and agent contexts and a
 * channel-aware `window.openbot` behind it. What is under test here is the shared panel, and the
 * body below uses the same components the editor does.
 */

const members = STORY_AGENTS.slice(0, 4);

function ChannelPanelBody() {
  return (
    <SettingsPanelContent>
      <div class="channel-editor">
        <SettingsField label="Name">
          <Input aria-label="Channel name" value="Project Falcon" onValueChange={fn()} />
        </SettingsField>
        <SettingsField label="Title">
          <Input aria-label="Channel title" placeholder="Describe what this channel does" onValueChange={fn()} />
        </SettingsField>
        <SettingsField label="Instructions">
          <Textarea
            rows="4"
            aria-label="Channel instructions"
            placeholder="What will this channel work on?"
            onValueChange={fn()}
          />
        </SettingsField>
        <SettingsLinkGroup>
          <SettingsLinkRow label="Memories" value="0 saved" onClick={fn()} />
          <SettingsLinkRow label="Routines" value="0 configured" onClick={fn()} />
        </SettingsLinkGroup>
        <section class="channel-members" aria-label="Members">
          <h3 class="channel-members-title">Members</h3>
          <ItemGroup class="channel-member-list">
            {members.map((agent) => (
              <ChannelMemberRow
                agent={agent}
                fallbackName={agent.name}
                actions={
                  <ItemActions>
                    <Button size="xs" variant="destructive" class="channel-member-remove">
                      Remove
                    </Button>
                  </ItemActions>
                }
              />
            ))}
            <button type="button" class={buttonVariants({ variant: "ghost", class: "channel-member-add" })}>
              <Plus aria-hidden="true" />
              Add member
            </button>
          </ItemGroup>
        </section>
      </div>
    </SettingsPanelContent>
  );
}

function ChannelTasksBody() {
  return (
    <SettingsPanelContent>
      <section class="channel-tasks" aria-label="Channel tasks">
        <ItemGroup class="channel-task-list">
          <Item class="channel-task" role="article" aria-label="Task: Prepare the report">
            <ItemContent>
              <ItemTitle>Chief</ItemTitle>
              <ItemDescription>Prepare the report on last quarter and send it to the team.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge tone="accent" size="sm">
                running
              </Badge>
              <Button size="sm" variant="ghost">
                Stop
              </Button>
            </ItemActions>
          </Item>
          <Item class="channel-task" role="article" aria-label="Task: Check the numbers">
            <ItemContent>
              <ItemTitle>Sales Outbound</ItemTitle>
              <ItemDescription>Check the numbers.</ItemDescription>
              <ItemDescription>Depends on Chief · running</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge tone="warning" size="sm">
                waiting
              </Badge>
            </ItemActions>
          </Item>
        </ItemGroup>
      </section>
    </SettingsPanelContent>
  );
}

function ChannelPanelStory(props: { title: string; body: () => ReturnType<typeof ChannelPanelBody> }) {
  return (
    <main class="conversation-panel agent-memories-story-stage" style="--settings-panel-width: 296px">
      <SettingsPanel id="channel-side-panel" label="Channel panel" width={296} maxWidth={640} onResize={fn()}>
        <SettingsPanelHeader title={props.title} onClose={fn()} closeLabel="Close channel panel" closeIcon={<X />} />
        {props.body()}
      </SettingsPanel>
    </main>
  );
}

/** The agent panel beside it, so the two headers and the two field stacks can be compared. */
function AgentPanelStory() {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({});
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <main class="conversation-panel agent-memories-story-stage" style="--settings-panel-width: 296px">
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
        onUpdateAgent={async () => {}}
        onUpdateRuntimeSettings={async () => true}
        onSetAgentAvatar={async () => {}}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Channel Settings",
  component: SettingsPanel,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof SettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChannelSettings: Story = {
  render: () => <ChannelPanelStory title="Channel settings" body={() => <ChannelPanelBody />} />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { level: 2, name: "Channel settings" })).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: /^Memories\s*0 saved$/ })).toBeInTheDocument();
  },
};

export const ChannelSettingsWithoutMembers: Story = {
  render: () => (
    <ChannelPanelStory
      title="Channel settings"
      body={() => (
        <SettingsPanelContent>
          <div class="channel-editor">
            <SettingsField label="Name">
              <Input aria-label="Channel name" value="Project Falcon" onValueChange={fn()} />
            </SettingsField>
            <section class="channel-members" aria-label="Members">
              <h3 class="channel-members-title">Members</h3>
              <ItemGroup class="channel-member-list">
                <button type="button" class={buttonVariants({ variant: "ghost", class: "channel-member-add" })}>
                  <Plus aria-hidden="true" />
                  Add member
                </button>
              </ItemGroup>
              <p class="channel-members-note">A channel needs one member before it can route work.</p>
            </section>
          </div>
        </SettingsPanelContent>
      )}
    />
  ),
};

export const ChannelTasks: Story = {
  render: () => <ChannelPanelStory title="Tasks" body={() => <ChannelTasksBody />} />,
};

/** The panel this one has to match. Compare the header, the divider and the field rhythm. */
export const AgentSettingsForComparison: Story = {
  render: () => <AgentPanelStory />,
};
