import type {
  BrowserControlSession,
  BrowserTab,
  BrowserTabAgent,
  BrowserTabLabel,
  BrowserWindowTabDetails,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";

export function ownsBrowserTab(agent: Pick<AgentProfile, "id" | "threadId">, tab: BrowserTab): boolean {
  return tab.ownerAgentId
    ? tab.ownerAgentId === agent.id
    : Boolean(agent.threadId && tab.ownerThreadId === agent.threadId);
}

export function newestBrowserControlSession(
  sessions: readonly BrowserControlSession[],
): BrowserControlSession | undefined {
  let acting: BrowserControlSession | undefined;
  let newest: BrowserControlSession | undefined;
  for (const session of sessions) {
    if (!newest || session.startedAt > newest.startedAt) newest = session;
    if (session.phase === "acting" && (!acting || session.startedAt > acting.startedAt)) acting = session;
  }
  return acting ?? newest;
}

export function browserControlForTab(
  sessions: readonly BrowserControlSession[],
  tab: BrowserTab,
  activeTabId: string | undefined,
): BrowserControlSession | undefined {
  return newestBrowserControlSession(
    sessions.filter(
      (session) =>
        session.tabId === tab.id ||
        (session.tabId === null && tab.id === activeTabId && session.threadId === tab.ownerThreadId),
    ),
  );
}

export function browserWindowTabDetails(
  tabId: string,
  control: BrowserControlSession | undefined,
  controller: BrowserTabAgent | undefined,
  owner: BrowserTabAgent | undefined,
  profile: BrowserTabLabel | undefined,
): BrowserWindowTabDetails {
  return {
    tabId,
    ...(control ? { control } : {}),
    ...(controller ? { controller: tabAgent(controller) } : {}),
    ...(owner ? { owner: tabAgent(owner) } : {}),
    ...(profile ? { profile } : {}),
  };
}

function tabAgent(agent: BrowserTabAgent): BrowserTabAgent {
  return {
    id: agent.id,
    name: agent.name,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    ...(agent.avatarColor === undefined ? {} : { avatarColor: agent.avatarColor }),
    avatarUrl: agent.avatarUrl,
  };
}
