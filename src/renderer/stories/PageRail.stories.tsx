import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { HelpMenu } from "@openbot/ui/features/updates/HelpMenu";
import {
  type CustomAgentUsageRailRow,
  PageRail,
  type PageRailPage,
  type PageRailPinnablePage,
  type PageRailProps,
} from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const nowSeconds = Math.floor(Date.now() / 1_000);

const usageRows = accountUsageProviderRows({
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: nowSeconds + 2 * 3_600 },
      secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: nowSeconds + 4 * 86_400 },
    },
    {
      id: "cursor",
      primary: { usedPercent: 37, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
      secondary: { usedPercent: 82, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
    },
  ],
});

/** A merged Cursor plan counts the Grok plan quota: one Grok ring, and its card lists Cursor too. */
const sharedQuotaRows = accountUsageProviderRows({
  limits: [
    {
      id: "grok",
      primary: null,
      secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: nowSeconds + 3 * 86_400 },
    },
    {
      id: "cursor",
      primary: { usedPercent: 64, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
      secondary: null,
      sharedQuotaWith: "grok",
    },
  ],
});

/** An example answer. Each agent writes its own text, which the card shows as it is. */
const customAgentUsage: CustomAgentUsageRailRow[] = [
  { id: "devin", name: "Devin", text: "Plan: Team\nACUs used this cycle: 42 of 250\nThe cycle resets in 12 days." },
];

/** The page rail as the desktop window shows it. Hover a button, or move to it with Tab, to see its tooltip. */
function RailPreview(props: {
  updateReady?: boolean;
  logo?: PageRailProps["logo"];
  customAgentUsage?: readonly CustomAgentUsageRailRow[];
  usageRows?: PageRailProps["usageRows"];
}) {
  const { t } = useText();
  const [current, setCurrent] = createSignal<PageRailPage | null>("agents");
  const [pinned, setPinned] = createSignal<readonly PageRailPinnablePage[]>(["usage"]);
  return (
    // The extra box keeps the rail out of the rule that hides it in a narrow window.
    <div class="app-window" style={{ height: "100vh" }}>
      <div style={{ display: "flex" }}>
        <PageRail
          hidden={false}
          current={current()}
          pinned={pinned()}
          onPinChange={(page, pin) =>
            setPinned((pages) => (pin ? [...pages, page] : pages.filter((other) => other !== page)))
          }
          usageRows={props.usageRows ?? usageRows}
          customAgentUsage={props.customAgentUsage}
          onAgents={() => setCurrent("agents")}
          onRoutines={() => setCurrent("routines")}
          onSchedule={() => setCurrent("schedule")}
          onUsage={() => setCurrent("usage")}
          onMarketplace={fn()}
          onSettings={() => setCurrent("settings")}
          settingsNotice={props.updateReady ? t("account.update.ready") : undefined}
          logo={props.logo}
          help={
            <HelpMenu
              news={[]}
              triggerClass="window-rail-button"
              onOpenWhatsNew={fn()}
              onOpenChangelog={fn()}
              onOpenGuides={fn()}
              onOpenDiscord={fn()}
              onSendFeedback={fn()}
            />
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Window/PageRail",
  component: RailPreview,
} satisfies Meta<typeof RailPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The Settings tooltip also says what the dot stands for. */
export const SettingsNotice: Story = {
  args: { updateReady: true },
};

/** A custom agent with a usage command: its logo with no ring. Hover it to see the answer. */
export const CustomAgentUsage: Story = {
  args: { customAgentUsage },
};

/** Grok and a merged Cursor plan share one quota, so the rail shows the Grok ring alone. */
export const SharedQuota: Story = {
  args: { usageRows: sharedQuotaRows },
};

/** The web client: no macOS window buttons, so the logo in the top row links to the OpenBot site. */
export const WebLogo: Story = {
  args: { logo: { variant: "production", href: "/" } },
};

/** Windows and Linux: the logo is in the top row, with no link. */
export const DesktopLogo: Story = {
  args: { logo: { variant: "production" } },
};
