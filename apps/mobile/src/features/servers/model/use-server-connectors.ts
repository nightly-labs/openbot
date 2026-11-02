import type { MessagingPlatform } from "@openbot/contracts/ipc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { MobileConnectorId } from "@/features/servers/model/connectors";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

/**
 * How often a page reads the connections while it shows. A host sends no event for a connection, and
 * a connect ends in the browser or in Telegram, as on the desktop.
 */
const POLL_MS = 3_000;

/**
 * The connectors of one joined server, as Server settings › Connectors and each connector page show
 * them. The pages use the same queries, so a change on one page shows on the others. Only the page
 * on screen reads them again.
 */
export function useServerConnectors(serverId: string, poll: MobileConnectorId | "all" | null) {
  const { servers, agents, canManageConnectors, canManageOnePasswordConnector, canManageBitwardenConnector } =
    useMobileWorkspace();
  const { githubConnector, loadOnePasswordConnector, loadBitwardenConnector, loadMessagingConnections } =
    useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const server = servers.find((candidate) => candidate.id === serverId);
  const connectors = canManageConnectors(serverId);
  const onePasswordAvailable = canManageOnePasswordConnector(serverId);
  const bitwardenAvailable = canManageBitwardenConnector(serverId);
  /** Only the connector that the page on screen shows is read again. */
  const refetchInterval = (id: MobileConnectorId): number | false =>
    focused && (poll === "all" || poll === id) ? POLL_MS : false;
  const messaging = (platform: MessagingPlatform) => ({
    queryKey: queryKeys.serverConnector(queryScope, serverId, platform),
    enabled: connectors,
    retry: false,
    refetchInterval: refetchInterval(platform),
    queryFn: () => loadMessagingConnections(platform, serverId),
  });
  const slack = useQuery(messaging("slack"));
  const discord = useQuery(messaging("discord"));
  const telegram = useQuery(messaging("telegram"));
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
  return {
    server,
    /** The agents of this server, to find each orchestrator. */
    agents: agents.filter((agent) => agent.serverId === serverId),
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    messaging: { slack, discord, telegram },
    github,
    onePassword,
    bitwarden,
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
