import type { AgentEvent } from "./ipc-agent-events";
import type { AgentFolderChange } from "./ipc-agent-folders";
import type { AttachmentImportEvent } from "./ipc-attachments";
import type { BrowserLiveViewInput } from "./ipc-browser";
import type { BridgedDesktopApi, GroupApi, IpcEndpoints, PathApi } from "./ipc-endpoints";
import type { DirectMessageRealtimeEvent, DirectTypingRealtimeEvent, TeamPresenceSnapshot } from "./ipc-team-host";

export interface AgentDesktopApi extends PathApi<"agent"> {
  addDroppedAgentFolder: (agentId: string, folder: File) => Promise<AgentFolderChange>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  retryAttachmentImport: (requestId: string) => void;
  discardAttachmentImport: (requestId: string) => void;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export type AgentTemplatesDesktopApi = GroupApi<IpcEndpoints["agentTemplates"]>;

export type MarketplaceAgentsDesktopApi = GroupApi<IpcEndpoints["marketplaceAgents"]>;

export interface BrowserDesktopApi extends GroupApi<IpcEndpoints["browser"]> {
  sendLiveViewInput: (input: BrowserLiveViewInput) => Promise<void>;
}

export type ComputerUseDesktopApi = GroupApi<IpcEndpoints["computerUse"]>;

export type CentralAuthDesktopApi = GroupApi<IpcEndpoints["auth"]>;

export type UpdateDesktopApi = GroupApi<IpcEndpoints["update"]>;

export type NotificationsDesktopApi = GroupApi<IpcEndpoints["notifications"]>;

export type ProviderRuntimesDesktopApi = GroupApi<IpcEndpoints["providerRuntimes"]>;

export type MaintenanceDesktopApi = GroupApi<IpcEndpoints["maintenance"]>;

export type DynamicIslandDesktopApi = GroupApi<IpcEndpoints["dynamicIsland"]>;

export interface ServersDesktopApi extends GroupApi<IpcEndpoints["servers"]> {
  onPresence: (listener: (snapshot: TeamPresenceSnapshot) => void, serverId?: string) => () => void;
  onDirectMessage: (listener: (event: DirectMessageRealtimeEvent) => void) => () => void;
  onDirectTyping: (listener: (event: DirectTypingRealtimeEvent) => void) => () => void;
}

export type PluginsDesktopApi = GroupApi<IpcEndpoints["plugins"]>;

export type HostDesktopApi = GroupApi<IpcEndpoints["host"]>;

export type RemoteDesktopDesktopApi = GroupApi<IpcEndpoints["remoteDesktop"]>;

export type VoiceDesktopApi = GroupApi<IpcEndpoints["voice"]>;

export type SkillsDesktopApi = GroupApi<IpcEndpoints["skills"]>;

export type HostedSitesDesktopApi = GroupApi<IpcEndpoints["hostedSites"]>;
export type GitHubConnectorDesktopApi = GroupApi<IpcEndpoints["githubConnector"]>;
export type LinkAccountDesktopApi = GroupApi<IpcEndpoints["linkAccount"]>;
export type OnePasswordConnectorDesktopApi = GroupApi<IpcEndpoints["onePasswordConnector"]>;
export type BillingDesktopApi = GroupApi<IpcEndpoints["billing"]>;
export type LicenseDesktopApi = GroupApi<IpcEndpoints["license"]>;
export type RoutineFeedDesktopApi = GroupApi<IpcEndpoints["routineFeed"]>;

export type HostedServersDesktopApi = GroupApi<IpcEndpoints["hostedServers"]>;

export type CustomProvidersDesktopApi = GroupApi<IpcEndpoints["customProviders"]>;

export type ProviderDetectionDesktopApi = GroupApi<IpcEndpoints["providerDetection"]>;
export type CustomAgentsDesktopApi = GroupApi<IpcEndpoints["customAgents"]>;

export type ProviderAdminDesktopApi = GroupApi<IpcEndpoints["providerAdmin"]>;

export type HostAdminDesktopApi = GroupApi<IpcEndpoints["hostAdmin"]>;

export type MessagingDesktopApi = GroupApi<IpcEndpoints["messaging"]>;

export type StorageDesktopApi = GroupApi<IpcEndpoints["storage"]>;

export type AgentImportDesktopApi = GroupApi<IpcEndpoints["agentImport"]>;

export interface OpenBotDesktopApi extends Omit<BridgedDesktopApi, "agent" | "browser" | "servers"> {
  agent: AgentDesktopApi;
  browser: BrowserDesktopApi;
  servers: ServersDesktopApi;
}
