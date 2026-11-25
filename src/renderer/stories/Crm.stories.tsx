import type { AgentProfile } from "@openbot/ui/data";
import { createSignal, onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CrmScreen } from "../src/features/crm/CrmScreen";
import { desktopCrmHost } from "../src/features/crm/crm-port";
import { PlatformProvider } from "../src/platform";
import type { MockCrmSeed } from "../src/preview/mock-crm";
import { crmDemoSeed } from "./crm-fixtures";
import { requireFixture, STORY_AGENTS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const CRM_AGENTS: AgentProfile[] = ["chief", "research", "sales"].map((id) =>
  requireFixture(
    STORY_AGENTS.find((agent) => agent.id === id),
    id,
  ),
);

function CrmStory(props: { seed: MockCrmSeed; connectors?: boolean }) {
  const [connectors, setConnectors] = createSignal(props.connectors === true);
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ crm: props.seed });
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <PlatformProvider>
      <div style={{ height: "100vh" }}>
        <CrmScreen
          serverId="local"
          host={desktopCrmHost("local")}
          agents={CRM_AGENTS}
          connectors={{ requested: connectors, taken: () => setConnectors(false) }}
        />
      </div>
    </PlatformProvider>
  );
}

const meta = {
  title: "CRM/CRM page",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <CrmStory seed={crmDemoSeed()} /> };
export const Empty: Story = { render: () => <CrmStory seed={{ agentIds: ["chief"] }} /> };
export const ConnectedToStripe: Story = {
  render: () => <CrmStory seed={crmDemoSeed(Date.now(), { stripe: true })} />,
};
export const Connectors: Story = {
  render: () => <CrmStory seed={crmDemoSeed(Date.now(), { stripe: true })} connectors />,
};
