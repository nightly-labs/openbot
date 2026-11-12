import {
  type AgentDefaultChoice,
  type AgentDefaultSetting,
  type AgentDefaultsAgentValues,
  type AgentDefaultsOverview,
  agentDefaultChoiceValues,
  type OpenBotDesktopApi,
  type UpdateAgentDefaultsInput,
} from "@openbot/contracts/ipc";
import { AGENT_DEFAULTS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import { Alert, AlertContent, AlertDescription } from "@openbot/ui";
import type { RoleAgent } from "@openbot/ui/features/servers/ServerRoles";
import {
  type AgentDefaultsAgent,
  agentDefaultSettingTitle,
  SettingsAgentsTab,
} from "@openbot/ui/features/settings/SettingsAgentsTab";
import { currentText, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, onSettled, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { serverCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

/** The agent default calls of one server's host. The desktop reaches them through main. */
export type HostAgentDefaultsCalls = Pick<
  OpenBotDesktopApi["agent"],
  "getAgentDefaultsOverview" | "updateAgentDefaultsOverview" | "setAgentDefaultChoice"
>;

export interface ServerAgentDefaultsOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostAgentDefaultsCalls;
  /** The agents of this dialog's server, for their names and faces. */
  listAgents: () => Promise<readonly RoleAgent[]>;
  /**
   * Calls `listener` with the server id on each `agents-changed` event of a host, for a client with no
   * `window.openbot`. Returns the unsubscribe function.
   */
  onAgentsChanged?: (listener: (serverId: string) => void) => () => void;
}

interface AgentsState {
  /** The host answer, or null before it loads. */
  overview: AgentDefaultsOverview | null;
  /** The agents of the server, for their names and faces. */
  profiles: readonly RoleAgent[];
  loadFailed: boolean;
  setting: AgentDefaultSetting | null;
}

export interface ServerAgentsSection {
  /** True when this account changes the agent defaults of this server: the Agents tab shows then. */
  available: () => boolean;
  Panel: () => JSX.Element;
  /** The setting page, for the dialog header `Agents › Local scripts`. */
  crumb: () => { title: string; back: () => void } | null;
  resetForServer(): void;
}

/** The own values of one agent as the Agents tab reads them. Null (follow the default) becomes absent. */
function ownValues(values: AgentDefaultsAgentValues): Omit<AgentDefaultsAgent, keyof RoleAgent> {
  return {
    ...(values.allowAutomation === null ? {} : { allowAutomation: values.allowAutomation }),
    ...(values.allowNewChat === null ? {} : { allowNewChat: values.allowNewChat }),
    ...(values.quickAcknowledgement === null ? {} : { quickAcknowledgement: values.quickAcknowledgement }),
    ...(values.busyMessageMode === null ? {} : { busyMessageMode: values.busyMessageMode }),
  };
}

function showSaveFailure(error: unknown): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t("agent.error.settingsFailed")), {
    id: "server-settings-agent-defaults-save-failed",
    report: { operation: "settings", source: "action", cause_code: "unknown" },
  });
}

/**
 * Server Settings > Agents (`agent-defaults-v1`): the agent defaults of a joined server, and each
 * agent's own value. An owner or admin changes them. This computer uses Settings > Agents.
 */
export function createServerAgentsSection(
  host: ServerSettingsSectionHost,
  visible: () => boolean,
): ServerAgentsSection {
  const { t } = useText();
  const { props, local, actionsAvailable } = host;
  const calls = (): HostAgentDefaultsCalls => props.agentDefaults?.calls ?? window.openbot.agent;
  const [state, setState] = createStore<AgentsState>({
    overview: null,
    profiles: [],
    loadFailed: false,
    setting: null,
  });
  /** Bumped for each read, so an answer for an earlier server or read is dropped. */
  let generation = 0;
  /** Bumped for each change, so only the answer of the last change is applied. */
  let writeGeneration = 0;
  /** The changes in flight. A read that ends during a change can be older than the change, so it is dropped. */
  let writes = 0;
  /** A change failed while another was in flight: read again when the last one ends. */
  let reloadAfterWrites = false;

  const available = () =>
    Boolean(props.agentDefaults) &&
    !local() &&
    actionsAvailable() &&
    serverCanAdminister(props.server, AGENT_DEFAULTS_CAPABILITY);

  function load(serverId: string): void {
    const options = props.agentDefaults;
    if (!options) return;
    const current = ++generation;
    Promise.all([calls().getAgentDefaultsOverview(serverId), options.listAgents()]).then(
      ([overview, profiles]) => {
        if (current !== generation || writes > 0) return;
        setState((draft) => {
          draft.overview = overview;
          draft.profiles = [...profiles];
          draft.loadFailed = false;
        });
      },
      () => {
        if (current !== generation) return;
        setState((draft) => {
          draft.loadFailed = true;
        });
      },
    );
  }

  function showList(): void {
    setState((draft) => {
      draft.setting = null;
    });
  }

  const shown = () => props.open && visible() && available();

  // The host sends `agents-changed` after a change from another device, such as a phone, so the open
  // section reads again.
  onSettled(() => {
    const listener = (serverId: string) => {
      if (serverId === props.server.id && shown()) load(serverId);
    };
    const options = props.agentDefaults;
    if (!options) return;
    if (options.onAgentsChanged) return options.onAgentsChanged(listener);
    return window.openbot.agent.onScopedEvent(({ serverId, event }) => {
      if (event.type === "agents-changed") listener(serverId);
    });
  });

  // Read again each time the section shows, so changes from another device appear.
  createEffect(
    () => (shown() ? props.server.id : null),
    (serverId) => {
      if (serverId) untrack(() => load(serverId));
      else showList();
    },
  );

  /** The agents of the server that the host lists, with their own values. */
  const agents = (): AgentDefaultsAgent[] => {
    const overview = state.overview;
    if (!overview) return [];
    const values = new Map(overview.agents.map((item) => [item.agentId, item]));
    return state.profiles.flatMap((profile) => {
      const own = values.get(profile.id);
      return own ? [{ ...profile, ...ownValues(own) }] : [];
    });
  };

  /** Sends one change. The answer replaces the overview; a failure shows a toast and reads again. */
  function save(
    serverId: string,
    change: (draft: AgentDefaultsOverview) => void,
    send: () => Promise<AgentDefaultsOverview>,
  ): void {
    const current = ++writeGeneration;
    writes++;
    setState((draft) => {
      if (draft.overview) change(draft.overview);
    });
    send()
      .then(
        (overview) => {
          if (current !== writeGeneration || serverId !== props.server.id) return;
          setState((draft) => {
            draft.overview = overview;
          });
        },
        (error: unknown) => {
          showSaveFailure(error);
          reloadAfterWrites = true;
        },
      )
      .finally(() => {
        writes--;
        // The host has the true values after a failure. A read while other changes run is dropped,
        // so it starts when the last change ends.
        if (writes > 0 || !reloadAfterWrites) return;
        reloadAfterWrites = false;
        if (serverId === props.server.id) load(serverId);
      });
  }

  function updateDefaults(input: UpdateAgentDefaultsInput): void {
    const serverId = props.server.id;
    save(
      serverId,
      (overview) => {
        const { busyMessageMode, ...defaults } = input;
        if (busyMessageMode) overview.busyMessageMode = busyMessageMode;
        Object.assign(overview.defaults, defaults);
      },
      () => calls().updateAgentDefaultsOverview(input, serverId),
    );
  }

  function changeChoice(agentIds: readonly string[], setting: AgentDefaultSetting, choice: AgentDefaultChoice): void {
    const serverId = props.server.id;
    const values = agentDefaultChoiceValues(setting, choice);
    save(
      serverId,
      (overview) => {
        for (const item of overview.agents) if (agentIds.includes(item.agentId)) Object.assign(item, values);
      },
      () => calls().setAgentDefaultChoice({ agentIds: [...agentIds], setting, choice }, serverId),
    );
  }

  function Panel() {
    return (
      <Show
        when={state.overview}
        fallback={
          <Show when={state.loadFailed}>
            <Alert tone="danger" role="alert">
              <AlertContent>
                <AlertDescription>{t("settings.agentDefaults.loadFailed")}</AlertDescription>
              </AlertContent>
            </Alert>
          </Show>
        }
      >
        {(overview) => (
          <SettingsAgentsTab
            scope="server"
            agents={agents()}
            loadFailed={state.loadFailed}
            defaults={overview().defaults}
            steer={overview().busyMessageMode === "steer"}
            setting={state.setting}
            menuMount={host.menuMount()}
            onOpen={(setting) =>
              setState((draft) => {
                draft.setting = setting;
              })
            }
            onDefaultChange={(setting, on) =>
              updateDefaults(
                setting === "busyMessageMode" ? { busyMessageMode: on ? "steer" : "queue" } : { [setting]: on },
              )
            }
            onPlanStartChange={(planStartAfterMs) => updateDefaults({ planStartAfterMs })}
            onAutomationLimitChange={(automationRunsPerHour) => updateDefaults({ automationRunsPerHour })}
            onCommitCoAuthorChange={(commitCoAuthor) => updateDefaults({ commitCoAuthor })}
            onChoiceChange={changeChoice}
          />
        )}
      </Show>
    );
  }

  return {
    available,
    Panel,
    crumb() {
      const setting = state.setting;
      if (!setting) return null;
      return { title: t(agentDefaultSettingTitle(setting)), back: showList };
    },
    resetForServer() {
      generation++;
      writeGeneration++;
      setState((draft) => {
        draft.overview = null;
        draft.profiles = [];
        draft.loadFailed = false;
        draft.setting = null;
      });
    },
  };
}
