import type { ConnectorMessagingPlatform } from "@openbot/contracts/ipc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { MobileConnectorId } from "@/features/servers/model/connectors";
import { isMobilePasswordManagerId } from "@/features/servers/model/password-managers";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

/**
 * How often a page reads the connections while it shows. A host sends no event for a connection, and
 * a connect ends in the browser or in Telegram, as on the desktop.
 */
const POLL_MS = 3_000;

/**
 * The connectors of one joined server, as the Marketplace apps and each connector page show
 * them. The pages use the same queries, so a change on one page shows on the others. Only the page
 * on screen reads them again.
 */
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
  /** Only the connector that the page on screen shows is read again. */
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
  /** A number changes on its own, and a link ends on the phone, so the page reads it again. */
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
  /** The host answers a connect with `connecting` and signs in after that, so the page reads it again. */
  const bitwarden = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "bitwarden"),
    enabled: bitwardenAvailable,
    retry: false,
    refetchInterval: refetchInterval("bitwarden"),
    queryFn: () => loadBitwardenConnector(serverId),
  });
  /**
   * One list gives every manager of the shared engine. A sign-in ends in the browser and the host
   * sends no event, so the page of a manager reads the list again while it shows.
   */
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
    /** The agents of this server, to find each orchestrator. */
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

/**
 * Runs one change of a connector at a time and reads `refetch` again when it ends, also after a
 * failure: the host can have changed part of it.
 */
export function useConnectorAction(refetch: () => unknown) {
  const locked = useRef(false);
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => {
      void haptics.notification("success");
    },
    onError: () => {
      void haptics.notification("error");
    },
    onSettled: () => {
      locked.current = false;
      void refetch();
    },
  });
  return {
    busy: action.isPending,
    error: action.error,
    reset: action.reset,
    /** Resolves true when the change succeeds. */
    perform(operation: () => Promise<void>): Promise<boolean> {
      if (locked.current) return Promise.resolve(false);
      locked.current = true;
      return action.mutateAsync(operation).then(
        () => true,
        () => false,
      );
    },
  };
}

/**
 * The repositories where the host's GitHub App is installed. The GitHub page and its Repositories page
 * read one query. GitHub limits its API, so the list is read when a page opens and after a change,
 * not on each poll.
 */
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

/**
 * The groups of one linked WhatsApp number, to choose from. The host reads them from WhatsApp, so the
 * list is read when the page opens, not on each poll.
 */
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
