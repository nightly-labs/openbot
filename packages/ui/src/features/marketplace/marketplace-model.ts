import type {
  ClientAgentSummary,
  GithubSkillSource,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  McpAccessChange,
  McpServerAccess,
  McpServerConfig,
  SkillCategory,
} from "@openbot/contracts/ipc";
import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import type { JSX } from "@solidjs/web";
import type { ConnectorDetail } from "../connectors/ConnectorDetailPanel";
import type { ConnectorId } from "../connectors/connectors";
import type {
  MarketplacePluginApp,
  MarketplacePluginDetail,
  MarketplacePluginPrompt,
} from "../settings/marketplace-plugins";
import type { CatalogList, MarketplaceHomeCache } from "./marketplace-listing";

export type MarketplaceAgent = Pick<
  ClientAgentSummary,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl"
>;

export type MarketplaceSkillRef = Pick<MarketplaceSkillSummary, "id" | "name">;

export interface MarketplaceSkillChange {
  add: readonly string[];
  remove: readonly string[];
}

export type AgentListingState = "add" | "added" | "update";

export type SkillRead = "idle" | "loading" | "loaded" | "failed";

export type GithubSkillRead = { status: "found"; source: GithubSkillSource } | { status: "failed"; message: string };

export type MarketplaceAppStatus = "connected" | "attention" | "connecting" | "idle";

export type MarketplaceAppsBlock = { reason: "checking" } | { reason: "update" | "member"; host: string };

interface AppBase {
  id: string;
  name: string;
  tagline: string;
  status: MarketplaceAppStatus;
}

export interface MarketplaceAppAccount {
  id: string;
  name: string;
  signInNeeded: boolean;
  signedIn: boolean;
  renamable: boolean;
}

export interface MarketplaceAppConnection {
  held: boolean;
  signInNeeded: boolean;
  accounts: readonly MarketplaceAppAccount[];
  multipleAccounts: boolean;
  keySaved?: boolean;
}

export type MarketplaceApp =
  | (AppBase & {
      kind: "plugin";
      category: SkillCategory;
      plugin: MarketplacePluginDetail;
      connections: Readonly<Record<string, MarketplaceAppConnection>>;
    })
  | (AppBase & { kind: "connector"; connector: ConnectorId; category: SkillCategory })
  | (AppBase & { kind: "custom"; server: McpServerConfig });

export type AppSetup = "channel" | "vault" | "account" | "key" | "desktop" | "open" | "custom";

const CONNECTOR_SETUP = {
  slack: "channel",
  discord: "channel",
  telegram: "channel",
  whatsapp: "channel",
  onepassword: "vault",
  bitwarden: "vault",
  protonpass: "vault",
  github: "account",
} as const satisfies Record<ConnectorId, AppSetup>;

const FLOW_SETUP = {
  link: "account",
  key: "key",
  local: "desktop",
} as const satisfies Record<McpConnectFlow["kind"], AppSetup>;

export function pluginAppSetup(app: MarketplacePluginApp): AppSetup {
  const flow = app.server.auth?.[0];
  return flow ? FLOW_SETUP[flow.kind] : "open";
}

export function pluginNeedsMac(
  model: Pick<MarketplaceModel, "macAppsUnavailable">,
  plugin: { apps: readonly MarketplacePluginApp[] },
): boolean {
  return model.macAppsUnavailable === true && plugin.apps.some((app) => (app.macAutomation?.length ?? 0) > 0);
}

export function customServerStatus(
  app: Extract<MarketplaceApp, { kind: "custom" }>,
): "mcp.status.enabled" | "mcp.status.disabled" {
  return app.server.enabled ? "mcp.status.enabled" : "mcp.status.disabled";
}

export function appSetup(app: MarketplaceApp): AppSetup {
  switch (app.kind) {
    case "connector":
      return CONNECTOR_SETUP[app.connector];
    case "plugin": {
      const [first] = app.plugin.apps;
      return first ? pluginAppSetup(first) : "open";
    }
    case "custom":
      return "custom";
  }
}

export interface MarketplaceConnector {
  readonly detail: ConnectorDetail;
  ready: () => boolean;
  readonly connect?: (() => void) | undefined;
}

export interface MarketplaceMacAutomation {
  askOnInstall: () => boolean;
  setAskOnInstall: (ask: boolean) => void;
  request: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => Promise<void>;
}

export interface MarketplaceMcpAccess {
  entry: (mcpServerId: string) => McpServerAccess;
  roles: () => readonly { id: string; name: string }[];
  busy: () => boolean;
  set: (changes: readonly McpAccessChange[]) => Promise<boolean>;
}

export interface MarketplaceServerSlots {
  form: (props: { id: string | null; onClose: (saved: McpServerConfig | null) => void }) => JSX.Element;
  controls: (props: { id: string }) => JSX.Element;
}

export interface MarketplaceModel {
  listAgents: CatalogList<MarketplaceAgentSummary>;
  agentHomeCache?: MarketplaceHomeCache<MarketplaceAgentSummary> | undefined;
  loadAgent: (id: string) => Promise<MarketplaceAgentDetail | undefined>;
  agentState: (listing: MarketplaceAgentSummary) => AgentListingState | null;
  agentBusy: (listingId: string) => boolean;
  addAgent: (listing: MarketplaceAgentDetail | MarketplaceAgentSummary, update?: boolean) => Promise<boolean>;
  openChat: (listingId: string) => void;

  listSkills: CatalogList<MarketplaceSkillSummary>;
  skillHomeCache?: MarketplaceHomeCache<MarketplaceSkillSummary> | undefined;
  loadSkill: (id: string) => Promise<MarketplaceSkillDetail | undefined>;
  skillListing: (id: string) => Promise<MarketplaceSkillSummary | undefined>;
  agents: () => readonly MarketplaceAgent[];
  activeAgentId: () => string;
  readSkills: () => void;
  skillRead: (agentId: string) => SkillRead;
  installedSkill: (agentId: string, skillId: string) => InstalledSkill | undefined;
  installedSkills?: ((agentId: string) => readonly InstalledSkill[]) | undefined;
  skillBusy: (skillId: string) => boolean;
  changeSkill: (skill: MarketplaceSkillRef, change: MarketplaceSkillChange) => Promise<void>;
  setSkillEnabled: (agentId: string, skillId: string, on: boolean) => Promise<void>;
  updateSkill: (skill: MarketplaceSkillRef, agentIds: readonly string[]) => Promise<void>;
  readGithubSkills?: ((link: string) => Promise<GithubSkillRead>) | undefined;
  createSkill?: ((agentId: string) => void) | undefined;
  trySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;

  apps: () => readonly MarketplaceApp[];
  canConnectApps: () => boolean;
  appsBlocked?: (() => MarketplaceAppsBlock | undefined) | undefined;
  appBusy: (id: string) => boolean;
  connectApp: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => Promise<boolean>;
  reconnectApp: (
    app: Extract<MarketplaceApp, { kind: "plugin" }>,
    appId: string,
    accountId?: string | undefined,
  ) => Promise<boolean>;
  addAccount: (app: Extract<MarketplaceApp, { kind: "plugin" }>, appId: string) => Promise<boolean>;
  renameAccount: (
    app: Extract<MarketplaceApp, { kind: "plugin" }>,
    accountId: string,
    name: string,
  ) => Promise<boolean>;
  removeAccount: (app: Extract<MarketplaceApp, { kind: "plugin" }>, accountId: string) => Promise<boolean>;
  appHostName?: string | undefined;
  macAutomation?: MarketplaceMacAutomation | undefined;
  macAppsUnavailable?: boolean | undefined;
  disconnectApp: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => void;
  removeServer: (id: string) => Promise<boolean>;
  mcpAccess?: MarketplaceMcpAccess | undefined;
  servers?: MarketplaceServerSlots | undefined;
  runPrompt?: ((prompt: MarketplacePluginPrompt) => void) | undefined;
  copyLink: (slug: string) => void;
  copyListingLink: (link: MarketplaceListingLink) => void;
  openUrl: (url: string) => void;
  connector: (id: ConnectorId) => MarketplaceConnector | undefined;

  error: () => string | null;
  errorReference?: (() => string | null) | undefined;
  clearError: () => void;
  notice: () => string;
}
