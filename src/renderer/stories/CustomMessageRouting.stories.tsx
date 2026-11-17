import {
  type CustomMessageRoutingSettings,
  DEFAULT_AGENT_DEFAULTS,
  type SetCustomMessageRoutingInput,
} from "@openbot/contracts/ipc";
import { SettingsAgentsTab, type SettingsAgentsTabProps } from "@openbot/ui/features/settings/SettingsAgentsTab";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import type { JSX } from "@solidjs/web";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";
import { SettingsPageStory } from "./settings-page-story";

const meta = {
  title: "Settings/Custom Message Routing",
  component: SettingsAgentsTab,
  args: {
    agents: STORY_AGENT_SUMMARIES.slice(0, 3),
    loadFailed: false,
    defaults: DEFAULT_AGENT_DEFAULTS,
    steer: true,
    setting: "busyMessageMode",
    menuMount: undefined,
    onOpen: fn(),
    onDefaultChange: fn(),
    onPlanStartChange: fn(),
    onAutomationLimitChange: fn(),
    onCommitCoAuthorChange: fn(),
    onChoiceChange: fn(),
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The local custom host supports Thread in Server Settings > Agents and each agent's Advanced panel. Both controls use the same host preference. Stock and remote clients keep Queue and Steer. These stories use local fixture state and make no Jev request.",
      },
    },
  },
  render: (args) => <RoutingStoryFrame>{() => <SettingsAgentsTab {...args} />}</RoutingStoryFrame>,
} satisfies Meta<typeof SettingsAgentsTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The stock and remote-client page has no custom routing props. */
export const QueueAndSteerBefore: Story = {};

function RoutingStoryFrame(props: { children: () => JSX.Element }) {
  return (
    <SettingsPageStory title="Agents">
      {(page) => (
        <SettingsDialogShell
          open
          title="Agents"
          description="Messages while working"
          sidebar={<span>Agents</span>}
          contentKey="agents"
          page={page()}
        >
          {props.children()}
        </SettingsDialogShell>
      )}
    </SettingsPageStory>
  );
}

function CustomThreadFixture(props: SettingsAgentsTabProps) {
  const [routing, setRouting] = createStore<CustomMessageRoutingSettings>({
    available: true,
    defaultMode: "thread",
    agents: {},
  });
  const change = (input: SetCustomMessageRoutingInput) =>
    setRouting((draft) => {
      if (input.agentIds) for (const id of input.agentIds) draft.agents[id] = input.mode;
      else if (input.mode !== null) draft.defaultMode = input.mode;
    });
  return (
    <RoutingStoryFrame>
      {() => (
        <SettingsAgentsTab {...props} customMessageRouting={{ settings: routing, saving: false, onChange: change }} />
      )}
    </RoutingStoryFrame>
  );
}

/** Opt-in local host controls, with a working default and per-agent choices. */
export const ThreadAfter: Story = { render: (args) => <CustomThreadFixture {...args} /> };
