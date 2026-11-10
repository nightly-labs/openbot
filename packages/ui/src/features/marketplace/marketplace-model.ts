import type {
  ClientAgentSummary,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  McpServerConfig,
  SkillCategory,
} from "@openbot/contracts/ipc";
import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import type { ConnectorDetail } from "../connectors/ConnectorDetailPanel";
import type { ConnectorId } from "../connectors/connectors";
import type {
  MarketplacePluginApp,
  MarketplacePluginDetail,
  MarketplacePluginPrompt,
} from "../settings/marketplace-plugins";
import type { CatalogList, MarketplaceHomeCache } from "./marketplace-listing";

/** An agent of the user's that a skill can go to. */
export type MarketplaceAgent = Pick<
  ClientAgentSummary,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl"
>;

/** A skill that can go to more agents: a catalog listing, or a skill made on this computer. */
export type MarketplaceSkillRef = Pick<MarketplaceSkillSummary, "id" | "name">;

/** One save of the agents dialog. Each list holds agent ids. */
export interface MarketplaceSkillChange {
  add: readonly string[];
  remove: readonly string[];
}

/** What an agent listing offers the user. */
export type AgentListingState = "add" | "added" | "update";

/** How far the read of one agent's installed skills got. An empty list is an answer only when `loaded`. */
export type SkillRead = "idle" | "loading" | "loaded" | "failed";

/** `connecting`: a sign-in started and waits, such as for a GitHub device code. */
export type MarketplaceAppStatus = "connected" | "attention" | "connecting" | "idle";

/**
 * Why this account cannot connect catalog apps on the joined server. `checking`: the app has not read
 * what the host serves yet; Connect is available when it has. `update`: the host is too old for apps.
 * `member`: only an owner or admin connects apps on that host.
 */
export type MarketplaceAppsBlock = { reason: "checking" } | { reason: "update" | "member"; host: string };

interface AppBase {
  id: string;
  name: string;
  /** The line under the name on the card. */
  tagline: string;
  status: MarketplaceAppStatus;
}

/** One account of a catalog app: one row that the host holds for it. */
export interface MarketplaceAppAccount {
  /** The id of the MCP row. */
  id: string;
  /** The row name: the account's label, and its `@` tag in a message. */
  name: string;
  /** The server refused the stored sign-in of this account. */
  signInNeeded: boolean;
  /** The host holds a sign-in for this account. True when the host did not say. */
  signedIn: boolean;
  /**
   * The row has its own account address, so a new name keeps it with the app. A row from before
   * accounts is found by its catalog name, and its sign-in by its plain address.
   */
  renamable: boolean;
}

/** What the host holds for one app of a catalog plugin. */
export interface MarketplaceAppConnection {
  /** The host holds a row for the app. */
  held: boolean;
  /** The server refused the stored sign-in of a row, so the user must sign in again. */
  signInNeeded: boolean;
  /** The rows of the app, the first one first. Empty when the host holds none. */
  accounts: readonly MarketplaceAppAccount[];
  /**
   * The user can add another account: the app signs in with a browser, and the host keeps a
   * separate sign-in for each account (`mcp-accounts-v1`).
   */
  multipleAccounts: boolean;
  /**
   * The first row holds the key that a key flow of the listing names. A listing with a sign-in and
   * a key then shows the key, not the sign-in. Absent is false.
   */
  keySaved?: boolean;
}

/**
 * One row of the Apps tab: a catalog app, a connector that the server can run, or an MCP server
 * that the host holds and no catalog app claims. A connector's `id` is its `ConnectorId`. A
 * plugin's `connections` are keyed by the id of each app in the listing.
 */
export type MarketplaceApp =
  | (AppBase & {
      kind: "plugin";
      category: SkillCategory;
      plugin: MarketplacePluginDetail;
      connections: Readonly<Record<string, MarketplaceAppConnection>>;
    })
  | (AppBase & { kind: "connector"; connector: ConnectorId; category: SkillCategory })
  | (AppBase & { kind: "custom"; server: McpServerConfig });

/**
 * How an app connects. The category says which page parts an app reuses: a channel shows its
 * workspaces and agents, a vault its items, an account a browser sign-in, a key a saved credential,
 * desktop an address on this computer, open nothing to sign in to, and custom the server's command
 * or address.
 */
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

/** The category of one app of a plugin, by the first way in that its listing gives. */
export function pluginAppSetup(app: MarketplacePluginApp): AppSetup {
  const flow = app.server.auth?.[0];
  return flow ? FLOW_SETUP[flow.kind] : "open";
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

/** A connector that the server on screen can run: its page, and its one-click connect. */
export interface MarketplaceConnector {
  readonly detail: ConnectorDetail;
  /** False until the first read, while the page has nothing to show. */
  ready: () => boolean;
  /** Absent when the page must ask for input first. */
  readonly connect?: (() => void) | undefined;
}

/** Asks macOS on this computer for Automation access to the Apple apps that a plugin drives. */
export interface MarketplaceMacAutomation {
  /** Whether an install asks right after the app is saved. */
  askOnInstall: () => boolean;
  setAskOnInstall: (ask: boolean) => void;
  /** macOS shows one prompt for each app it has no answer for. The result is a notice or an error. */
  request: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => Promise<void>;
}

/**
 * What the Marketplace view reads and asks for. The renderer builds it from its IPC calls, and a
 * story builds it from fixtures. Each action reports its own failure through `error`.
 */
export interface MarketplaceModel {
  listAgents: CatalogList<MarketplaceAgentSummary>;
  agentHomeCache?: MarketplaceHomeCache<MarketplaceAgentSummary> | undefined;
  loadAgent: (id: string) => Promise<MarketplaceAgentDetail | undefined>;
  /** Null when this user cannot add agents. */
  agentState: (listing: MarketplaceAgentSummary) => AgentListingState | null;
  agentBusy: (listingId: string) => boolean;
  /** Adds the agent, or updates the one the user has when `update` is set. The Marketplace stays open. */
  addAgent: (listing: MarketplaceAgentDetail | MarketplaceAgentSummary, update?: boolean) => Promise<boolean>;
  /** Opens the conversation of the agent that the listing added, and closes the Marketplace. */
  openChat: (listingId: string) => void;

  listSkills: CatalogList<MarketplaceSkillSummary>;
  skillHomeCache?: MarketplaceHomeCache<MarketplaceSkillSummary> | undefined;
  loadSkill: (id: string) => Promise<MarketplaceSkillDetail | undefined>;
  /**
   * The listing of a skill that the user has and no loaded page holds, for its source and its sort.
   * No view event and no error: without it, the row stays as it is.
   */
  skillListing: (id: string) => Promise<MarketplaceSkillSummary | undefined>;
  /** The agents a skill can go to. Empty when this user cannot install skills. */
  agents: () => readonly MarketplaceAgent[];
  /** The agent whose conversation is open. */
  activeAgentId: () => string;
  /** Reads the installed skills of each agent that has no fresh answer. */
  readSkills: () => void;
  skillRead: (agentId: string) => SkillRead;
  /** Undefined also while a remove waits for its Undo toast. */
  installedSkill: (agentId: string, skillId: string) => InstalledSkill | undefined;
  /**
   * The installed skills of one agent, also those made on this computer, without a remove that
   * waits for its Undo. Empty until `skillRead` is loaded. Absent: "Your skills" lists only the
   * loaded catalog skills that an agent has.
   */
  installedSkills?: ((agentId: string) => readonly InstalledSkill[]) | undefined;
  skillBusy: (skillId: string) => boolean;
  /**
   * Adds the skill to some agents and removes it from others as one change, with one notice and one
   * Undo. A remove waits until the Undo toast closes, so Undo never reinstalls and never loses a
   * changed copy. A changed copy asks for a confirmation before its remove. Agents that refuse, such
   * as an agent at its skill limit, are named in one partial error.
   */
  changeSkill: (skill: MarketplaceSkillRef, change: MarketplaceSkillChange) => Promise<void>;
  /** Turns the skill on or off for one agent. */
  setSkillEnabled: (agentId: string, skillId: string, on: boolean) => Promise<void>;
  /** Installs the newest version on each agent that has an older one. A changed copy asks first. */
  updateSkill: (skill: MarketplaceSkillRef, agentIds: readonly string[]) => Promise<void>;
  /** Absent while no composer can take the request. Starts a chat that makes a new skill. */
  createSkill?: ((agentId: string) => void) | undefined;
  /** Absent while no composer can take the example. */
  trySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;

  apps: () => readonly MarketplaceApp[];
  /** False for a member of a joined server, who browses and connects no catalog app. */
  canConnectApps: () => boolean;
  /** Why `canConnectApps` is false. Absent when it is true, or when no reason is known. */
  appsBlocked?: (() => MarketplaceAppsBlock | undefined) | undefined;
  appBusy: (id: string) => boolean;
  /** Runs the connect step of a catalog app. False when the user closed it. */
  connectApp: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => Promise<boolean>;
  /**
   * Runs the connect step of one app that the host holds, and saves the answer over the held row:
   * a new key, a new sign-in, or a desktop app that is on again. False when the user closed it.
   */
  reconnectApp: (
    app: Extract<MarketplaceApp, { kind: "plugin" }>,
    appId: string,
    accountId?: string | undefined,
  ) => Promise<boolean>;
  /** Signs in to one more account of a held app, as a new row. False when the user closed the step. */
  addAccount: (app: Extract<MarketplaceApp, { kind: "plugin" }>, appId: string) => Promise<boolean>;
  /** Gives an account another name. The name is also its `@` tag in a message. */
  renameAccount: (
    app: Extract<MarketplaceApp, { kind: "plugin" }>,
    accountId: string,
    name: string,
  ) => Promise<boolean>;
  /** Removes one account of an app that has more than one, with its sign-in. */
  removeAccount: (app: Extract<MarketplaceApp, { kind: "plugin" }>, accountId: string) => Promise<boolean>;
  /** The joined server that keeps an app's credential. Absent when this computer keeps it. */
  appHostName?: string | undefined;
  /** Absent when this client cannot ask macOS, or when a joined server runs the apps. */
  macAutomation?: MarketplaceMacAutomation | undefined;
  /** Asks for a confirmation, then removes what the catalog app installed. */
  disconnectApp: (app: Extract<MarketplaceApp, { kind: "plugin" }>) => void;
  /** Removes a custom MCP server. */
  removeServer: (id: string) => Promise<boolean>;
  /** Opens the form that adds a custom MCP server. Absent when the user cannot add one. */
  addServer?: (() => void) | undefined;
  runPrompt?: ((prompt: MarketplacePluginPrompt) => void) | undefined;
  copyLink: (slug: string) => void;
  /** Copies the shared link of an agent or a skill. */
  copyListingLink: (link: MarketplaceListingLink) => void;
  openUrl: (url: string) => void;
  /** The connector of a `connector` app. */
  connector: (id: ConnectorId) => MarketplaceConnector | undefined;

  /** The last failure, as a sentence. */
  error: () => string | null;
  /** The code of the last failure, shown beside the sentence. */
  errorReference?: (() => string | null) | undefined;
  clearError: () => void;
  /** The last result, for a screen reader. */
  notice: () => string;
}
