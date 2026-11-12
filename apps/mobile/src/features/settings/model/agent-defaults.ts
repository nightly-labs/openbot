import {
  type AgentDefaultChoice,
  type AgentDefaultSetting,
  type AgentDefaultsAgentValues,
  type AgentDefaultsOverview,
  agentDefaultChoiceValues,
  type UpdateAgentDefaultsInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { type ServerRowState, serverRowState } from "@/features/workspace/model/server-row-state";
import type { MobileWorkspaceState, ServerChecks } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The choices of one agent for one setting, in menu order. */
export const AGENT_DEFAULT_CHOICE_ORDER: readonly AgentDefaultChoice[] = ["default", "on", "off"];

/** The settings in page order, with the title and description that the agent settings show. */
export const AGENT_DEFAULT_SETTINGS = [
  { key: "allowAutomation", title: "mobile.agent.host.automation", description: "mobile.agent.host.automationFooter" },
  { key: "allowNewChat", title: "mobile.agent.agentNewChat.title", description: "mobile.agent.agentNewChat.footer" },
  {
    key: "quickAcknowledgement",
    title: "mobile.agent.planCard.label",
    description: "mobile.settings.agents.planCardFooter",
  },
  { key: "busyMessageMode", title: "mobile.settings.agents.steer", description: "mobile.settings.agents.steerFooter" },
] as const satisfies ReadonlyArray<{ key: AgentDefaultSetting; title: MobileTextKey; description: MobileTextKey }>;

export type AgentDefaultSettingInfo = (typeof AGENT_DEFAULT_SETTINGS)[number];

/** The setting of a route parameter, or null when the parameter is not a setting. */
export function agentDefaultSettingInfo(value: string | undefined): AgentDefaultSettingInfo | null {
  return AGENT_DEFAULT_SETTINGS.find((setting) => setting.key === value) ?? null;
}

/** The default of a setting. For "Steer agents while they work", on is Steer. */
export function agentDefaultOn(overview: AgentDefaultsOverview, setting: AgentDefaultSetting): boolean {
  return setting === "busyMessageMode" ? overview.busyMessageMode === "steer" : overview.defaults[setting];
}

/** The change of the default of a setting. */
export function agentDefaultInput(setting: AgentDefaultSetting, on: boolean): UpdateAgentDefaultsInput {
  switch (setting) {
    case "busyMessageMode":
      return { busyMessageMode: on ? "steer" : "queue" };
    case "allowAutomation":
      return { allowAutomation: on };
    case "allowNewChat":
      return { allowNewChat: on };
    case "quickAcknowledgement":
      return { quickAcknowledgement: on };
  }
}

/** The own value of the agent, or "default" when it has none and follows the default. */
export function agentDefaultChoice(agent: AgentDefaultsAgentValues, setting: AgentDefaultSetting): AgentDefaultChoice {
  const own = agent[setting];
  if (own === null) return "default";
  if (setting === "busyMessageMode") return own === "steer" ? "on" : "off";
  return own ? "on" : "off";
}

/** True when the setting applies to the agent, from its own value or from the default. */
export function agentDefaultApplies(
  overview: AgentDefaultsOverview,
  agent: AgentDefaultsAgentValues,
  setting: AgentDefaultSetting,
): boolean {
  const choice = agentDefaultChoice(agent, setting);
  return choice === "default" ? agentDefaultOn(overview, setting) : choice === "on";
}

/** The overview after a choice, so the page shows it during the save. */
function withChoice(
  overview: AgentDefaultsOverview,
  agentIds: readonly string[],
  setting: AgentDefaultSetting,
  choice: AgentDefaultChoice,
): AgentDefaultsOverview {
  const ids = new Set(agentIds);
  const values = agentDefaultChoiceValues(setting, choice);
  return {
    ...overview,
    agents: overview.agents.map<AgentDefaultsAgentValues>((agent) =>
      ids.has(agent.agentId) ? { ...agent, ...values } : agent,
    ),
  };
}

/** The overview after a change of the defaults, so the page shows it during the save. */
function withDefaults(overview: AgentDefaultsOverview, input: UpdateAgentDefaultsInput): AgentDefaultsOverview {
  const { busyMessageMode, ...defaults } = input;
  return {
    ...overview,
    defaults: { ...overview.defaults, ...defaults },
    busyMessageMode: busyMessageMode ?? overview.busyMessageMode,
  };
}

const permits = (serverId: string) => (checks: ServerChecks) => checks.canManageAgentDefaults(serverId);

/**
 * The servers whose agent defaults this member can change: `enabled` while the server is online,
 * `disabled` while it is not connected but served `agent-defaults-v1` at its last connection.
 */
export function agentDefaultsServers(
  workspace: Pick<MobileWorkspaceState, "knownServerChecks" | "servers"> & ServerChecks,
): { serverId: string; state: Exclude<ServerRowState, "hidden"> }[] {
  return workspace.servers.flatMap((server) => {
    const state = serverRowState(workspace, server.id, permits(server.id));
    return state === "hidden" ? [] : [{ serverId: server.id, state }];
  });
}

/** One agent of the overview, with the name and the avatar of the workspace agent list. */
export interface AgentDefaultsRow {
  agent: MobileAgent;
  values: AgentDefaultsAgentValues;
}

/**
 * Settings > Agents of one server (`agent-defaults-v1`). The server page and each setting page read
 * one query, so a change on a setting page shows on the server page. A change saves at once, shows
 * during the save, and goes back on a failure. The host checks the role again on every call.
 */
export function useAgentDefaults(serverId: string) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { loadAgentDefaults, updateAgentDefaults, setAgentDefaultChoice } = useMobileWorkspaceActions();
  const rowState = useMobileWorkspaceSelector((workspace) => serverRowState(workspace, serverId, permits(serverId)));
  const server = useMobileWorkspaceSelector((workspace) =>
    workspace.servers.find((candidate) => candidate.id === serverId),
  );
  const workspaceAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const online = rowState === "enabled";
  const queryKey = queryKeys.agentDefaults(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: online,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
    queryFn: () => loadAgentDefaults(serverId),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap can come before the render that disables the control, and it would save from the same value.
  const pending = useRef(false);
  const overview = query.data ?? null;

  // The order of the workspace agent list. The host does not list an agent that it hides from this
  // member, and the page cannot name an agent that the workspace does not know.
  const agents = useMemo<AgentDefaultsRow[]>(() => {
    if (!overview) return [];
    const values = new Map(overview.agents.map((agent) => [agent.agentId, agent]));
    return workspaceAgents.flatMap((agent) => {
      const own = agent.serverId === serverId ? values.get(agent.id) : undefined;
      return own ? [{ agent, values: own }] : [];
    });
  }, [overview, workspaceAgents, serverId]);

  async function save(
    change: (current: AgentDefaultsOverview) => AgentDefaultsOverview,
    send: () => Promise<AgentDefaultsOverview>,
  ): Promise<void> {
    const current = queryClient.getQueryData<AgentDefaultsOverview | null>(queryKey);
    if (pending.current || !current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    // A read that an `agents-changed` event started must not put the old value back after the save.
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<AgentDefaultsOverview | null>(queryKey, change(current));
    try {
      queryClient.setQueryData<AgentDefaultsOverview | null>(queryKey, await send());
      void haptics.notification("success");
    } catch (cause) {
      queryClient.setQueryData<AgentDefaultsOverview | null>(queryKey, current);
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.host.failed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return {
    server,
    rowState,
    online,
    query,
    overview,
    agents,
    error,
    /** Controls take changes only while the server is online and no save runs. */
    enabled: online && !saving && overview !== null,
    updateDefaults: (input: UpdateAgentDefaultsInput) =>
      save(
        (current) => withDefaults(current, input),
        () => updateAgentDefaults(input, serverId),
      ),
    setChoice: (agentIds: readonly string[], setting: AgentDefaultSetting, choice: AgentDefaultChoice) =>
      save(
        (current) => withChoice(current, agentIds, setting, choice),
        () => setAgentDefaultChoice({ agentIds: [...agentIds], setting, choice }, serverId),
      ),
  };
}
