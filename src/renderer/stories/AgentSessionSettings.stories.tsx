import type { AgentSessionSettings as Settings } from "@openbot/contracts/ipc";
import { AgentSessionSettings } from "@openbot/ui/features/conversation/AgentSessionSettings";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const snapshot: Settings = {
  agentId: "example",
  providerIdentity: "acp:example",
  pending: true,
  options: [
    { id: "citations", name: "Citations", type: "boolean", currentValue: true },
    {
      id: "style",
      name: "Response style",
      type: "select",
      currentValue: "brief",
      options: [
        { value: "brief", name: "Brief", group: "Length" },
        { value: "detailed", name: "Detailed", group: "Length" },
      ],
    },
  ],
  overrides: { citations: false, style: "removed-choice", oldSetting: true },
};
const meta = {
  title: "Settings/Provider Session",
  component: AgentSessionSettings,
  args: {
    agentId: "example",
    providerIdentity: "acp:example",
    api: {
      read: async () => structuredClone(snapshot),
      set: async (input) => ({ ...snapshot, overrides: { ...snapshot.overrides, [input.settingId]: input.value } }),
      reset: async (input) => ({
        ...snapshot,
        overrides: Object.fromEntries(Object.entries(snapshot.overrides).filter(([key]) => key !== input.settingId)),
      }),
    },
  },
} satisfies Meta<typeof AgentSessionSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SavedAndUnavailable: Story = {};
