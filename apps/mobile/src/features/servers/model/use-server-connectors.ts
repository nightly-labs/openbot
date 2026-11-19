import type { ConnectorMessagingPlatform } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { MobileConnectorId } from "@/features/servers/model/connectors";
import { isMobilePasswordManagerId } from "@/features/servers/model/password-managers";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const POLL_MS = 3_000;

export function useServerConnectors(serverId: string, poll: MobileConnectorId | "all" | null) {
  const {
    servers,
    agents,
    canManageConnectors,
    canManageOnePasswordConnector,
    canManageBitwardenConnector,
    canManageWhatsAppConnector,
    canManagePasswordManagers,
  } = useMobileWorkspace();
  const {
    githubConnector,
    loadOnePasswordConnector,
    loadBitwardenConnector,
    loadMessagingConnections,
    loadWhatsAppConnector,
    loadPasswordManagers,
  } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const server = servers.find((candidate) => candidate.id === serverId);
  const connectors = canManageConnectors(serverId);
  const onePasswordAvailable = canManageOnePasswordConnector(serverId);
  const bitwardenAvailable = canManageBitwardenConnector(serverId);
  const whatsappAvailable = canManageWhatsAppConnector(serverId);
  const passwordManagersAvailable = canManagePasswordManagers(serverId);
  const refetchInterval = (id: MobileConnectorId): number | false =>
    focused && (poll === "all" || poll === id) ? POLL_MS : false;
  const messaging = (platform: ConnectorMessagingPlatform) => ({
    queryKey: queryKeys.serverConnector(queryScope, serverId, platform),
    enabled: connectors,
    retry: false,
    refetchInterval: refetchInterval(platform),
    queryFn: () => loadMessagingConnections(platform, serverId),
  });
  const slack = useQuery(messaging("slack"));
  const discord = useQuery(messaging("discord"));
  const telegram = useQuery(messaging("telegram"));
  const whatsapp = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "whatsapp"),
    enabled: whatsappAvailable,
    retry: false,
    refetchInterval: refetchInterval("whatsapp"),
    queryFn: () => loadWhatsAppConnector(serverId),
  });
  const github = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "github"),
    enabled: connectors,
    retry: false,
    refetchInterval: refetchInterval("github"),
    queryFn: () => githubConnector("githubStatus", serverId),
  });
  const onePassword = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "onepassword"),
    enabled: onePasswordAvailable,
    retry: false,
    refetchInterval: refetchInterval("onepassword"),
    queryFn: () => loadOnePasswordConnector(serverId),
  });
  const bitwarden = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "bitwarden"),
    enabled: bitwardenAvailable,
    retry: false,
    refetchInterval: refetchInterval("bitwarden"),
    queryFn: () => loadBitwardenConnector(serverId),
  });
  const passwordManagers = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "password-managers"),
    enabled: passwordManagersAvailable,
    retry: false,
    refetchInterval:
      focused && (poll === "all" || (poll !== null && isMobilePasswordManagerId(poll))) ? POLL_MS : false,
    queryFn: () => loadPasswordManagers(serverId),
  });
  return {
    server,
    agents: agents.filter((agent) => agent.serverId === serverId),
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    whatsappAvailable,
    passwordManagersAvailable,
    messaging: { slack, discord, telegram },
    whatsapp,
    github,
    onePassword,
    bitwarden,
    passwordManagers,
  };
}

export function useConnectorAction(refetch: () => unknown) {
  const { action, perform } = useLockedMutation({
    settled: () => {
      void refetch();
    },
  });
  return {
    busy: action.isPending,
    error: action.error,
    reset: action.reset,
    perform,
  };
}

export function useGitHubRepositories(serverId: string, connected: boolean) {
  const { loadGitHubRepositories } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "github-repositories"),
    enabled: connected,
    retry: false,
    queryFn: () => loadGitHubRepositories(serverId),
  });
}

export function useWhatsAppGroups(serverId: string, workspaceId: string, enabled: boolean) {
  const { loadWhatsAppGroups } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, `whatsapp-groups:${workspaceId}`),
    enabled,
    retry: false,
    queryFn: () => loadWhatsAppGroups({ workspaceId }, serverId),
  });
}
