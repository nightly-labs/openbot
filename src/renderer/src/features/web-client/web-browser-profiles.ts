import {
  type AgentEvent,
  decodeAgentBrowserProfile,
  decodeBrowserProfileList,
  decodeBrowserProfileSummary,
  decodeHostBrowserTabProfiles,
  type TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_ROUTES } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { BrowserProfileCalls } from "../browser/browser-profiles-port";

const ignoreResponse = (): void => {};

/**
 * The `browser-profiles-v1` routes of the connected host. Only the tab route answers a member. A host
 * with `browser-profiles-events-v1` reports each change with an event, which `onChanged` passes on.
 */
export function webBrowserProfileCalls(
  request: () => TeamApiRequest,
  onHostEvent?: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void,
): BrowserProfileCalls {
  const post = <T>(path: string, decode: (value: unknown) => T, body: Parameters<TeamApiRequest>[3] = {}) =>
    request()("POST", path, decode, body);
  return {
    list: () => post(BROWSER_PROFILES_ROUTES.list, decodeBrowserProfileList),
    create: (name) => post(BROWSER_PROFILES_ROUTES.create, decodeBrowserProfileSummary, { name }),
    update: (input) => post(BROWSER_PROFILES_ROUTES.update, decodeBrowserProfileSummary, { ...input }),
    clear: (input) => post(BROWSER_PROFILES_ROUTES.clear, ignoreResponse, { ...input }),
    remove: (profileId) => post(BROWSER_PROFILES_ROUTES.delete, ignoreResponse, { profileId }),
    readAgent: (agentId) => post(BROWSER_PROFILES_ROUTES.agent, decodeAgentBrowserProfile, { agentId }),
    updateAgent: (input) =>
      post(BROWSER_PROFILES_ROUTES.updateAgent, decodeAgentBrowserProfile, {
        agentId: input.agentId,
        profile: { ...input.profile },
      }),
    tabProfiles: () => post(BROWSER_PROFILES_ROUTES.tabs, decodeHostBrowserTabProfiles),
    ...(onHostEvent
      ? {
          onChanged: (listener: () => void) =>
            onHostEvent((event) => {
              if (event.type === "browser-profiles-changed") listener();
            }),
        }
      : {}),
  };
}
