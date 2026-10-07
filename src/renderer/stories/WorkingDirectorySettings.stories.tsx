import { WorkingDirectorySettings } from "@openbot/ui/features/conversation/WorkingDirectorySettings";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/Working Directory",
  component: WorkingDirectorySettings,
  args: {
    agentId: "chief",
    hostName: "Development computer",
    working: false,
    calls: {
      getWorkingDirectory: async () => ({
        workingDirectory: "/Projects/example",
        effectivePath: "/Projects/example",
        busy: false,
      }),
      setWorkingDirectory: async ({ path }) => ({
        workingDirectory: path,
        effectivePath: path ?? "/OpenBot/Agents/chief",
        busy: false,
      }),
      browseWorkingDirectory: async ({ path }) => ({
        path: path ?? "/Projects/example",
        parentPath: "/Projects",
        roots: [{ name: "Projects", path: "/Projects" }],
        entries: [{ name: "source", path: "/Projects/example/source" }],
        nextOffset: null,
      }),
    },
  },
} satisfies Meta<typeof WorkingDirectorySettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Working: Story = { args: { working: true } };
