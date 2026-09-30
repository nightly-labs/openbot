import type { AgentSummary } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Blocks,
  Button,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  HardDrive,
  Hash,
  Heading,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Label,
  Monitor,
  Plug,
  Plus,
  Settings,
  SettingsSection,
  Spinner,
  Tabs,
  Text,
  TriangleAlert,
  UsersRound,
  X,
} from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import {
  GitHubMark,
  type IntegrationStatus,
  LogoTile,
  DetailHeader as SharedDetailHeader,
  StatusPill as SharedStatusPill,
  Stepper,
  WizardContent,
  type WizardProps,
} from "@openbot/ui/features/settings/IntegrationLayout";
import { PluginIcon } from "@openbot/ui/features/settings/MarketplacePluginDetail";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { STORY_AGENT_SUMMARIES, STORY_MARKETPLACE_PLUGINS } from "./fixtures";

// Concept only. The copy is literal on purpose: a direction is chosen first, and the real
// components then get catalog keys. Brand marks stay here until they move to @openbot/brand.

/* ---------------------------------------------------------------- brand marks */

export type Brand = "github" | "slack" | "discord";

const BRAND_PATHS: Record<Exclude<Brand, "github">, string> = {
  slack:
    "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
  discord:
    "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z",
};

function BrandMark(props: { brand: Brand; class?: string }) {
  if (props.brand === "github") return <GitHubMark class={props.class} />;
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-brand={props.brand}>
      <path d={BRAND_PATHS[props.brand]} />
    </svg>
  );
}

/* ---------------------------------------------------------------- status */

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: "Connected",
  attention: "Needs attention",
  idle: "Not set up",
  unavailable: "Unavailable",
};

/** The shared pill, with the concept's default labels. */
function StatusPill(props: { status: IntegrationStatus; label?: string }) {
  return <SharedStatusPill status={props.status} label={props.label ?? STATUS_LABEL[props.status]} />;
}

type BotStatus = "live" | "setup" | "offline" | "none";

const BOT_STATUS: Record<BotStatus, { label: string; status: IntegrationStatus }> = {
  live: { label: "Live", status: "connected" },
  setup: { label: "Setting up", status: "idle" },
  offline: { label: "Offline", status: "attention" },
  none: { label: "Not added", status: "unavailable" },
};

/* ---------------------------------------------------------------- data */

const CONCEPT_EXTRA_AGENTS: Pick<AgentSummary, "id" | "name" | "title" | "avatarSeed" | "avatarHue">[] = [
  { id: "support", name: "Support triage", title: "Support desk", avatarSeed: "support", avatarHue: 150 },
  { id: "release", name: "Release notes", title: "Release writer", avatarSeed: "release", avatarHue: 30 },
];

export type ConceptAgent = Pick<AgentSummary, "id" | "name" | "title" | "avatarSeed" | "avatarHue"> & {
  avatarUrl: null;
};

export const CONCEPT_AGENTS: ConceptAgent[] = [
  ...STORY_AGENT_SUMMARIES.map((agent) => ({
    id: agent.id,
    name: agent.name,
    title: agent.title,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: null,
  })),
  ...CONCEPT_EXTRA_AGENTS.map((agent) => ({ ...agent, avatarUrl: null })),
];

function conceptAgent(index: number): ConceptAgent {
  const agent = CONCEPT_AGENTS[index];
  if (!agent) throw new Error(`Concept agent ${index} is missing.`);
  return agent;
}

export interface BotRow {
  agent: ConceptAgent;
  handle: string;
  status: BotStatus;
  channels: string[];
  replies: "Mentions only" | "All messages" | "Direct messages";
  note?: string;
}

export const SLACK_ROWS: BotRow[] = [
  {
    agent: conceptAgent(0),
    handle: "@chief",
    status: "live",
    channels: ["leadership", "launch"],
    replies: "Mentions only",
  },
  {
    agent: conceptAgent(1),
    handle: "@research",
    status: "live",
    channels: ["research", "competitors", "reading-list"],
    replies: "All messages",
  },
  {
    agent: conceptAgent(3),
    handle: "@support-triage",
    status: "offline",
    channels: ["support"],
    replies: "All messages",
    note: "Slack revoked the token 2 hours ago.",
  },
  {
    agent: conceptAgent(2),
    handle: "@sales-outbound",
    status: "setup",
    channels: [],
    replies: "Direct messages",
    note: "Waiting for install in Slack.",
  },
  { agent: conceptAgent(4), handle: "", status: "none", channels: [], replies: "Mentions only" },
];

export const DISCORD_ROWS: BotRow[] = [
  {
    agent: conceptAgent(3),
    handle: "Support triage#4821",
    status: "live",
    channels: ["help", "bug-reports"],
    replies: "All messages",
  },
  {
    agent: conceptAgent(4),
    handle: "Release notes#1177",
    status: "live",
    channels: ["announcements"],
    replies: "Mentions only",
  },
  { agent: conceptAgent(0), handle: "", status: "none", channels: [], replies: "Mentions only" },
  { agent: conceptAgent(1), handle: "", status: "none", channels: [], replies: "Mentions only" },
];

/* ---------------------------------------------------------------- frame */

// The real ServerSettingsModal sections, with "Integrations" in place of "Connectors" and "MCP".
const NAV = [
  { value: "general", label: "General", icon: Settings },
  { value: "members", label: "Members", icon: UsersRound },
  { value: "desktop", label: "Remote desktop", icon: Monitor },
  { value: "integrations", label: "Integrations", icon: Plug },
  { value: "storage", label: "Storage", icon: HardDrive },
  { value: "import", label: "Import", icon: Download },
] as const;

/** Same breadcrumb markup as the MCP form title in `ServerSettingsModal.tsx`. */
export function ServerSettingsFrame(props: {
  title: string;
  parent?: string;
  description: string;
  children: JSX.Element;
}) {
  const [tab, setTab] = createSignal("integrations");
  return (
    <Tabs.Root value={tab()} onChange={setTab} orientation="vertical" class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="server-settings-modal-shell"
        open
        onOpenChange={() => undefined}
        title={
          <Show when={props.parent} fallback={props.title}>
            {(parent) => (
              <span class="settings-modal-crumbs">
                <Button type="button" variant="ghost" class="settings-modal-crumb-parent">
                  {parent()}
                </Button>
                <ChevronRight class="settings-modal-crumb-separator" aria-hidden="true" />
                <span class="settings-modal-crumb-current">{props.title}</span>
              </span>
            )}
          </Show>
        }
        description={props.description}
        contentKey={tab()}
        closeLabel="Close server settings"
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label="Server settings sections">
            <For each={NAV}>
              {(item) => {
                const NavIcon = item.icon;
                return (
                  <Tabs.Trigger class="settings-modal-nav-item" value={item.value}>
                    <NavIcon aria-hidden="true" />
                    <span>{item.label}</span>
                  </Tabs.Trigger>
                );
              }}
            </For>
          </Tabs.List>
        }
      >
        <For each={NAV}>
          {(item) => (
            <Tabs.Content
              value={item.value}
              class="settings-modal-tab-panel server-settings-panel"
              data-tab={item.value}
            >
              <Show
                when={item.value === "integrations"}
                fallback={
                  <Text tone="muted" variant="caption">
                    Not part of this concept.
                  </Text>
                }
              >
                {props.children}
              </Show>
            </Tabs.Content>
          )}
        </For>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}

/* ---------------------------------------------------------------- hub */

// One quiet row per integration, like the other server settings pages. A row with a problem
// sorts first and says what is wrong; there is no separate banner.

function marketplaceCards(): { name: string; tagline: string; iconUrl: string | null }[] {
  return STORY_MARKETPLACE_PLUGINS.slice(0, 4).map((plugin) => ({
    name: plugin.name,
    tagline: plugin.tagline,
    iconUrl: plugin.iconUrl,
  }));
}

function FaceStack(props: { agents: ConceptAgent[]; max?: number }) {
  const max = () => props.max ?? 4;
  const extra = () => props.agents.length - max();
  return (
    <span class="ic-face-stack" role="img" aria-label={`Used by ${props.agents.map((agent) => agent.name).join(", ")}`}>
      <For each={props.agents.slice(0, max())}>{(agent) => <AgentFace agent={agent} size="sm" />}</For>
      <Show when={extra() > 0}>
        <span class="ic-face-more" aria-hidden="true">{`+${extra()}`}</span>
      </Show>
    </span>
  );
}

export interface HubRow {
  id: string;
  name: string;
  logo: JSX.Element;
  status: IntegrationStatus;
  summary: string;
  agents?: ConceptAgent[];
  /** Shown in place of the agent faces, for example "All agents". */
  scope?: string;
  /** A button in place of the chevron, when the row needs a step first. Unavailable rows show neither
   * and do not open. */
  action?: string;
  onAction?: () => void;
}

export const HUB_ROWS: HubRow[] = [
  {
    id: "slack",
    name: "Slack",
    logo: <BrandMark brand="slack" />,
    status: "attention",
    summary: "Support triage is offline. Slack revoked its token 2 hours ago.",
    agents: [conceptAgent(0), conceptAgent(1), conceptAgent(3), conceptAgent(2)],
    action: "Fix",
  },
  {
    id: "github",
    name: "GitHub",
    logo: <BrandMark brand="github" />,
    status: "connected",
    summary: "@octocat · 6 repositories",
    // One sign-in serves every agent on this computer.
    scope: "All agents",
  },
  {
    id: "mcp",
    name: "MCP servers",
    logo: <Blocks />,
    status: "connected",
    summary: "filesystem, browser, linear, sentry · 38 tools",
    scope: "All agents",
  },
  {
    id: "discord",
    name: "Discord",
    logo: <BrandMark brand="discord" />,
    status: "idle",
    summary: "Give each agent its own Discord bot user.",
    action: "Set up",
  },
];

function HubRowItem(props: { row: HubRow }) {
  return (
    <Item class="settings-modal-row ic-hub-row" data-status={props.row.status}>
      <Show when={props.row.status !== "unavailable"}>
        <Button type="button" variant="ghost" class="ic-hub-row-hitarea" aria-label={`Open ${props.row.name}`} />
      </Show>
      <ItemMedia>
        <LogoTile>{props.row.logo}</LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle class="ic-hub-title">
          {props.row.name}
          <Show when={props.row.status !== "idle"}>
            <StatusPill status={props.row.status} />
          </Show>
        </ItemTitle>
        <ItemDescription class="ic-hub-summary" data-status={props.row.status}>
          {props.row.summary}
        </ItemDescription>
      </ItemContent>
      <ItemActions class="ic-hub-actions">
        <Show when={props.row.agents}>{(agents) => <FaceStack agents={agents()} />}</Show>
        <Show when={props.row.scope}>
          {(scope) => (
            <Text variant="caption" tone="muted">
              {scope()}
            </Text>
          )}
        </Show>
        <Show when={props.row.status !== "unavailable"}>
          <Show when={props.row.action} fallback={<ChevronRight class="ic-hub-row-chevron" aria-hidden="true" />}>
            {(action) => (
              <Button
                type="button"
                size="sm"
                variant={props.row.status === "idle" ? "default" : "outline"}
                onClick={() => props.row.onAction?.()}
              >
                {action()}
              </Button>
            )}
          </Show>
        </Show>
      </ItemActions>
    </Item>
  );
}

/** Brand marks on one moving dashed line. Same grid and glow as the landing hero. */
const HERO_NODES = [
  { id: "github", logo: <BrandMark brand="github" /> },
  { id: "slack", logo: <BrandMark brand="slack" /> },
  { id: "discord", logo: <BrandMark brand="discord" /> },
  { id: "mcp", logo: <Blocks /> },
] as const;

function FirstRunHero(props: { onDismiss: () => void }) {
  return (
    <div class="ic-hero-frame">
      <div class="ic-hero">
        <span class="ic-hero-grid" aria-hidden="true" />
        <div class="ic-hero-copy">
          <Heading as="h3" size="md">
            Bring your agents to your team's apps
          </Heading>
          <Text variant="body-sm" tone="secondary">
            Chats and files stay on this computer.
          </Text>
        </div>
        <div class="ic-hero-art" aria-hidden="true">
          <span class="ic-hero-link" />
          <For each={HERO_NODES}>{(node) => <span class="ic-hero-node">{node.logo}</span>}</For>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="ic-hero-close"
        aria-label="Dismiss"
        onClick={props.onDismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

export function IntegrationsHub(props: { rows: HubRow[]; firstRun?: boolean }) {
  const active = () => props.rows.filter((row) => row.status !== "idle");
  const idle = () => props.rows.filter((row) => row.status === "idle");
  const [heroOpen, setHeroOpen] = createSignal(true);
  return (
    <div class="ic-hub">
      <Show when={props.firstRun && heroOpen()}>
        <FirstRunHero onDismiss={() => setHeroOpen(false)} />
      </Show>
      <Show when={active().length > 0}>
        <SettingsSection title="On this server">
          <ItemGroup class="settings-modal-card">
            <For each={active()}>{(row) => <HubRowItem row={row} />}</For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <Show when={idle().length > 0}>
        <SettingsSection title={active().length > 0 ? "Not set up" : "Available"}>
          <ItemGroup class="settings-modal-card">
            <For each={idle()}>{(row) => <HubRowItem row={row} />}</For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <SettingsSection
        title="From the Marketplace"
        actions={
          <Button type="button" size="sm" variant="ghost">
            Browse all
          </Button>
        }
      >
        <div class="ic-hub-strip">
          <For each={marketplaceCards()}>
            {(plugin) => (
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="ic-hub-chip"
                aria-label={`Install ${plugin.name}`}
              >
                <PluginIcon iconUrl={plugin.iconUrl} class="ic-hub-chip-icon" />
                {plugin.name}
                <Plus class="ic-hub-chip-plus" aria-hidden="true" />
              </Button>
            )}
          </For>
        </div>
      </SettingsSection>
    </div>
  );
}

/* ---------------------------------------------------------------- detail layout */

/** The shared header, with the concept's default status labels. */
function DetailHeader(props: Omit<Parameters<typeof SharedDetailHeader>[0], "statusLabel"> & { statusLabel?: string }) {
  return <SharedDetailHeader {...props} statusLabel={props.statusLabel ?? STATUS_LABEL[props.status]} />;
}

function AgentFace(props: { agent: ConceptAgent; size?: "sm" | "md" }) {
  return (
    <span class="ic-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar agent={props.agent} motion="idle" />
    </span>
  );
}

/* ---------------------------------------------------------------- wizard */

/** A dialog body shown inline, so every step of a flow can sit side by side on one canvas. */
function WizardPanel(props: WizardProps & { caption: string }) {
  return (
    <figure class="ic-wizard-figure">
      <figcaption>
        <Text variant="caption" tone="muted">
          {props.caption}
        </Text>
      </figcaption>
      <section class="integration-wizard" aria-label={`${props.caption}: ${props.title}`}>
        <WizardContent
          {...props}
          heading={
            <Heading as="h4" size="md">
              {props.title}
            </Heading>
          }
        />
      </section>
    </figure>
  );
}

/* ---------------------------------------------------------------- per-agent bots */

function AgentBotTable(props: { platform: "Slack" | "Discord"; rows: BotRow[] }) {
  return (
    <div class="ic-table-wrap">
      <table class="ic-table">
        <caption class="ic-visually-hidden">{`${props.platform} identity for each agent`}</caption>
        <thead>
          <tr>
            <th scope="col">{`Agent in ${props.platform}`}</th>
            <th scope="col">Status</th>
            <th scope="col">Listens in</th>
            <th scope="col">
              <span class="ic-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr data-status={row.status}>
                <th scope="row">
                  <span class="ic-agent-cell">
                    <AgentFace agent={row.agent} size="sm" />
                    <span class="ic-cell-stack">
                      <Text as="span" variant="label-sm">
                        {row.agent.name}
                      </Text>
                      <Text as="span" variant="caption" tone="muted">
                        {row.handle || `Not in ${props.platform}`}
                      </Text>
                    </span>
                  </span>
                </th>
                <td>
                  <div class="ic-status-cell">
                    <StatusPill status={BOT_STATUS[row.status].status} label={BOT_STATUS[row.status].label} />
                    <Show when={row.note}>
                      {(note) => (
                        <Text as="span" variant="caption" tone="muted">
                          {note()}
                        </Text>
                      )}
                    </Show>
                  </div>
                </td>
                <td>
                  <span class="ic-cell-stack">
                    <Show
                      when={row.channels.length > 0}
                      fallback={
                        <Text as="span" variant="caption" tone="muted">
                          —
                        </Text>
                      }
                    >
                      <span class="ic-channels">
                        <For each={row.channels.slice(0, 2)}>
                          {(channel) => <Badge variant="secondary">{`#${channel}`}</Badge>}
                        </For>
                        <Show when={row.channels.length > 2}>
                          <Text as="span" variant="caption" tone="muted">
                            {`+${row.channels.length - 2}`}
                          </Text>
                        </Show>
                      </span>
                    </Show>
                    <Show when={row.status !== "none"}>
                      <Text as="span" variant="caption" tone="muted">
                        {row.replies}
                      </Text>
                    </Show>
                  </span>
                </td>
                <td class="ic-table-action">
                  <BotRowAction platform={props.platform} row={row} />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function BotRowAction(props: { platform: string; row: BotRow }) {
  const label = () => {
    switch (props.row.status) {
      case "live":
        return "Edit";
      case "setup":
        return "Continue";
      case "offline":
        return "Reconnect";
      case "none":
        return `Add to ${props.platform}`;
    }
  };
  return (
    <Button
      type="button"
      size="xs"
      variant={props.row.status === "none" || props.row.status === "offline" ? "outline" : "ghost"}
      aria-label={`${label()}: ${props.row.agent.name}`}
    >
      {label()}
    </Button>
  );
}

export function BotPlatformPage(props: {
  brand: Brand;
  name: "Slack" | "Discord";
  status: IntegrationStatus;
  subtitle: string;
  workspace: { label: string; value: string; detail: string };
  rows: BotRow[];
  attention?: string;
}) {
  const live = () => props.rows.filter((row) => row.status === "live").length;
  return (
    <div class="ic-detail">
      <DetailHeader
        logo={<BrandMark brand={props.brand} />}
        name={props.name}
        status={props.status}
        subtitle={props.subtitle}
        actions={
          <Button type="button" size="sm">
            {`Add agent to ${props.name}`}
          </Button>
        }
      />
      <Show when={props.attention}>
        {(attention) => (
          <Alert tone="warning" role="alert">
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>One agent is offline</AlertTitle>
              <AlertDescription>{attention()}</AlertDescription>
            </AlertContent>
            <AlertActions>
              <Button type="button" size="sm" variant="outline">
                Reconnect
              </Button>
            </AlertActions>
          </Alert>
        )}
      </Show>
      <SettingsSection title={props.workspace.label}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemMedia>
              <LogoTile>
                <BrandMark brand={props.brand} />
              </LogoTile>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{props.workspace.value}</ItemTitle>
              <ItemDescription>{props.workspace.detail}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="ghost">
                Change
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <SettingsSection
        title="Agents"
        description={`${live()} of ${props.rows.length} agents are live. Each agent has its own name, picture and token in ${props.name}.`}
      >
        <AgentBotTable platform={props.name} rows={props.rows} />
      </SettingsSection>
    </div>
  );
}

/* ---------------------------------------------------------------- Slack preview + wizard */

function SlackMessagePreview(props: { agent: ConceptAgent; text: string }) {
  return (
    <figure class="ic-slack-preview" aria-label={`How ${props.agent.name} looks in Slack`}>
      <div class="ic-slack-channel">
        <Hash size={14} aria-hidden="true" />
        <Text as="span" variant="label-sm">
          launch
        </Text>
      </div>
      <div class="ic-slack-message">
        <span class="ic-slack-avatar">
          <AgentAvatar agent={props.agent} motion="idle" />
        </span>
        <div class="ic-slack-body">
          <div class="ic-slack-meta">
            <Text as="span" variant="label">
              {props.agent.name}
            </Text>
            <span class="ic-slack-app">APP</span>
            <Text as="span" variant="caption" tone="muted">
              10:42
            </Text>
          </div>
          <Text variant="body-sm">{props.text}</Text>
        </div>
      </div>
    </figure>
  );
}

const SLACK_STEPS = ["Agent", "Preview", "Create app", "Install", "Channels"] as const;

export type SlackStep = 0 | 1 | 2 | 3 | 4;

export function SlackAddAgentPanel(props: { step: SlackStep; caption: string }) {
  const [picked, setPicked] = createSignal("release");
  const agent = () => CONCEPT_AGENTS.find((candidate) => candidate.id === picked()) ?? conceptAgent(0);
  const [reply, setReply] = createSignal<BotRow["replies"]>("Mentions only");
  const copy = (): { title: string; description: string } => {
    switch (props.step) {
      case 0:
        return { title: "Which agent joins Slack?", description: "Each agent becomes its own Slack app." };
      case 1:
        return {
          title: `This is ${agent().name} in Slack`,
          description: "Slack uses the agent's name and picture. Change them in agent settings.",
        };
      case 2:
        return {
          title: "Create the Slack app",
          description: "OpenBot fills in the app settings. You only confirm in Slack.",
        };
      case 3:
        return {
          title: "Install it in your workspace",
          description: "Slack asks you to allow the app. OpenBot waits here.",
        };
      case 4:
        return { title: "Where does it listen?", description: "You can change channels later." };
    }
  };
  return (
    <WizardPanel
      caption={props.caption}
      logo={<BrandMark brand="slack" />}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={SLACK_STEPS} current={props.step} label="Add agent to Slack" />}
      footer={
        <>
          <Show when={props.step > 0}>
            <Button type="button" size="sm" variant="ghost">
              Back
            </Button>
          </Show>
          <Show when={props.step === 2}>
            <Button type="button" size="sm">
              <ExternalLink size={14} aria-hidden="true" />
              Create in Slack
            </Button>
          </Show>
          <Show when={props.step === 3}>
            <Button type="button" size="sm">
              <ExternalLink size={14} aria-hidden="true" />
              Open Slack
            </Button>
          </Show>
          <Show when={props.step !== 2 && props.step !== 3}>
            <Button type="button" size="sm">
              {props.step === 4 ? `Add ${agent().name}` : "Continue"}
            </Button>
          </Show>
        </>
      }
    >
      <Show when={props.step === 0}>
        <fieldset class="ic-agent-picker">
          <legend class="ic-visually-hidden">Agents</legend>
          <For each={CONCEPT_AGENTS}>
            {(candidate) => {
              const inUse = () => SLACK_ROWS.some((row) => row.agent.id === candidate.id && row.status !== "none");
              return (
                <button
                  type="button"
                  class="ic-agent-option"
                  aria-pressed={picked() === candidate.id ? "true" : "false"}
                  disabled={inUse()}
                  onClick={() => setPicked(candidate.id)}
                >
                  <AgentFace agent={candidate} />
                  <Text as="span" variant="label-sm">
                    {candidate.name}
                  </Text>
                  <Text as="span" variant="caption" tone="muted">
                    {inUse() ? "Already in Slack" : candidate.title}
                  </Text>
                </button>
              );
            }}
          </For>
        </fieldset>
      </Show>
      <Show when={props.step === 1}>
        <SlackMessagePreview agent={agent()} text="Release notes for 4.2 are ready. The draft is in the thread." />
      </Show>
      <Show when={props.step === 2}>
        <ol class="ic-checklist">
          <li data-state="done">
            <Check size={14} aria-hidden="true" />
            App name, picture and description from {agent().name}
          </li>
          <li data-state="done">
            <Check size={14} aria-hidden="true" />
            Permissions: read mentions, post messages, read channels it joins
          </li>
          <li>
            <span class="ic-check-dot" aria-hidden="true" />
            Confirm “Create” in Slack
          </li>
        </ol>
      </Show>
      <Show when={props.step === 3}>
        <div class="ic-waiting-line" aria-live="polite">
          <Spinner size="sm" />
          <Text variant="caption" tone="muted">
            Waiting for Slack to confirm the install in Acme Inc.
          </Text>
        </div>
      </Show>
      <Show when={props.step === 4}>
        <div class="ic-form">
          <Text variant="label-sm">Channels</Text>
          <div class="ic-channels">
            <Badge variant="secondary">#launch</Badge>
            <Badge variant="secondary">#releases</Badge>
            <Button type="button" size="xs" variant="ghost">
              Add channel
            </Button>
          </div>
          <fieldset class="ic-fieldset">
            <legend class="ic-legend">Replies to</legend>
            <div class="ic-segment">
              <For each={["Mentions only", "All messages", "Direct messages"] as const}>
                {(option) => (
                  <button
                    type="button"
                    class="ic-segment-option"
                    aria-pressed={reply() === option ? "true" : "false"}
                    onClick={() => setReply(option)}
                  >
                    {option}
                  </button>
                )}
              </For>
            </div>
          </fieldset>
        </div>
      </Show>
    </WizardPanel>
  );
}

/* ---------------------------------------------------------------- Discord wizard */

const DISCORD_STEPS = ["Application", "Token", "Invite", "Channels"] as const;

export function DiscordAddAgentPanel(props: { step: 0 | 1 | 2 | 3; caption: string }) {
  const copy = (): { title: string; description: string } => {
    switch (props.step) {
      case 0:
        return {
          title: "Create a Discord application",
          description: "Discord has no one-click setup. Make one application for Chief in the Developer Portal.",
        };
      case 1:
        return {
          title: "Paste the bot token",
          description: "Bot → Reset Token in the Developer Portal. OpenBot keeps it on this computer.",
        };
      case 2:
        return { title: "Invite Chief to your server", description: "Discord asks which server and what it can do." };
      case 3:
        return { title: "Where does Chief listen?", description: "Pick channels in Acme Community." };
    }
  };
  return (
    <WizardPanel
      caption={props.caption}
      logo={<BrandMark brand="discord" />}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={DISCORD_STEPS} current={props.step} label="Add agent to Discord" />}
      footer={
        <>
          <Show when={props.step > 0}>
            <Button type="button" size="sm" variant="ghost">
              Back
            </Button>
          </Show>
          <Show when={props.step === 0}>
            <Button type="button" size="sm">
              <ExternalLink size={14} aria-hidden="true" />
              Open Developer Portal
            </Button>
          </Show>
          <Show when={props.step === 1}>
            <Button type="button" size="sm">
              Check token
            </Button>
          </Show>
          <Show when={props.step === 2}>
            <Button type="button" size="sm">
              <ExternalLink size={14} aria-hidden="true" />
              Open invite
            </Button>
          </Show>
          <Show when={props.step === 3}>
            <Button type="button" size="sm">
              Add Chief
            </Button>
          </Show>
        </>
      }
    >
      <Show when={props.step === 0}>
        <ol class="ic-checklist">
          <li>
            <span class="ic-check-dot" aria-hidden="true" />
            New Application → name it “Chief”
          </li>
          <li>
            <span class="ic-check-dot" aria-hidden="true" />
            Bot → turn on Message Content Intent
          </li>
          <li>
            <span class="ic-check-dot" aria-hidden="true" />
            Come back here with the token
          </li>
        </ol>
      </Show>
      <Show when={props.step === 1}>
        <div class="ic-form">
          <Label for="ic-discord-token">Bot token</Label>
          <Input
            id="ic-discord-token"
            type="password"
            size="sm"
            value="MTA5ODc2NTQzMjEwOTg3NjU0.Gh7x"
            autocomplete="off"
          />
          <Text variant="caption" tone="success">
            <Check size={14} aria-hidden="true" /> Token works: Chief#0412
          </Text>
        </div>
      </Show>
      <Show when={props.step === 2}>
        <div class="ic-waiting-line" aria-live="polite">
          <Spinner size="sm" />
          <Text variant="caption" tone="muted">
            Waiting for Chief to join a server
          </Text>
        </div>
      </Show>
      <Show when={props.step === 3}>
        <div class="ic-channels">
          <Badge variant="secondary">#general</Badge>
          <Badge variant="secondary">#roadmap</Badge>
          <Button type="button" size="xs" variant="ghost">
            Add channel
          </Button>
        </div>
      </Show>
    </WizardPanel>
  );
}

/* ---------------------------------------------------------------- agent side */

export function AgentConnectedApps(props: { agent: ConceptAgent }) {
  return (
    <div class="ic-agent-settings">
      <div class="ic-agent-settings-head">
        <AgentFace agent={props.agent} />
        <div>
          <Heading as="h3" size="md">
            {props.agent.name}
          </Heading>
          <Text variant="caption" tone="muted">
            {props.agent.title}
          </Text>
        </div>
      </div>
      <SettingsSection
        title="Connected apps"
        description="What this agent can reach outside OpenBot."
        actions={
          <Button type="button" size="sm" variant="ghost">
            Open Integrations
          </Button>
        }
      >
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemMedia>
              <LogoTile>
                <BrandMark brand="github" />
              </LogoTile>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>GitHub</ItemTitle>
              <ItemDescription>@octocat · the same GitHub connection as every agent on this computer</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="ghost">
                Open
              </Button>
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemMedia>
              <LogoTile>
                <BrandMark brand="slack" />
              </LogoTile>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                Slack <StatusPill status="connected" label="Live" />
              </ItemTitle>
              <ItemDescription>@research in Acme Inc. · #research, #competitors · all messages</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="ghost">
                Edit
              </Button>
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemMedia>
              <LogoTile>
                <BrandMark brand="discord" />
              </LogoTile>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Discord</ItemTitle>
              <ItemDescription>Not added. Give this agent its own Discord bot user.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="outline">
                Add to Discord
              </Button>
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemMedia>
              <LogoTile>
                <Blocks />
              </LogoTile>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>MCP servers</ItemTitle>
              <ItemDescription>3 of 4 servers on · Linear, Figma, Sentry</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="ghost">
                Choose
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
    </div>
  );
}
