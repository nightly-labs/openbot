import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import {
  Badge,
  Bell,
  BellOff,
  Button,
  buttonVariants,
  DropdownMenu,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Plus,
  SlidingTabs,
  toast,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, For, onCleanup, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { SERVER_MUTE_CHOICES, serverMuteDescription } from "../servers/ServerActionItems";
import { ServerMark } from "../servers/ServerRail";

export interface NotificationMatrixAgent extends Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> {
  id: string;
  name: string;
  detail: string;
  level: ServerNotificationLevel | null;
}

export type NotificationMatrixAgents =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "unsupported" }
  | { status: "ready"; agents: readonly NotificationMatrixAgent[] };

export interface NotificationMatrixServer {
  id: string;
  name: string;
  logoUrl: string | null;
  level: ServerNotificationLevel;
  muted: boolean;
  mutedUntil: number | null;
  offline: boolean;
  deviceOnly: boolean;
  agents: NotificationMatrixAgents;
}

export interface NotificationMatrixProps {
  servers: readonly NotificationMatrixServer[];
  device: "computer" | "browser";
  onSetServerLevel: (serverId: string, level: ServerNotificationLevel) => Promise<void>;
  onSetAgentLevel: (serverId: string, agentId: string, level: ServerNotificationLevel | null) => Promise<void>;
  onMute: (serverId: string, durationMs: number | null) => Promise<void>;
  onUnmute: (serverId: string) => Promise<void>;
  onRetry?: ((serverId: string) => void) | undefined;
  focusRequest?: { serverId: string; nonce: number } | null | undefined;
  menuMount?: HTMLElement | undefined;
  "data-settings-row"?: string | undefined;
}

type PendingAgentLevel = ServerNotificationLevel | "server";

const SHORT_LEVEL_LABELS = {
  all: "settings.notificationMatrix.levelAll",
  "needs-me": "settings.notificationMatrix.levelNeedsMe",
  nothing: "settings.notificationMatrix.levelNothing",
} as const satisfies Record<ServerNotificationLevel, AppTextKey>;

export function NotificationScopeTitle(props: { title: JSX.Element; scope?: AppTextKey | undefined }) {
  const { t } = useText();
  return (
    <span class="notification-scope-title">
      {props.title}
      <Show when={props.scope}>{(scope) => <Badge variant="primary-light">{t(scope())}</Badge>}</Show>
    </span>
  );
}

export function NotificationMatrix(props: NotificationMatrixProps) {
  const { t } = useText();
  const [pending, setPending] = createStore<{
    servers: Record<string, ServerNotificationLevel>;
    agents: Record<string, PendingAgentLevel>;
  }>({ servers: {}, agents: {} });
  const serverCards = new Map<string, HTMLElement>();
  let handledFocus = 0;

  const agentKey = (serverId: string, agentId: string) => `${serverId} ${agentId}`;
  const serverLevel = (server: NotificationMatrixServer) => pending.servers[server.id] ?? server.level;
  const agentLevel = (server: NotificationMatrixServer, agent: NotificationMatrixAgent) => {
    const shown = pending.agents[agentKey(server.id, agent.id)];
    if (shown === "server") return null;
    return shown ?? agent.level;
  };

  function showFailure(error: unknown): void {
    toast.error(t("server.notifications.changeFailedTitle"), {
      error,
      fallback: t("server.notifications.changeFailedDescription"),
      report: { operation: "settings", source: "action", cause_code: classifyFailure(error) },
    });
  }

  async function setServerLevel(server: NotificationMatrixServer, level: ServerNotificationLevel): Promise<void> {
    if (serverLevel(server) === level) return;
    setPending((state) => {
      state.servers[server.id] = level;
    });
    try {
      await props.onSetServerLevel(server.id, level);
    } catch (error) {
      showFailure(error);
    } finally {
      setPending((state) => {
        if (state.servers[server.id] === level) delete state.servers[server.id];
      });
    }
  }

  async function setAgentLevel(
    server: NotificationMatrixServer,
    agent: NotificationMatrixAgent,
    level: ServerNotificationLevel | null,
  ): Promise<void> {
    if (agentLevel(server, agent) === level) return;
    const key = agentKey(server.id, agent.id);
    const shown: PendingAgentLevel = level ?? "server";
    setPending((state) => {
      state.agents[key] = shown;
    });
    try {
      await props.onSetAgentLevel(server.id, agent.id, level);
    } catch (error) {
      showFailure(error);
    } finally {
      setPending((state) => {
        if (state.agents[key] === shown) delete state.agents[key];
      });
    }
  }

  function keepFocusInCard(serverId: string): void {
    requestAnimationFrame(() => {
      const card = serverCards.get(serverId);
      if (!card || card.contains(document.activeElement)) return;
      const lastRow =
        card.querySelector<HTMLElement>(".notification-matrix-add") ??
        [...card.querySelectorAll<HTMLElement>('.notification-matrix-level[aria-selected="true"]')].at(-1);
      lastRow?.focus();
    });
  }

  function runMute(action: () => Promise<void>): void {
    void action().catch(showFailure);
  }

  createEffect(
    () => props.focusRequest,
    (request) => {
      if (!request || request.nonce === handledFocus) return;
      handledFocus = request.nonce;
      requestAnimationFrame(() => {
        const card = serverCards.get(request.serverId);
        if (!card) return;
        card.scrollIntoView({ block: "start" });
        const target =
          card.querySelector<HTMLElement>('.notification-matrix-level[aria-selected="true"]:not(:disabled)') ??
          card.querySelector<HTMLElement>("button:not(:disabled)");
        target?.focus({ preventScroll: true });
      });
    },
  );

  return (
    <div class="notification-matrix" data-settings-row={props["data-settings-row"]}>
      <For each={props.servers} keyed={(server) => server.id}>
        {(server) => {
          const serverId = untrack(() => server().id);
          onCleanup(() => serverCards.delete(serverId));
          const agents = () => readyAgents(server().agents) ?? [];
          const agentsOpen = () => !server().offline && serverLevel(server()) !== "nothing";
          const ownLevels = () => agents().filter((agent) => agentLevel(server(), agent) !== null);
          const serverLevelAgents = () => agents().filter((agent) => agentLevel(server(), agent) === null);
          return (
            <ItemGroup
              class="settings-modal-card"
              ref={(card) => {
                serverCards.set(serverId, card);
              }}
            >
              <Item class="settings-modal-row">
                <ItemMedia class="notification-matrix-server-mark" aria-hidden="true">
                  <ServerMark server={server()} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{server().name}</ItemTitle>
                  <ServerNotes server={server()} device={props.device} />
                </ItemContent>
                <ItemActions>
                  <Show when={!server().offline && server().agents.status === "failed" && props.onRetry}>
                    {(retry) => (
                      <Button type="button" size="sm" variant="ghost" onClick={() => retry()(server().id)}>
                        {t("common.retry")}
                      </Button>
                    )}
                  </Show>
                  <MuteMenu
                    name={server().name}
                    muted={server().muted}
                    menuMount={props.menuMount}
                    onMute={(durationMs) => runMute(() => props.onMute(server().id, durationMs))}
                    onUnmute={() => runMute(() => props.onUnmute(server().id))}
                  />
                  <LevelSegments
                    name={server().name}
                    value={serverLevel(server())}
                    disabled={server().offline}
                    onChange={(level) => void setServerLevel(server(), level)}
                  />
                </ItemActions>
              </Item>
              <Show when={agentsOpen()}>
                <For each={ownLevels()} keyed={(agent) => agent.id}>
                  {(agent) => (
                    <Item class="settings-modal-row notification-matrix-agent" size="compact">
                      <ItemMedia>
                        <AgentFace agent={agent()} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{agent().name}</ItemTitle>
                        <Show when={agent().detail}>{(detail) => <ItemDescription>{detail()}</ItemDescription>}</Show>
                      </ItemContent>
                      <ItemActions>
                        <LevelSegments
                          name={agent().name}
                          value={agentLevel(server(), agent()) ?? serverLevel(server())}
                          onChange={(level) => void setAgentLevel(server(), agent(), level)}
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("settings.notificationMatrix.useServerLevel", {
                            server: server().name,
                            agent: agent().name,
                          })}
                          onClick={() => {
                            void setAgentLevel(server(), agent(), null);
                            keepFocusInCard(server().id);
                          }}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </ItemActions>
                    </Item>
                  )}
                </For>
                <Show when={serverLevelAgents().length > 0}>
                  <AddAgentMenu
                    agents={serverLevelAgents()}
                    another={ownLevels().length > 0}
                    menuMount={props.menuMount}
                    onChoose={(agent) => {
                      void setAgentLevel(server(), agent, firstOtherLevel(serverLevel(server())));
                      keepFocusInCard(server().id);
                    }}
                  />
                </Show>
              </Show>
            </ItemGroup>
          );
        }}
      </For>
    </div>
  );
}

function readyAgents(agents: NotificationMatrixAgents): readonly NotificationMatrixAgent[] | undefined {
  return agents.status === "ready" ? agents.agents : undefined;
}

function firstOtherLevel(level: ServerNotificationLevel): ServerNotificationLevel {
  return level === "all" ? "needs-me" : "all";
}

function isLevel(value: string): value is ServerNotificationLevel {
  return SERVER_NOTIFICATION_LEVELS.some((level) => level === value);
}

function ServerNotes(props: { server: NotificationMatrixServer; device: NotificationMatrixProps["device"] }) {
  const { t, format } = useText();
  const notes = (): string[] => {
    const server = props.server;
    const keys: AppTextKey[] = [];
    if (server.offline) keys.push("settings.notificationMatrix.offline");
    if (server.deviceOnly) {
      keys.push(
        props.device === "browser"
          ? "settings.notificationMatrix.thisBrowserOnly"
          : "settings.notificationMatrix.thisComputerOnly",
      );
    }
    if (!server.offline) {
      if (server.agents.status === "loading") keys.push("settings.notificationMatrix.loading");
      if (server.agents.status === "failed") keys.push("settings.notificationMatrix.loadFailed");
      if (server.agents.status === "unsupported") keys.push("settings.notificationMatrix.updateServer");
    }
    const texts = keys.map((key) => t(key));
    if (server.muted) texts.unshift(serverMuteDescription({ notificationsMutedUntil: server.mutedUntil }, t, format));
    return texts;
  };
  return (
    <Show when={notes().length > 0}>
      <ItemDescription class="notification-matrix-notes" aria-live="polite">
        {notes().join(" · ")}
      </ItemDescription>
    </Show>
  );
}

function AgentFace(props: { agent: NotificationMatrixAgent }) {
  return (
    <span class="integrations-agent-face" data-size="sm">
      <AgentAvatar agent={props.agent} motion="idle" />
    </span>
  );
}

function LevelSegments(props: {
  name: string;
  value: ServerNotificationLevel;
  disabled?: boolean | undefined;
  onChange: (level: ServerNotificationLevel) => void;
}) {
  const { t } = useText();
  return (
    <SlidingTabs.Root
      class="notification-matrix-levels"
      value={props.value}
      disabled={props.disabled === true}
      onChange={(value: string) => {
        if (isLevel(value) && value !== props.value) props.onChange(value);
      }}
    >
      <SlidingTabs.List aria-label={t("settings.notificationMatrix.levelsOf", { name: props.name })}>
        <For each={SERVER_NOTIFICATION_LEVELS}>
          {(level) => (
            <SlidingTabs.Trigger value={level} class="notification-matrix-level">
              {t(SHORT_LEVEL_LABELS[level])}
            </SlidingTabs.Trigger>
          )}
        </For>
      </SlidingTabs.List>
    </SlidingTabs.Root>
  );
}

function AddAgentMenu(props: {
  agents: readonly NotificationMatrixAgent[];
  another: boolean;
  menuMount: HTMLElement | undefined;
  onChoose: (agent: NotificationMatrixAgent) => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4} modal={false}>
      <DropdownMenu.Trigger class="notification-matrix-add">
        <span class="notification-matrix-add-icon">
          <Plus aria-hidden="true" />
        </span>
        <span>
          {props.another
            ? t("settings.notificationMatrix.chooseAnotherAgent")
            : t("settings.notificationMatrix.chooseAgent")}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
        <DropdownMenu.Content>
          <For each={props.agents} keyed={(agent) => agent.id}>
            {(agent) => (
              <DropdownMenu.Item onSelect={() => props.onChoose(agent())}>
                <AgentFace agent={agent()} />
                <span>{agent().name}</span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MuteMenu(props: {
  name: string;
  muted: boolean;
  menuMount: HTMLElement | undefined;
  onMute: (durationMs: number | null) => void;
  onUnmute: () => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("settings.notificationMatrix.muteOptions", { name: props.name })}
      >
        <Show when={props.muted} fallback={<Bell aria-hidden="true" />}>
          <BellOff aria-hidden="true" />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
        <DropdownMenu.Content>
          <Show when={props.muted}>
            <DropdownMenu.Item onSelect={() => props.onUnmute()}>
              <Bell class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("server.rail.unmute")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          </Show>
          <For each={SERVER_MUTE_CHOICES}>
            {(choice) => (
              <DropdownMenu.Item onSelect={() => props.onMute(choice.durationMs ?? null)}>
                <span>{t(choice.label)}</span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
