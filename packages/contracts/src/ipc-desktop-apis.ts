import type { AgentEvent } from "./ipc-agent-events";
import type { AttachmentImportEvent } from "./ipc-attachments";
import type { BrowserLiveViewInput } from "./ipc-browser";
import type { GroupApi, IpcEndpoints } from "./ipc-endpoints";
import type { DirectMessageRealtimeEvent, DirectTypingRealtimeEvent, TeamPresenceSnapshot } from "./ipc-team-host";

/**
 * Every agent group, spread into one namespace. Each scoped method takes its server last; left out,
 * it is the selected server. `onEvent` is `onScopedEvent` filtered to the selected server, and
 * `onAttachmentImport` reports the files the preload imports from a drop or a paste.
 */
export interface AgentDesktopApi
  extends GroupApi<IpcEndpoints["agent"]>,
    GroupApi<IpcEndpoints["agentMemories"]>,
    GroupApi<IpcEndpoints["sharedTables"]>,
    GroupApi<IpcEndpoints["agentRoutines"]>,
    GroupApi<IpcEndpoints["channelMemories"]>,
    GroupApi<IpcEndpoints["channelRoutines"]>,
    GroupApi<IpcEndpoints["mcpServers"]>,
    GroupApi<IpcEndpoints["agentAdmin"]>,
    GroupApi<IpcEndpoints["agentAttachments"]> {
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export type AgentTemplatesDesktopApi = GroupApi<IpcEndpoints["agentTemplates"]>;

export type MarketplaceAgentsDesktopApi = GroupApi<IpcEndpoints["marketplaceAgents"]>;

/**
 * `startLiveView` starts a live view of a tab on the active remote server; a local tab is already on
 * screen. `sendLiveViewInput` is the untyped `browserInput` endpoint, so it is written here.
 */
export interface BrowserDesktopApi extends GroupApi<IpcEndpoints["browser"]> {
  sendLiveViewInput: (input: BrowserLiveViewInput) => Promise<void>;
}

/**
 * Only the help window may call `startPermissionAppDrag`; main refuses every other sender. Only the
 * overlay surface listens to `onHighlightPlacement`. It is pushed rather than asked for: the overlay
 * carries no control and invokes nothing, so a window that floats over another application's has no
 * channel it could be driven through.
 */
export type ComputerUseDesktopApi = GroupApi<IpcEndpoints["computerUse"]>;

export type CentralAuthDesktopApi = GroupApi<IpcEndpoints["auth"]>;

export type UpdateDesktopApi = GroupApi<IpcEndpoints["update"]>;

export type NotificationsDesktopApi = GroupApi<IpcEndpoints["notifications"]>;

export type ProviderRuntimesDesktopApi = GroupApi<IpcEndpoints["providerRuntimes"]>;

export type MaintenanceDesktopApi = GroupApi<IpcEndpoints["maintenance"]>;

export type DynamicIslandDesktopApi = GroupApi<IpcEndpoints["dynamicIsland"]>;

/**
 * The preload wraps some bridged methods: the server list calls record which server is selected, and
 * `onEvent` does too. The scoped events come from every server; the three methods below keep one.
 */
export interface ServersDesktopApi extends GroupApi<IpcEndpoints["servers"]> {
  /** `onScopedPresence` for one server: the selected one when `serverId` is left out. */
  onPresence: (listener: (snapshot: TeamPresenceSnapshot) => void, serverId?: string) => () => void;
  onDirectMessage: (listener: (event: DirectMessageRealtimeEvent) => void) => () => void;
  onDirectTyping: (listener: (event: DirectTypingRealtimeEvent) => void) => () => void;
}

/**
 * The plugin deep link. Both carry a slug, never a listing: the catalog is already in the renderer,
 * and a link that carried the listing itself would let the address bar describe what gets installed.
 */
export type PluginsDesktopApi = GroupApi<IpcEndpoints["plugins"]>;

export type HostDesktopApi = GroupApi<IpcEndpoints["host"]>;

export type RemoteDesktopDesktopApi = GroupApi<IpcEndpoints["remoteDesktop"]>;

export type VoiceDesktopApi = GroupApi<IpcEndpoints["voice"]>;

export type SkillsDesktopApi = GroupApi<IpcEndpoints["skills"]>;

export type HostedSitesDesktopApi = GroupApi<IpcEndpoints["hostedSites"]>;
export type GitHubConnectorDesktopApi = GroupApi<IpcEndpoints["githubConnector"]>;
export type BillingDesktopApi = GroupApi<IpcEndpoints["billing"]>;

export type HostedServersDesktopApi = GroupApi<IpcEndpoints["hostedServers"]>;

/**
 * The user's own model endpoints. `save` and `delete` both answer with the whole list plus how the
 * provider restart went, so the renderer replaces its snapshot in one write and can say honestly
 * whether the models are on their way.
 */
export type CustomProvidersDesktopApi = GroupApi<IpcEndpoints["customProviders"]>;

/**
 * Local model servers on this computer, the model list of one endpoint, and where the scan looks.
 * Main makes each request; a scan sends no key.
 */
export type ProviderDetectionDesktopApi = GroupApi<IpcEndpoints["providerDetection"]>;
export type CustomAgentsDesktopApi = GroupApi<IpcEndpoints["customAgents"]>;

/**
 * The providers of one server's host: code sign-in, API keys, managed CLI runtimes and custom
 * endpoints. Every method names its server. A remote host answers only an owner or admin, and only
 * when it advertises `providers-v1`.
 */
export type ProviderAdminDesktopApi = GroupApi<IpcEndpoints["providerAdmin"]>;

/**
 * The server name, logo and app update of one server's host. A remote host answers only an owner or
 * admin, and only when it advertises `host-admin-v1` (name and logo) or `host-update-v1` (update).
 */
export type HostAdminDesktopApi = GroupApi<IpcEndpoints["hostAdmin"]>;

/**
 * The Slack connection of one agent on one server's host. A remote host answers only an owner or
 * admin, and only when it advertises `messaging-v1`.
 */
export type MessagingDesktopApi = GroupApi<IpcEndpoints["messaging"]>;

/**
 * Storage and files of one host. Every scoped method names its server, because the settings modal can
 * be open for a server the user has not switched to. A remote host without `storage-v1` answers null.
 */
export type StorageDesktopApi = GroupApi<IpcEndpoints["storage"]>;

/**
 * Agent import into the local host. `choose` opens the file dialog and answers null when the user
 * cancels. A token is used once: `apply` and `discard` both release the staged archive.
 */
export type AgentImportDesktopApi = GroupApi<IpcEndpoints["agentImport"]>;

// The `app` and `providers` groups sit at the top level, as they did before groups existed.
export interface OpenBotDesktopApi extends GroupApi<IpcEndpoints["app"]>, GroupApi<IpcEndpoints["providers"]> {
  dynamicIsland: DynamicIslandDesktopApi;
  computerUse: ComputerUseDesktopApi;
  providerRuntimes: ProviderRuntimesDesktopApi;
  voice: VoiceDesktopApi;
  skills: SkillsDesktopApi;
  customProviders: CustomProvidersDesktopApi;
  providerDetection: ProviderDetectionDesktopApi;
  customAgents: CustomAgentsDesktopApi;
  providerAdmin: ProviderAdminDesktopApi;
  hostAdmin: HostAdminDesktopApi;
  messaging: MessagingDesktopApi;
  storage: StorageDesktopApi;
  agentImport: AgentImportDesktopApi;
  hostedSites: HostedSitesDesktopApi;
  githubConnector: GitHubConnectorDesktopApi;
  billing: BillingDesktopApi;
  hostedServers: HostedServersDesktopApi;
  marketplaceAgents: MarketplaceAgentsDesktopApi;
  agentTemplates: AgentTemplatesDesktopApi;
  auth: CentralAuthDesktopApi;
  agent: AgentDesktopApi;
  browser: BrowserDesktopApi;
  update: UpdateDesktopApi;
  notifications: NotificationsDesktopApi;
  maintenance: MaintenanceDesktopApi;
  servers: ServersDesktopApi;
  plugins: PluginsDesktopApi;
  host: HostDesktopApi;
  remoteDesktop: RemoteDesktopDesktopApi;
}
