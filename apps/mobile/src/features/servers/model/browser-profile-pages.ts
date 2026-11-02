import { router } from "expo-router";

/**
 * The stack that shows the browser profile pages: Server settings, or the settings of one agent,
 * which open them from the agent's profile choice without a second sheet.
 */
export type BrowserProfileStack = { kind: "server" } | { kind: "agent"; agentId: string };

/** Opens one profile, or a new profile when `profileId` is absent. `assignTo` gives a new profile to that agent. */
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

/** Opens the agents of the server, to give them the profile or take it from them. */
export function openBrowserProfileAgentsPage(stack: BrowserProfileStack, serverId: string, profileId: string): void {
  if (stack.kind === "server")
    router.push({ pathname: "/server-settings/browser-profile-agents", params: { serverId, profileId } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profile-agents",
      params: { agentId: stack.agentId, serverId, profileId },
    });
}

/** Opens the list of the profiles. */
export function openBrowserProfilesPage(stack: BrowserProfileStack, serverId: string): void {
  if (stack.kind === "server") router.push({ pathname: "/server-settings/browser-profiles", params: { serverId } });
  else
    router.push({
      pathname: "/agent-info/[agentId]/browser-profiles",
      params: { agentId: stack.agentId, serverId },
    });
}
