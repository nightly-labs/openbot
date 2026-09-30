import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Bot, Hash, Server, Store, UsersRound } from "@openbot/ui";
import type {
  GlobalSearchAction,
  GlobalSearchChannel,
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
import { useServerSettings } from "./features/servers/server-settings";
import { useServers } from "./features/servers/servers-context";
import { useSettings } from "./features/settings/settings-context";
import { navItems } from "./features/settings/settings-tabs";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";

const FILE_SEARCH_LIMIT = 50;

/** The channels that global search lists, with the last message as the detail. The web client shares it. */
export function globalSearchChannels(channels: ChannelSummary[]): GlobalSearchChannel[] {
  return channels
    .filter((channel) => !channel.archived)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      detail: channel.lastMessage ? `${channel.lastMessage.authorName}: ${channel.lastMessage.text}` : undefined,
    }));
}

/**
 * What global search finds besides agents and messages: channels, routines, files, commands and
 * settings pages. Routines load each time the search opens, as no store keeps every agent's list.
 * Files come from this computer's database, so a joined server shows no Files filter.
 */
export function useGlobalSearchSources(open: () => boolean) {
  const { t } = useText();
  const platform = usePlatform();
  const channels = useChannels();
  const { agentList, openBotSetup, setSettingsRequest } = useAgents();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const { openServerSettings } = useServerSettings();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const [routines, setRoutines] = createSignal<GlobalSearchRoutine[]>([]);
  const [routinesLoading, setRoutinesLoading] = createSignal(false);
  let routineRequest = 0;

  const local = () => activeServer()?.kind === "local";

  const searchChannels = createMemo(() =>
    channels.supported() ? globalSearchChannels(channels.state.channels) : undefined,
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
    if (!agentId) return;
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId: routine.id, name: routine.name } });
  }

  const actions = createMemo<GlobalSearchAction[]>(() => {
    const server = activeServer();
    const isMac = platform.appInfo()?.platform === "darwin";
    const list: GlobalSearchAction[] = [
      {
        id: "new-agent",
        label: t("sidebar.new.agent"),
        group: "actions",
        icon: Bot,
        run: () => {
          channels.close();
          openBotSetup();
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
    for (const item of navItems) {
      // Hosted servers shows only for an account with hosting, which the dialog checks when it opens.
      if (item.value === "hosted-servers" || (item.value === "dynamic-island" && !isMac)) continue;
      list.push({
        id: `settings:${item.value}`,
        label: t(item.titleKey),
        detail: t("conversation.globalSearch.appSettings"),
        group: "settings",
        icon: item.icon,
        run: () => openAppSettings(null, item.value),
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
          run: () => openServerSettings(server.id, null, "general"),
        },
        {
          id: "server:members",
          label: t("server.settings.membersTitle"),
          detail: server.name,
          group: "settings",
          icon: UsersRound,
          run: () => openServerSettings(server.id, null, "members"),
        },
      );
    }
    return list;
  });

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
