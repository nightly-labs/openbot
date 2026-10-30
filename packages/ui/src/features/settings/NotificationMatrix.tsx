import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import { Badge, Bell, BellOff, Button, buttonVariants, DropdownMenu, Input, ItemGroup, Text, toast } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import {
  SERVER_MUTE_CHOICES,
  SERVER_NOTIFICATION_LEVEL_LABELS,
  serverMuteDescription,
} from "../servers/ServerActionItems";

/** One agent row: the user's own level, or null when the agent uses the level of its server. */
export interface NotificationMatrixAgent {
  id: string;
  name: string;
  /** The role or the description of the agent, under its name. */
  detail: string;
  /** The agent switch "Notifications" is off for everyone on the server. */
  sharedOff: boolean;
  level: ServerNotificationLevel | null;
}

/**
 * The agents of a server. `unsupported`: the server cannot keep a level for each agent, so the user
 * must update OpenBot on it first.
 */
export type NotificationMatrixAgents =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "unsupported" }
  | { status: "ready"; agents: readonly NotificationMatrixAgent[] };

export interface NotificationMatrixServer {
  id: string;
  name: string;
  /** The level that applies now: the level for all devices of the user, else the level of this device. */
  level: ServerNotificationLevel;
  muted: boolean;
  /** When a timed mute ends, in epoch milliseconds. Null for no mute or a mute without an end. */
  mutedUntil: number | null;
  offline: boolean;
  /** The server cannot keep the level of the user, so a change applies to this device only. */
  deviceOnly: boolean;
  agents: NotificationMatrixAgents;
  /** Whether this device can turn on an agent that is off for every member. Absent means it can. */
  canTurnOnAgents?: boolean | undefined;
}

export interface NotificationMatrixProps {
  servers: readonly NotificationMatrixServer[];
  /** The device that keeps the level of a server that cannot keep it. */
  device: "computer" | "browser";
  /** Resolves after the new level shows in `servers`. A rejection shows the previous level again. */
  onSetServerLevel: (serverId: string, level: ServerNotificationLevel) => Promise<void>;
  /** `null` gives the agent the level of its server again. */
  onSetAgentLevel: (serverId: string, agentId: string, level: ServerNotificationLevel | null) => Promise<void>;
  /** `durationMs` null mutes until the user unmutes. */
  onMute: (serverId: string, durationMs: number | null) => Promise<void>;
  onUnmute: (serverId: string) => Promise<void>;
  /**
   * Turns on an agent that a member turned off for every member with the agent switch of earlier
   * versions. The host keeps that switch, so this table is the one place that turns it on again.
   * Without it, such an agent shows disabled choices.
   */
  onTurnOnAgent?: ((serverId: string, agentId: string) => Promise<void>) | undefined;
  /** Reads the agents of a server again after a failed read. */
  onRetry?: ((serverId: string) => void) | undefined;
  /** Scrolls to a server row and moves the focus to it. Each nonce moves once. */
  focusRequest?: { serverId: string; nonce: number } | null | undefined;
  /** Where the mute menu shows. Without it, the menu shows in the document body. */
  menuMount?: HTMLElement | undefined;
  /** The anchor of the settings search. */
  "data-settings-row"?: string | undefined;
}

/** The level shown while a save runs. `server` shows the level of the server again. */
type PendingAgentLevel = ServerNotificationLevel | "server";

/** The title of a notification section, with a badge that names the devices it applies to. */
export function NotificationScopeTitle(props: { title: JSX.Element; scope?: AppTextKey | undefined }) {
  const { t } = useText();
  return (
    <span class="notification-scope-title">
      {props.title}
      <Show when={props.scope}>{(scope) => <Badge variant="primary-light">{t(scope())}</Badge>}</Show>
    </span>
  );
}

/**
 * One table for the notification levels of every server and its agents. A filled dot is a choice of
 * the user. A ring is the level that an agent takes from its server. The levels apply on all devices
 * of the user; mute applies on this device only.
 */
export function NotificationMatrix(props: NotificationMatrixProps) {
  const { t } = useText();
  const groupId = createUniqueId();
  // Apart from the props, so that a failed save shows the value of the props again.
  const [pending, setPending] = createStore<{
    servers: Record<string, ServerNotificationLevel>;
    agents: Record<string, PendingAgentLevel>;
  }>({ servers: {}, agents: {} });
  const serverRows = new Map<string, HTMLTableRowElement>();
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
    level: ServerNotificationLevel,
  ): Promise<void> {
    // A second click on the chosen level gives the agent the level of its server again.
    const next = agentLevel(server, agent) === level ? null : level;
    const key = agentKey(server.id, agent.id);
    const shown: PendingAgentLevel = next ?? "server";
    setPending((state) => {
      state.agents[key] = shown;
    });
    try {
      await props.onSetAgentLevel(server.id, agent.id, next);
    } catch (error) {
      showFailure(error);
    } finally {
      setPending((state) => {
        if (state.agents[key] === shown) delete state.agents[key];
      });
    }
  }

  /** The agent whose switch for every member turns on now. */
  const [turningOn, setTurningOn] = createSignal<string | null>(null);

  async function runTurnOn(action: () => Promise<void>, agentId: string): Promise<void> {
    setTurningOn(agentId);
    try {
      await action();
    } catch (error) {
      showFailure(error);
    } finally {
      setTurningOn(null);
    }
  }

  function runMute(action: () => Promise<void>): void {
    void action().catch(showFailure);
  }

  createEffect(
    () => props.focusRequest,
    (request) => {
      if (!request || request.nonce === handledFocus) return;
      handledFocus = request.nonce;
      // The row renders with the tab, so it can come one frame after the request.
      requestAnimationFrame(() => {
        const row = serverRows.get(request.serverId);
        if (!row) return;
        row.scrollIntoView({ block: "start" });
        row.querySelector<HTMLElement>("input:checked, input:not(:disabled), button")?.focus({ preventScroll: true });
      });
    },
  );

  const columns = SERVER_NOTIFICATION_LEVELS.length + 2;

  return (
    <div class="notification-matrix">
      <ItemGroup class="settings-modal-card notification-matrix-card">
        <table
          class="notification-matrix-table"
          aria-label={t("settings.notificationMatrix.label")}
          data-settings-row={props["data-settings-row"]}
        >
          {/* Fixed column widths: a change of a level or a mute never moves the columns. */}
          <colgroup>
            <col />
            <For each={SERVER_NOTIFICATION_LEVELS}>{() => <col class="notification-matrix-level-column" />}</For>
            <col class="notification-matrix-mute-column" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t("settings.notificationMatrix.target")}</th>
              <For each={SERVER_NOTIFICATION_LEVELS}>
                {(level) => <th scope="col">{t(SERVER_NOTIFICATION_LEVEL_LABELS[level])}</th>}
              </For>
              <th scope="col">{t("settings.notificationMatrix.mute")}</th>
            </tr>
          </thead>
          {/* Keyed by id: a new summary of a server keeps its radios, and the focus stays on them. */}
          <For each={props.servers} keyed={(server) => server.id}>
            {(server) => (
              <tbody>
                <tr
                  class="notification-matrix-server"
                  ref={(row) => {
                    serverRows.set(server().id, row);
                  }}
                >
                  <th scope="row">
                    <span class="notification-matrix-name">{server().name}</span>
                    <span class="notification-matrix-notes">
                      <Show when={server().offline}>
                        <span>{t("settings.notificationMatrix.offline")}</span>
                      </Show>
                      <Show when={server().deviceOnly}>
                        <span>
                          {props.device === "browser"
                            ? t("settings.notificationMatrix.thisBrowserOnly")
                            : t("settings.notificationMatrix.thisComputerOnly")}
                        </span>
                      </Show>
                    </span>
                  </th>
                  <ChoiceCells
                    name={server().name}
                    group={`${groupId}-${server().id}`}
                    selected={serverLevel(server())}
                    inherited={null}
                    disabled={server().offline}
                    onSelect={(level) => void setServerLevel(server(), level)}
                  />
                  <td class="notification-matrix-cell">
                    <MuteMenu
                      name={server().name}
                      muted={server().muted}
                      mutedUntil={server().mutedUntil}
                      menuMount={props.menuMount}
                      onMute={(durationMs) => runMute(() => props.onMute(server().id, durationMs))}
                      onUnmute={() => runMute(() => props.onUnmute(server().id))}
                    />
                  </td>
                </tr>
                <Show when={!server().offline}>
                  <Switch>
                    <Match when={server().agents.status === "loading"}>
                      <tr class="notification-matrix-status">
                        <td colspan={columns} aria-live="polite">
                          {t("settings.notificationMatrix.loading")}
                        </td>
                      </tr>
                    </Match>
                    <Match when={server().agents.status === "failed"}>
                      <tr class="notification-matrix-status">
                        <td colspan={columns}>
                          <span>{t("settings.notificationMatrix.loadFailed")}</span>
                          <Show when={props.onRetry}>
                            {(retry) => (
                              <Button type="button" size="sm" variant="ghost" onClick={() => retry()(server().id)}>
                                {t("common.retry")}
                              </Button>
                            )}
                          </Show>
                        </td>
                      </tr>
                    </Match>
                    <Match when={server().agents.status === "unsupported"}>
                      <tr class="notification-matrix-status">
                        <td colspan={columns}>{t("settings.notificationMatrix.updateServer")}</td>
                      </tr>
                    </Match>
                    <Match when={readyAgents(server().agents)}>
                      {(agents) => (
                        <For each={agents()} keyed={(agent) => agent.id}>
                          {(agent) => {
                            // A server set to Nothing is silent for every agent.
                            const silent = () => serverLevel(server()) === "nothing";
                            return (
                              <tr class="notification-matrix-agent">
                                {/* The reason for disabled choices is a tooltip, so a change keeps the size of the row. */}
                                <th
                                  scope="row"
                                  title={
                                    agent().sharedOff
                                      ? t("settings.notificationMatrix.sharedOff")
                                      : silent()
                                        ? t("settings.notificationMatrix.serverNothing")
                                        : undefined
                                  }
                                >
                                  <span class="notification-matrix-name">{agent().name}</span>
                                  <Show when={agent().detail}>
                                    <span class="notification-matrix-notes">
                                      <span>{agent().detail}</span>
                                    </span>
                                  </Show>
                                </th>
                                <Show
                                  when={agent().sharedOff && server().canTurnOnAgents !== false && props.onTurnOnAgent}
                                  fallback={
                                    <ChoiceCells
                                      name={agent().name}
                                      group={`${groupId}-${server().id}-${agent().id}`}
                                      selected={agentLevel(server(), agent())}
                                      inherited={serverLevel(server())}
                                      disabled={agent().sharedOff || silent()}
                                      onSelect={(level) => void setAgentLevel(server(), agent(), level)}
                                    />
                                  }
                                >
                                  {(turnOn) => (
                                    <td colspan={SERVER_NOTIFICATION_LEVELS.length} class="notification-matrix-cell">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        aria-label={t("settings.notificationMatrix.turnOnFor", { name: agent().name })}
                                        disabled={turningOn() !== null}
                                        onClick={() =>
                                          void runTurnOn(() => turnOn()(server().id, agent().id), agent().id)
                                        }
                                      >
                                        {t("settings.notificationMatrix.turnOn")}
                                      </Button>
                                    </td>
                                  )}
                                </Show>
                                <td />
                              </tr>
                            );
                          }}
                        </For>
                      )}
                    </Match>
                  </Switch>
                </Show>
              </tbody>
            )}
          </For>
        </table>
      </ItemGroup>
      <Text as="p" class="notification-matrix-hint" variant="caption" tone="muted">
        {t("settings.notificationMatrix.hint")}
      </Text>
    </div>
  );
}

function readyAgents(agents: NotificationMatrixAgents): readonly NotificationMatrixAgent[] | undefined {
  return agents.status === "ready" ? agents.agents : undefined;
}

/**
 * One radio for each level, in one group for the row. `selected` null with `inherited` shows the
 * level that the row takes from its server as a ring.
 */
function ChoiceCells(props: {
  name: string;
  group: string;
  selected: ServerNotificationLevel | null;
  inherited: ServerNotificationLevel | null;
  disabled: boolean;
  onSelect: (level: ServerNotificationLevel) => void;
}) {
  const { t } = useText();
  return (
    <For each={SERVER_NOTIFICATION_LEVELS}>
      {(level) => (
        <td class="notification-matrix-cell">
          <Input
            type="radio"
            class="notification-matrix-choice"
            name={props.group}
            checked={props.selected === level}
            data-inherited={props.selected === null && props.inherited === level ? "" : undefined}
            disabled={props.disabled}
            aria-label={t("settings.notificationMatrix.choice", {
              name: props.name,
              level: t(SERVER_NOTIFICATION_LEVEL_LABELS[level]),
            })}
            // A click on the checked radio fires no change event, and an arrow key also fires a click.
            onClick={() => props.onSelect(level)}
          />
        </td>
      )}
    </For>
  );
}

/** Mute on this device only, with the choices of the server menu. */
function MuteMenu(props: {
  name: string;
  muted: boolean;
  mutedUntil: number | null;
  menuMount: HTMLElement | undefined;
  onMute: (durationMs: number | null) => void;
  onUnmute: () => void;
}) {
  const { t, format } = useText();
  // "Muted until 3:41 PM" is the tooltip of the button, not a line of the row, so the row keeps its size.
  const mutedText = () =>
    props.muted ? serverMuteDescription({ notificationsMutedUntil: props.mutedUntil }, t, format) : undefined;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("settings.notificationMatrix.muteOptions", { name: props.name })}
        title={mutedText()}
      >
        <Show when={props.muted} fallback={<Bell aria-hidden="true" />}>
          <BellOff aria-hidden="true" class="notification-matrix-muted-icon" />
        </Show>
      </DropdownMenu.Trigger>
      {/* A portal without a mount uses the document body. */}
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
