import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { ServerMenu } from "@openbot/ui/features/servers/ServerMenu";
import { HelpMenu } from "@openbot/ui/features/updates/HelpMenu";
import {
  type CustomAgentUsageRailRow,
  type MediaCreditsRailRow,
  PageRail,
  type PageRailPage,
  type PageRailPinnablePage,
  type PageRailProps,
} from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_SERVERS } from "./fixtures";

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
      tertiary: { usedPercent: 60, windowDurationMins: 43_200, resetsAt: nowSeconds + 18 * 86_400 },
    },
  ],
});

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

const account = (id: string, label: string) =>
  ({ id, label, email: `${label.toLowerCase()}@example.com`, state: "connected", message: null }) as const;
const window5h = (usedPercent: number) => ({ usedPercent, windowDurationMins: 300, resetsAt: nowSeconds + 7_200 });
const windowWeek = (usedPercent: number) => ({
  usedPercent,
  windowDurationMins: 10_080,
  resetsAt: nowSeconds + 4 * 86_400,
});

const manyAccountRows = accountUsageProviderRows(
  {
    limits: [
      { id: "codex", primary: window5h(28), secondary: windowWeek(41) },
      { id: "codex", accountId: "a1a2b3c4d5e6f7081", primary: window5h(74), secondary: windowWeek(58) },
      { id: "codex", accountId: "a2a2b3c4d5e6f7082", primary: window5h(6), secondary: windowWeek(12) },
      { id: "claude", primary: window5h(91), secondary: windowWeek(64) },
      { id: "claude", accountId: "a3a2b3c4d5e6f7083", primary: window5h(35), secondary: windowWeek(20) },
      { id: "claude", accountId: "a4a2b3c4d5e6f7084", primary: window5h(52), secondary: windowWeek(97) },
      { id: "grok", primary: null, secondary: windowWeek(22) },
      { id: "cursor", primary: windowWeek(37), secondary: windowWeek(82) },
      { id: "antigravity", primary: window5h(15), secondary: windowWeek(30) },
      { id: "kimi", primary: window5h(44), secondary: windowWeek(18) },
    ],
  },
  [
    {
      id: "codex",
      state: "available",
      accounts: [
        account("default", "Personal"),
        account("a1a2b3c4d5e6f7081", "Work"),
        account("a2a2b3c4d5e6f7082", "Client"),
      ],
    },
    {
      id: "claude",
      state: "available",
      accounts: [
        account("default", "Personal"),
        account("a3a2b3c4d5e6f7083", "Team"),
        account("a4a2b3c4d5e6f7084", "Client"),
      ],
    },
  ],
);

const customAgentUsage: CustomAgentUsageRailRow[] = [
  { id: "devin", name: "Devin", text: "Plan: Team\nACUs used this cycle: 42 of 250\nThe cycle resets in 12 days." },
];

const teamCredits: MediaCreditsRailRow[] = [
  { key: "sunra", provider: "sunra", name: "Sunra", available: 120, quota: 500 },
];

const personalCredits: MediaCreditsRailRow[] = [
  { key: "sunra", provider: "sunra", name: "Sunra", available: 2140, quota: null },
];

const bothCredits: MediaCreditsRailRow[] = [
  ...teamCredits,
  { key: "higgsfield", provider: "higgsfield", name: "Higgsfield", available: 860, quota: null, number: 1 },
];

const twoAccountCredits: MediaCreditsRailRow[] = [
  { key: "higgsfield:first", provider: "higgsfield", name: "Higgsfield", available: 860, quota: null, number: 1 },
  { key: "higgsfield:second", provider: "higgsfield", name: "Higgsfield 2", available: 95, quota: null, number: 2 },
];

const lowCredits: MediaCreditsRailRow[] = [
  { key: "sunra", provider: "sunra", name: "Sunra", available: 140, quota: 2000 },
  { key: "higgsfield", provider: "higgsfield", name: "Higgsfield", available: 0, quota: null },
];

function RailPreview(props: {
  updateReady?: boolean;
  logo?: PageRailProps["logo"];
  customAgentUsage?: readonly CustomAgentUsageRailRow[];
  usageRows?: PageRailProps["usageRows"];
  mediaCredits?: readonly MediaCreditsRailRow[];
  crm?: boolean;
}) {
  const { t } = useText();
  const [current, setCurrent] = createSignal<PageRailPage | null>("agents");
  const [pinned, setPinned] = createSignal<readonly PageRailPinnablePage[]>(props.crm ? ["usage", "crm"] : ["usage"]);
  function crmAction(): (() => void) | undefined {
    if (!props.crm) return undefined;
    return () => setCurrent("crm");
  }
  function crmConnectorsAction(): (() => void) | undefined {
    if (!props.crm) return undefined;
    return () => setCurrent("crm");
  }
  return (
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
          mediaCredits={props.mediaCredits}
          onMediaCredits={fn()}
          onAgents={() => setCurrent("agents")}
          onSchedule={() => setCurrent("schedule")}
          onUsage={() => setCurrent("usage")}
          onCrm={crmAction()}
          onCrmConnectors={crmConnectorsAction()}
          onMarketplace={fn()}
          onSettings={() => setCurrent("settings")}
          settingsNotice={props.updateReady ? t("account.update.ready") : undefined}
          logo={props.logo}
          server={
            <ServerMenu
              rail
              serverName={STORY_SERVERS.find((server) => server.active)?.name ?? ""}
              servers={STORY_SERVERS}
              view="menu"
              onViewChange={fn()}
              onSelect={fn()}
              onAdd={fn()}
              onSetMuted={fn()}
              onOpenNotificationSettings={fn()}
              onOpenSettings={fn()}
            />
          }
          help={
            <HelpMenu
              news={[]}
              triggerClass="window-rail-button"
              onOpenWhatsNew={fn()}
              onOpenChangelog={fn()}
              onOpenGuides={fn()}
              onOpenDiscord={fn()}
              onReportProblem={fn()}
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

export const SettingsNotice: Story = {
  args: { updateReady: true },
};

export const CustomAgentUsage: Story = {
  args: { customAgentUsage },
};

export const SharedQuota: Story = {
  args: { usageRows: sharedQuotaRows },
};

export const ManyAccounts: Story = {
  args: { usageRows: manyAccountRows },
};

export const WebLogo: Story = {
  args: { logo: { variant: "production", href: "/" } },
};

export const DesktopLogo: Story = {
  args: { logo: { variant: "production" } },
};

export const MediaCreditsQuota: Story = {
  args: { mediaCredits: teamCredits },
};

export const MediaCreditsPersonal: Story = {
  args: { mediaCredits: personalCredits },
};

export const MediaCreditsTwoServices: Story = {
  args: { mediaCredits: bothCredits },
};

export const MediaCreditsTwoAccounts: Story = {
  args: { mediaCredits: twoAccountCredits },
};

export const MediaCreditsLow: Story = {
  args: { mediaCredits: lowCredits },
};

export const CrmMenu: Story = {
  args: { crm: true },
};
