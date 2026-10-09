import type {
  AgentSummary,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  McpServerConfig,
  SkillCategory,
} from "@openbot/contracts/ipc";
import type { BitwardenConnectorPanelProps } from "../settings/BitwardenConnectorPanel";
import type { GitHubConnectorPanelProps } from "../settings/GitHubConnectorPanel";
import type { MarketplacePluginDetail, MarketplacePluginPrompt } from "../settings/marketplace-plugins";
import type { OnePasswordConnectorPanelProps } from "../settings/OnePasswordConnectorPanel";
import type { CatalogList, MarketplaceHomeCache } from "./marketplace-listing";

/** An agent of the user's that a skill can go to. */
export type MarketplaceAgent = Pick<AgentSummary, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

/** What an agent listing offers the user. */
export type AgentListingState = "add" | "added" | "update";

/** How far the read of one agent's installed skills got. An empty list is an answer only when `loaded`. */
export type SkillRead = "idle" | "loading" | "loaded" | "failed";

export type MarketplaceAppStatus = "connected" | "attention" | "idle";

interface AppBase {
  id: string;
  name: string;
  /** The line under the name on the card. */
  tagline: string;
  status: MarketplaceAppStatus;
}

/**
 * One row of the Apps tab: a catalog app, the GitHub connector, or an MCP server that the host
 * holds and no catalog app claims.
 */
export type MarketplaceApp =
  | (AppBase & { kind: "plugin"; category: SkillCategory; plugin: MarketplacePluginDetail })
  | (AppBase & { kind: "github"; category: SkillCategory })
  | (AppBase & { kind: "onepassword"; category: SkillCategory })
  | (AppBase & { kind: "bitwarden"; category: SkillCategory })
  | (AppBase & { kind: "custom"; server: McpServerConfig });

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
  /** The agents a skill can go to. Empty when this user cannot install skills. */
  agents: () => readonly MarketplaceAgent[];
  /** The agent whose conversation is open. */
  activeAgentId: () => string;
  /** Reads the installed skills of each agent that has no fresh answer. */
  readSkills: () => void;
  skillRead: (agentId: string) => SkillRead;
  installedSkill: (agentId: string, skillId: string) => InstalledSkill | undefined;
  skillBusy: (skillId: string) => boolean;
  /** Installs the skill on each agent, or removes it, one agent at a time. */
  setSkill: (skill: MarketplaceSkillSummary, agentIds: readonly string[], on: boolean) => Promise<void>;
  /** Absent while no composer can take the example. */
  trySkill?: ((agentId: string, skill: MarketplaceSkillDetail) => void) | undefined;

  apps: () => readonly MarketplaceApp[];
  /** False for a member of a joined server, who browses and connects nothing. */
  canConnectApps: () => boolean;
  appBusy: (id: string) => boolean;
  /** Runs the connect step of the app. False when the user closed it. */
  connectApp: (app: MarketplaceApp) => Promise<boolean>;
  /** Asks for a confirmation, then removes what the app installed. */
  disconnectApp: (app: MarketplaceApp) => void;
  /** Removes a custom MCP server. */
  removeServer: (id: string) => Promise<boolean>;
  runPrompt?: ((prompt: MarketplacePluginPrompt) => void) | undefined;
  copyLink: (slug: string) => void;
  openUrl: (url: string) => void;
  /** The GitHub connector page, when this computer has one. */
  github?: (() => GitHubConnectorPanelProps) | undefined;
  /** The 1Password connector page, on the computer that runs OpenBot. */
  onePassword?: (() => OnePasswordConnectorPanelProps) | undefined;
  bitwarden?: (() => BitwardenConnectorPanelProps) | undefined;

  /** The last failure, as a sentence. */
  error: () => string | null;
  clearError: () => void;
  /** The last result, for a screen reader. */
  notice: () => string;
}
