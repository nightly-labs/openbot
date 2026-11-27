import type { ChannelSummary, ClientAgentSummary } from "@openbot/contracts/ipc";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { Bot, Check, ChevronDown, ChevronRight, FolderPlus, Hash, LogOut, Plus, Search, Settings } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import { ServerPlushLogo } from "@openbot/ui/server-plush-logo";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { avatarAgent, byRecent, composerAgents, rowTime } from "./agent-look";
import { createMenuPresence } from "./menu-presence";
import type { Workspace } from "./workspace";
import { XOutboxCard } from "./XOutboxCard";

interface HomeScreenProps {
  workspace: Workspace;
  serverName: string;
  hosts: RemoteTeamHost[];
  hostId: string | null;
  offline: boolean;
  onOpenAgent: (agentId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onCreate: (kind: "agent" | "channel" | "folder") => void;
  onStartThread: (agentId: string, text: string) => void;
  onSelectHost: (hostId: string) => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  sharing: boolean;
  canShare: boolean;
}

type ChatItem = { kind: "agent"; agent: ClientAgentSummary } | { kind: "channel"; channel: ChannelSummary };

const itemId = (item: ChatItem) => (item.kind === "agent" ? item.agent.id : item.channel.id);
const itemTime = (item: ChatItem) =>
  item.kind === "agent" ? (item.agent.updatedAt ?? "") : (item.channel.lastMessage?.at ?? item.channel.createdAt);

export function HomeScreen(props: HomeScreenProps) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const [menuOpen, setMenuOpen] = createSignal(false);
  const menu = createMenuPresence(menuOpen);
  const [createOpen, setCreateOpen] = createSignal(false);
  const createMenu = createMenuPresence(createOpen);
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const host = () => props.hosts.find((entry) => entry.hostId === props.hostId);
  onSettled(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".ph-server-menu, .ph-server"))
        setMenuOpen(false);
      if (!(event.target instanceof Element) || !event.target.closest(".ph-create-menu, .ph-create"))
        setCreateOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  });
  const state = () => props.workspace.state;
  const sorted = createMemo(() => [...state().agents].sort(byRecent));
  const pinned = createMemo(() =>
    state().pins.flatMap((pin): ChatItem[] => {
      if (pin.kind === "agent") {
        const agent = state().agents.find((entry) => entry.id === pin.id);
        return agent ? [{ kind: "agent", agent }] : [];
      }
      const channel = state().channels.find((entry) => entry.id === pin.id);
      return channel ? [{ kind: "channel", channel }] : [];
    }),
  );
  const isPinned = (item: ChatItem) => state().pins.some((pin) => pin.kind === item.kind && pin.id === itemId(item));
  const items = createMemo((): ChatItem[] =>
    [
      ...sorted().map((agent): ChatItem => ({ kind: "agent", agent })),
      ...state().channels.map((channel): ChatItem => ({ kind: "channel", channel })),
    ]
      .filter((item) => !isPinned(item))
      .sort((left, right) => itemTime(right).localeCompare(itemTime(left))),
  );
  const inFolder = (folderId: string) => items().filter((item) => state().folderOf[itemId(item)] === folderId);
  const unfiled = createMemo(() =>
    items().filter((item) => {
      const folder = state().folderOf[itemId(item)];
      return !folder || !state().folders.some((entry) => entry.id === folder);
    }),
  );
  const shownFolders = createMemo(() => {
    const hidden = new Set<string>();
    let closedDepth: number | null = null;
    for (const folder of state().folders) {
      if (closedDepth !== null && folder.depth > closedDepth) hidden.add(folder.id);
      else closedDepth = closed().has(folder.id) ? folder.depth : null;
    }
    return state().folders.filter((folder) => !hidden.has(folder.id));
  });
  const channelMatches = createMemo(() => {
    const key = query().trim().toLowerCase();
    if (!key || mention()) return [];
    return state().channels.filter((channel) => channel.name.toLowerCase().includes(key));
  });
  function toggleFolder(folderId: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(folderId)) next.add(folderId);
      return next;
    });
  }
  function create(kind: "agent" | "channel" | "folder") {
    setCreateOpen(false);
    props.onCreate(kind);
  }
  const mention = createMemo(() => /^@(\S*)(?:\s+([\s\S]*))?$/.exec(query().trim()));
  const matches = createMemo(() => {
    const at = mention();
    const key = (at ? (at[1] ?? "") : query().trim()).toLowerCase();
    if (!key) return sorted();
    return sorted().filter(
      (agent) => agent.name.toLowerCase().startsWith(key) || (!at && agent.preview.toLowerCase().includes(key)),
    );
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const first = matches()[0];
    if (!first) return;
    const text = mention()?.[2]?.trim();
    if (text) props.onStartThread(first.id, text);
    else if (matches().length === 1 || mention()) props.onOpenAgent(first.id);
    else return;
    setQuery("");
  }

  return (
    <div class="ph-home">
      <header class="ph-bar">
        <button
          type="button"
          class="ph-server"
          aria-haspopup="menu"
          aria-expanded={menuOpen() ? "true" : "false"}
          aria-label={t("extension.home.serverMenu")}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ServerPlushLogo seed={props.hostId ?? ""} appearance={host()?.appearance ?? null} class="ph-server-mark" />
          <span class="ph-server-name" dir="auto">
            {props.serverName}
          </span>
          <ChevronDown size={14} aria-hidden="true" class="ph-server-chevron ext-menu-chevron" />
        </button>
        <Show when={menu.mounted()}>
          <div class="ext-menu ph-server-menu" role="menu" data-closing={menu.closing() ? "" : undefined}>
            <For each={props.hosts}>
              {(entry) => (
                <button
                  type="button"
                  role="menuitem"
                  class="ext-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    if (entry.hostId !== props.hostId) props.onSelectHost(entry.hostId);
                  }}
                >
                  <ServerPlushLogo seed={entry.hostId} appearance={entry.appearance ?? null} class="ph-menu-mark" />
                  <span>{entry.name}</span>
                  <Show when={entry.hostId === props.hostId}>
                    <Check size={16} aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
            <hr class="ext-menu-separator" />
            <button
              type="button"
              role="menuitem"
              class="ext-menu-item"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenSettings();
              }}
            >
              <span>{t("extension.home.settings")}</span>
              <Settings size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              role="menuitem"
              class="ext-menu-item"
              onClick={() => {
                setMenuOpen(false);
                props.onSignOut();
              }}
            >
              <span>{t("extension.home.signOut")}</span>
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </Show>
        <button
          type="button"
          class="ph-create"
          aria-haspopup="menu"
          aria-expanded={createOpen() ? "true" : "false"}
          aria-label={props.workspace.channelsAvailable() ? t("sidebar.new.menuWithChannel") : t("sidebar.new.menu")}
          onClick={() => setCreateOpen((open) => !open)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <Show when={createMenu.mounted()}>
          <div class="ext-menu ph-create-menu" role="menu" data-closing={createMenu.closing() ? "" : undefined}>
            <button type="button" role="menuitem" class="ext-menu-item" onClick={() => create("agent")}>
              <Bot size={16} aria-hidden="true" />
              <span>{t("sidebar.new.agent")}</span>
            </button>
            <Show when={props.workspace.channelsAvailable()}>
              <button type="button" role="menuitem" class="ext-menu-item" onClick={() => create("channel")}>
                <Hash size={16} aria-hidden="true" />
                <span>{t("sidebar.new.channel")}</span>
              </button>
            </Show>
            <Show when={props.workspace.foldersAvailable()}>
              <button type="button" role="menuitem" class="ext-menu-item" onClick={() => create("folder")}>
                <FolderPlus size={16} aria-hidden="true" />
                <span>{t("sidebar.new.section")}</span>
              </button>
            </Show>
          </div>
        </Show>
      </header>
      <div class="ph-scroll">
        <Show when={props.offline}>
          <p class="ph-offline">{t("extension.connection.offline", { server: props.serverName })}</p>
        </Show>
        <Show when={props.sharing && !props.canShare}>
          <p class="ph-offline">{t("extension.browser.unsupported", { server: props.serverName })}</p>
        </Show>
        <XOutboxCard />
        <Show
          when={!query().trim()}
          fallback={
            <>
              <h2 class="ph-section">{mention() ? t("extension.home.startThread") : t("extension.home.results")}</h2>
              <For
                each={matches()}
                fallback={
                  <Show when={!channelMatches().length}>
                    <p class="ph-none">{t("extension.home.noMatch")}</p>
                  </Show>
                }
              >
                {(agent) => <AgentRow agent={agent} workspace={props.workspace} onOpen={props.onOpenAgent} />}
              </For>
              <For each={channelMatches()}>
                {(channel) => <ChannelRow channel={channel} workspace={props.workspace} onOpen={props.onOpenChannel} />}
              </For>
            </>
          }
        >
          <Show when={state().status === "ready" && state().agents.length === 0}>
            <p class="ph-none">{t("extension.home.noAgents")}</p>
          </Show>
          <Show when={pinned().length > 0}>
            <div class="ph-pins">
              <For each={pinned()}>
                {(item) => (
                  <Show
                    when={item.kind === "channel" ? item.channel : undefined}
                    fallback={
                      <Show when={item.kind === "agent" ? item.agent : undefined}>
                        {(agent) => (
                          <button type="button" class="ph-pin" onClick={() => props.onOpenAgent(agent().id)}>
                            <span class="ph-avatar">
                              <AgentAvatar
                                agent={avatarAgent(agent(), state())}
                                motion="idle"
                                transition="cut"
                                style={{ width: "58px", height: "58px" }}
                              />
                              <UnreadBadge count={state().unread[agent().id] ?? 0} />
                            </span>
                            <span class="ph-pin-name">{agent().name}</span>
                          </button>
                        )}
                      </Show>
                    }
                  >
                    {(channel) => (
                      <button type="button" class="ph-pin" onClick={() => props.onOpenChannel(channel().id)}>
                        <span class="ph-avatar ph-pin-channel">
                          <ChannelAvatar
                            members={channel().members}
                            agents={composerAgents(state().agents, state())}
                            icon={channel().icon ?? null}
                            layout="cluster"
                          />
                          <UnreadBadge count={channel().unreadCount} />
                        </span>
                        <span class="ph-pin-name">{channel().name}</span>
                      </button>
                    )}
                  </Show>
                )}
              </For>
            </div>
          </Show>
          <For each={shownFolders()}>
            {(folder) => (
              <section class="ph-folder" style={{ "--ph-folder-depth": folder.depth }}>
                <h2 class="ph-section">
                  <button
                    type="button"
                    class="ph-folder-toggle"
                    aria-expanded={closed().has(folder.id) ? "false" : "true"}
                    onClick={() => toggleFolder(folder.id)}
                  >
                    <ChevronRight size={14} aria-hidden="true" class="ph-folder-chevron" />
                    <span dir="auto">{folder.name}</span>
                  </button>
                </h2>
                <Show when={!closed().has(folder.id)}>
                  <For
                    each={inFolder(folder.id)}
                    fallback={<p class="ph-folder-empty">{t("extension.home.emptyFolder")}</p>}
                  >
                    {(item) => <ItemRow item={item} {...props} />}
                  </For>
                </Show>
              </section>
            )}
          </For>
          <Show when={unfiled().length > 0}>
            <h2 class="ph-section">{t("extension.home.chats")}</h2>
            <For each={unfiled()}>{(item) => <ItemRow item={item} {...props} />}</For>
          </Show>
        </Show>
      </div>
      <div class="ext-bottom-bar">
        <form class="ext-field ph-search" onSubmit={submit}>
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            value={query()}
            placeholder={t("extension.home.search")}
            aria-label={t("extension.home.search")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </form>
      </div>
    </div>
  );
}

function ItemRow(props: HomeScreenProps & { item: ChatItem }) {
  return (
    <Show
      when={props.item.kind === "channel" ? props.item.channel : undefined}
      fallback={
        <Show when={props.item.kind === "agent" ? props.item.agent : undefined}>
          {(agent) => <AgentRow agent={agent()} workspace={props.workspace} onOpen={props.onOpenAgent} />}
        </Show>
      }
    >
      {(channel) => <ChannelRow channel={channel()} workspace={props.workspace} onOpen={props.onOpenChannel} />}
    </Show>
  );
}

function ChannelRow(props: { channel: ChannelSummary; workspace: Workspace; onOpen: (channelId: string) => void }) {
  const { t, format } = useText();
  const state = () => props.workspace.state;
  const preview = () => {
    const last = props.channel.lastMessage;
    if (props.channel.activeTasks > 0) return t("extension.channel.working");
    return last
      ? `${last.authorName}: ${last.text}`
      : t("extension.channel.members", { count: props.channel.members.length });
  };
  return (
    <button type="button" class="ph-row" onClick={() => props.onOpen(props.channel.id)}>
      <span class="ph-avatar">
        <ChannelAvatar
          members={props.channel.members}
          agents={composerAgents(state().agents, state())}
          icon={props.channel.icon ?? null}
          layout="cluster"
        />
        <UnreadBadge count={props.channel.unreadCount} />
      </span>
      <span class="ph-row-text">
        <span class="ph-row-line">
          <span class="ph-row-name">{props.channel.name}</span>
          <span class="ph-row-time">{rowTime(props.channel.lastMessage?.at ?? props.channel.createdAt, format)}</span>
        </span>
        <span class="ph-row-preview">{preview()}</span>
      </span>
    </button>
  );
}

function AgentRow(props: { agent: ClientAgentSummary; workspace: Workspace; onOpen: (agentId: string) => void }) {
  const { format } = useText();
  const state = () => props.workspace.state;
  return (
    <button type="button" class="ph-row" onClick={() => props.onOpen(props.agent.id)}>
      <span class="ph-avatar">
        <AgentAvatar agent={avatarAgent(props.agent, state())} motion="idle" transition="cut" />
        <UnreadBadge count={state().unread[props.agent.id] ?? 0} />
      </span>
      <span class="ph-row-text">
        <span class="ph-row-line">
          <span class="ph-row-name">{props.agent.name}</span>
          <span class="ph-row-time">{rowTime(props.agent.updatedAt, format)}</span>
        </span>
        <span class="ph-row-preview">{props.agent.preview}</span>
      </span>
    </button>
  );
}

function UnreadBadge(props: { count: number }) {
  const { t, format } = useText();
  return (
    <Show when={props.count > 0}>
      <span class="ph-unread" aria-hidden="true">
        {format.number(Math.min(props.count, 99))}
      </span>
      <span class="sr-only">{t("extension.home.unread", { count: props.count })}</span>
    </Show>
  );
}
