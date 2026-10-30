import { BookMarked, Bot, CalendarClock, Hash, Server, Store, UsersRound } from "@openbot/ui";
import type {
  GlobalSearchAction,
  GlobalSearchFile,
  GlobalSearchPage,
  GlobalSearchRoutine,
} from "@openbot/ui/components/GlobalSearch";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal } from "solid-js";
import { formatMessageTime } from "./app-message-projection";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { useChannels } from "./features/channels/channels-context";
import { globalSearchChannels } from "./features/channels/global-search-channels";
import { serverCanAdminister } from "./features/servers/server-capabilities";
import { useServerSettings } from "./features/servers/server-settings";
import { useServers } from "./features/servers/servers-context";
import { useSettings } from "./features/settings/settings-context";
import { dynamicIslandSettingsShown, navItems } from "./features/settings/settings-tabs";
import { useUsage } from "./features/usage/usage-context";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";

const FILE_SEARCH_LIMIT = 50;

/**
 * What global search finds besides agents and messages: channels, routines, files, commands and
 * settings pages. Routines load each time the search opens, as no store keeps every agent's list.
 * Files come from this computer's database, so a joined server shows no Files filter.
 */
export function useGlobalSearchSources(open: () => boolean) {
  const { t } = useText();
  const platform = usePlatform();
  const channels = useChannels();
  const { agentList, agentSetupOpen, creatingAgent, openAgentSetup, setSettingsRequest } = useAgents();
  const { selectAgent, globalSearchOpener } = useNavigation();
  const { activeServer } = useServers();
  const { openServerSettings } = useServerSettings();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const { openSchedule } = useUsage();
  const [routines, setRoutines] = createSignal<GlobalSearchRoutine[]>([]);
  const [routinesLoading, setRoutinesLoading] = createSignal(false);
  let routineRequest = 0;

  const local = () => activeServer()?.kind === "local";

  // Lazy: the overlay reads these only while the search is open.
  const searchChannels = createMemo(
    () => (channels.supported() ? globalSearchChannels(channels.state.channels) : undefined),
    { lazy: true },
  );

  createEffect(
    () => (open() ? agentList() : null),
    (agents) => {
      const request = ++routineRequest;
      if (!agents) {
        setRoutinesLoading(false);
        return;
      }
      setRoutinesLoading(true);
      const names = new Map(agents.map((agent) => [agent.id, agent.name]));
      void Promise.all(
        agents.map((agent) =>
          appPort()
            .agent.listRoutines(agent.id)
            .catch(() => []),
        ),
      ).then((lists) => {
        if (request !== routineRequest) return;
        setRoutines(() =>
          lists.flat().map((routine) => ({
            id: routine.id,
            name: routine.name,
            agentId: routine.agentId,
            detail: names.get(routine.agentId) ?? "",
          })),
        );
        setRoutinesLoading(false);
      });
    },
  );

  async function searchFiles(query: string, cursor?: string): Promise<GlobalSearchPage<GlobalSearchFile>> {
    const page = await appPort().agent.searchConversationFiles({
      query,
      ...(cursor === undefined ? {} : { cursor }),
      limit: FILE_SEARCH_LIMIT,
    });
    return {
      results: page.results.map((result) => ({
        id: result.attachment.id,
        name: result.attachment.name,
        agentId: result.agentId,
        messageId: result.messageId,
        time: formatMessageTime(result.createdAt),
      })),
      nextCursor: page.nextCursor,
    };
  }

  function selectRoutine(routine: GlobalSearchRoutine): void {
    const agentId = routine.agentId;
    // As in `editAgent`: the agent cannot change while a new agent is being created.
    if (!agentId || (agentSetupOpen() && creatingAgent())) return;
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId: routine.id, name: routine.name } });
  }

  const actions = createMemo<GlobalSearchAction[]>(
    () => {
      const server = activeServer();
      const dynamicIslandShown = dynamicIslandSettingsShown(platform.appInfo()?.platform, platform.chatWindow !== null);
      const list: GlobalSearchAction[] = [
        {
          id: "new-agent",
          label: t("sidebar.new.agent"),
          group: "actions",
          icon: Bot,
          run: () => {
            channels.close();
            openAgentSetup();
          },
        },
      ];
      if (channels.supported()) {
        list.push({
          id: "new-channel",
          label: t("sidebar.new.channel"),
          group: "actions",
          icon: Hash,
          run: channels.create,
        });
      }
      list.push({
        id: "marketplace",
        label: t("sidebar.topbar.openMarketplace"),
        group: "actions",
        icon: Store,
        run: () => setSkillsMarketplaceOpen(true),
      });
      if (server) {
        list.push({
          id: "schedule",
          label: t("routine.calendar.open"),
          group: "actions",
          icon: CalendarClock,
          run: () => openSchedule(server.id, globalSearchOpener()),
        });
      }
      for (const item of navItems) {
        // Hosted servers shows only for an account with hosting, which the dialog checks when it opens.
        if (item.value === "hosted-servers" || (item.value === "dynamic-island" && !dynamicIslandShown)) continue;
        list.push({
          id: `settings:${item.value}`,
          label: t(item.titleKey),
          detail: t("conversation.globalSearch.appSettings"),
          group: "settings",
          icon: item.icon,
          run: () => openAppSettings(globalSearchOpener(), item.value),
        });
      }
      if (server) {
        list.push(
          {
            id: "server:general",
            label: t("server.settings.generalTitle"),
            detail: server.name,
            group: "settings",
            icon: Server,
            run: () => openServerSettings(server.id, globalSearchOpener(), "general"),
          },
          {
            id: "server:members",
            label: t("server.settings.membersTitle"),
            detail: server.name,
            group: "settings",
            icon: UsersRound,
            run: () => openServerSettings(server.id, globalSearchOpener(), "members"),
          },
        );
        // General shows the row only to an admin of a host that can set it, and only while it is online.
        if (
          serverCanAdminister(server, "agent-memory-limit-v1") &&
          (server.kind === "local" || server.state === "online")
        ) {
          list.push({
            id: "server:memory-limit",
            label: t("server.settings.memoryLimit"),
            detail: server.name,
            group: "settings",
            icon: BookMarked,
            run: () => openServerSettings(server.id, globalSearchOpener(), "general"),
          });
        }
        if (serverCanAdminister(server, "memory-review-v1") && (server.kind === "local" || server.state === "online")) {
          list.push({
            id: "server:memory-review",
            label: t("server.settings.memoryReview"),
            detail: server.name,
            group: "settings",
            icon: BookMarked,
            run: () => openServerSettings(server.id, globalSearchOpener(), "general"),
          });
        }
      }
      return list;
    },
    { lazy: true },
  );

  return {
    channels: searchChannels,
    routines,
    routinesLoading,
    actions,
    searchFiles: () => (local() ? searchFiles : undefined),
    openChannel: (channelId: string) => void channels.open(channelId),
    selectRoutine,
  };
}
