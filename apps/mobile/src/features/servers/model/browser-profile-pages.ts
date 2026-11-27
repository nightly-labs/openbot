import { router } from "expo-router";

export type BrowserProfileStack = { kind: "server" } | { kind: "agent"; agentId: string };

export function openBrowserProfilePage(
  stack: BrowserProfileStack,
  serverId: string,
  params: { profileId?: string; assignTo?: string } = {},
): void {
  if (stack.kind === "server")
    router.push({ pathname: "/server-settings/browser-profile", params: { serverId, ...params } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profile-edit",
      params: { agentId: stack.agentId, serverId, ...params },
    });
}

export function openBrowserProfileAgentsPage(stack: BrowserProfileStack, serverId: string, profileId: string): void {
  if (stack.kind === "server")
    router.push({ pathname: "/server-settings/browser-profile-agents", params: { serverId, profileId } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profile-agents",
      params: { agentId: stack.agentId, serverId, profileId },
    });
}

export function openBrowserProfilesPage(stack: BrowserProfileStack, serverId: string): void {
  if (stack.kind === "server") router.push({ pathname: "/server-settings/browser-profiles", params: { serverId } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profiles",
      params: { agentId: stack.agentId, serverId },
    });
}

export function openBrowserProxyPage(
  stack: BrowserProfileStack,
  serverId: string,
  params: { proxyId?: string; assignTo?: string } = {},
): void {
  if (stack.kind === "server")
    router.push({ pathname: "/server-settings/browser-proxy", params: { serverId, ...params } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-proxy",
      params: { agentId: stack.agentId, serverId, ...params },
    });
}

export function openBrowserProfileProxyPage(stack: BrowserProfileStack, serverId: string, profileId: string): void {
  if (stack.kind === "server")
    router.push({ pathname: "/server-settings/browser-profile-proxy", params: { serverId, profileId } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profile-proxy",
      params: { agentId: stack.agentId, serverId, profileId },
    });
}
