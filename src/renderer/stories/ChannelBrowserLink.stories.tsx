import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PrototypeApp } from "./prototype-support";

const meta = { title: "Conversation/ChannelBrowserLink", component: PrototypeApp } satisfies Meta<typeof PrototypeApp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Link: Story = {
  render: () => (
    <PrototypeApp
      options={{
        languagePreference: { language: "en" },
        browserTabs: [
          {
            id: "agent-tab",
            title: "Agent private page",
            url: "https://example.com/agent",
            loading: false,
            ownerThreadId: "thread-chief",
            ownerAgentId: "chief",
          },
        ],
        channels: [
          {
            channel: {
              id: "browser-test-channel",
              name: "Browser test",
              title: "Browser test",
              instructions: "",
              members: [{ agentId: "chief" }],
              leadAgentId: "chief",
              archived: false,
              revision: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            messages: [
              {
                id: "browser-test-message",
                channelId: "browser-test-channel",
                sequence: 1,
                author: { kind: "agent", id: "chief", name: "Chief" },
                taskId: null,
                superseded: false,
                message: {
                  id: "browser-test-message",
                  author: "assistant",
                  itemType: "final_answer",
                  text: "[OpenBot documentation](https://openbot.run/docs)",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  status: "completed",
                },
              },
            ],
          },
        ],
      }}
      setup={(mock) => {
        void mock.api.setExternalLinkPreference({ target: { kind: "openbot" } });
      }}
    />
  ),
};
