import {
  type AgentDefaultChoice,
  type AgentDefaultSetting,
  type AgentDefaultsAgentValues,
  type AgentDefaultsOverview,
  agentDefaultChoiceValues,
  type OpenBotDesktopApi,
  type UpdateAgentDefaultsInput,
} from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, ItemGroup, SettingsSection } from "@openbot/ui";
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
import { ServerMediaApprovalSetting } from "./ServerMediaApprovalSetting";
import { ServerTimezoneSetting } from "./ServerTimezoneSetting";
import { ServerTurnLimitsSetting } from "./ServerTurnLimitsSetting";
import { ServerVoiceModelSetting } from "./ServerVoiceModelSetting";
import { serverCanAdminister, serverHasAgentDefaults } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export type HostAgentDefaultsCalls = Pick<
  OpenBotDesktopApi["agent"],
  "getAgentDefaultsOverview" | "updateAgentDefaultsOverview" | "setAgentDefaultChoice"
>;

export interface ServerAgentDefaultsOptions {
  calls?: HostAgentDefaultsCalls;
  listAgents: () => Promise<readonly RoleAgent[]>;
  onAgentsChanged?: (listener: (serverId: string) => void) => () => void;
}

interface AgentsState {
  overview: AgentDefaultsOverview | null;
  profiles: readonly RoleAgent[];
  loadFailed: boolean;
  setting: AgentDefaultSetting | null;
}

export interface ServerAgentsSection {
  available: () => boolean;
  Panel: () => JSX.Element;
  crumb: () => { title: string; back: () => void } | null;
  resetForServer(): void;
}

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

export function createServerAgentsSection(
  host: ServerSettingsSectionHost,
  visible: () => boolean,
): ServerAgentsSection {
  const { t } = useText();
  const { props, local, actionsAvailable, busy, run } = host;
  const calls = (): HostAgentDefaultsCalls => props.agentDefaults?.calls ?? window.openbot.agent;
  const [state, setState] = createStore<AgentsState>({
    overview: null,
    profiles: [],
    loadFailed: false,
    setting: null,
  });
  let generation = 0;
  let writeGeneration = 0;
  let writes = 0;
  let reloadAfterWrites = false;

  const defaultsAvailable = () => Boolean(props.agentDefaults) && serverHasAgentDefaults(props.server);
  const timezone = () =>
    serverCanAdminister(props.server, "host-timezone-v1") && actionsAvailable() ? props.hostTimezone : undefined;
  const turnLimits = () =>
    serverCanAdminister(props.server, "host-turn-limits-v1") && actionsAvailable() ? props.hostTurnLimits : undefined;
  const voiceModel = () =>
    !local() && serverCanAdminister(props.server, "host-voice-model-v1") && actionsAvailable()
      ? props.hostVoiceModel
      : undefined;
  const mediaApprovalCredits = () =>
    serverCanAdminister(props.server, "media-approval-credits-v1") && actionsAvailable()
      ? props.mediaApprovalCredits
      : undefined;
  const available = () =>
    defaultsAvailable() || Boolean(timezone() || turnLimits() || voiceModel() || mediaApprovalCredits());

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

  const shown = () => props.open && visible() && defaultsAvailable();

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

  createEffect(
    () => (shown() ? props.server.id : null),
    (serverId) => {
      if (serverId) untrack(() => load(serverId));
      else showList();
    },
  );

  const agents = (): AgentDefaultsAgent[] => {
    const overview = state.overview;
    if (!overview) return [];
    const values = new Map(overview.agents.map((item) => [item.agentId, item]));
    return state.profiles.flatMap((profile) => {
      const own = values.get(profile.id);
      return own ? [{ ...profile, ...ownValues(own) }] : [];
    });
  };

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

  const scope = () => (local() ? "computer" : "server");

  function Panel() {
    return (
      <>
        <Show when={!state.setting && (timezone() || turnLimits())}>
          <SettingsSection title={t("server.settings.threadsCard")}>
            <ItemGroup class="settings-modal-card">
              <Show when={timezone()}>
                {(options) => (
                  <ServerTimezoneSetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={host.menuMount()}
                    run={run}
                  />
                )}
              </Show>
              <Show when={turnLimits()}>
                {(options) => (
                  <ServerTurnLimitsSetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={host.menuMount()}
                    run={run}
                  />
                )}
              </Show>
            </ItemGroup>
          </SettingsSection>
        </Show>
        <Show when={!state.setting && mediaApprovalCredits()}>
          {(options) => (
            <SettingsSection title={t("server.settings.creditsCard")}>
              <ItemGroup class="settings-modal-card">
                <ServerMediaApprovalSetting
                  {...options()}
                  serverId={props.server.id}
                  disabled={Boolean(busy())}
                  run={run}
                />
              </ItemGroup>
            </SettingsSection>
          )}
        </Show>
        <Show when={!state.setting && voiceModel()}>
          {(options) => (
            <ServerVoiceModelSetting
              {...options()}
              serverId={props.server.id}
              disabled={Boolean(busy())}
              menuMount={host.menuMount()}
              run={run}
            />
          )}
        </Show>
        <Show when={defaultsAvailable()}>
          <AgentDefaults />
        </Show>
      </>
    );
  }

  function AgentDefaults() {
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
            scope={scope()}
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
