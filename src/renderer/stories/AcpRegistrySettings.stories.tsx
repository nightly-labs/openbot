import { AcpRegistrySettings } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/ACP Registry",
  component: AcpRegistrySettings,
  args: {
    api: {
      search: async () => [
        {
          id: "example",
          name: "Example agent",
          version: "2.0.0",
          description: "A native ACP agent.",
          website: null,
          license: "MIT",
          distributions: ["binary"],
          installedVersion: "1.0.0",
          customAgentId: "example",
        },
        {
          id: "python-example",
          name: "Python example",
          version: "1.0.0",
          description: "Requires uvx on the selected host.",
          website: null,
          license: "MIT",
          distributions: ["uvx"],
          installedVersion: null,
          customAgentId: null,
        },
      ],
      status: async () => [],
      install: async () => ({ agents: [], restart: "not-running" }),
      cancel: async () => undefined,
      remove: async () => undefined,
    },
  },
} satisfies Meta<typeof AcpRegistrySettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SearchAndUpdate: Story = {};
