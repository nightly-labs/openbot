import {
  HOST_AGENT_TASK_LIMIT_MAX,
  HOST_TURN_LIMIT_MAX,
  type HostTurnLimit,
  type HostTurnLimits,
  type HostTurnLimitsInput,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Gauge from "lucide-react-native/icons/gauge";
import Layers from "lucide-react-native/icons/layers";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type TurnLimitChoice = "default" | HostTurnLimit;
type AgentTaskLimitChoice = "default" | number;

const TURN_LIMIT_CHOICES: readonly TurnLimitChoice[] = [
  "default",
  "unlimited",
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  HOST_TURN_LIMIT_MAX,
];

const AGENT_TASK_LIMIT_CHOICES: readonly AgentTaskLimitChoice[] = [
  "default",
  1,
  2,
  4,
  8,
  16,
  32,
  HOST_AGENT_TASK_LIMIT_MAX,
];

function choicesWith<Choice extends string | number>(choices: readonly Choice[], saved: Choice): readonly Choice[] {
  if (choices.includes(saved)) return choices;
  const named = choices.filter((choice) => typeof choice === "string");
  const counts = [...choices, saved].filter((choice) => typeof choice === "number").sort((left, right) => left - right);
  return [...named, ...counts];
}

interface LimitRowProps<Choice extends string | number> {
  icon: LucideIcon;
  title: string;
  description: string;
  error: string | null;
  value: Choice | undefined;
  choices: readonly Choice[];
  label: (choice: Choice) => string;
  enabled: boolean;
  onChange: (choice: Choice) => void;
}

function LimitRow<Choice extends string | number>(props: LimitRowProps<Choice>) {
  const { theme } = useUniwind();
  const { value } = props;
  return (
    <SettingsSection footer={props.error ?? props.description}>
      <SettingsRow
        leading={<RowIcon icon={props.icon} />}
        disclosure={false}
        trailing={
          value === undefined ? null : (
            <SettingsPicker<Choice>
              value={value}
              options={choicesWith(props.choices, value).map((choice) => ({
                value: choice,
                label: props.label(choice),
              }))}
              enabled={props.enabled}
              dark={theme === "dark"}
              label={props.title}
              onChange={props.onChange}
            />
          )
        }
      >
        <Typography.Paragraph>{props.title}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function ServerTurnLimitsRows({ serverId }: { serverId: string }) {
  const { t, errorMessage, format } = useText();
  const { loadServerTurnLimits, setServerTurnLimits } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverTurnLimits(useQueryScope(), serverId);
  const query = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadServerTurnLimits(serverId),
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = query.data;

  function save(limits: HostTurnLimits, change: Partial<HostTurnLimitsInput>) {
    const input: HostTurnLimitsInput = {
      turnLimit: limits.turnLimit,
      agentTaskLimit: limits.agentTaskLimit,
      ...change,
    };
    if (saving || (input.turnLimit === limits.turnLimit && input.agentTaskLimit === limits.agentTaskLimit)) return;
    void haptics.selection();
    setSaving(true);
    setSaveError(null);
    setServerTurnLimits(input, serverId)
      .then(async (saved) => {
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData(queryKey, saved);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setSaveError(errorMessage(cause, t("mobile.server.settings.turnLimitsSaveFailed")));
      })
      .finally(() => setSaving(false));
  }

  const error =
    saveError ?? (query.isError ? errorMessage(query.error, t("mobile.server.settings.turnLimitsLoadFailed")) : null);
  const turnLimitLabel = (choice: TurnLimitChoice) => {
    if (choice === "unlimited") return t("mobile.server.settings.turnLimitUnlimited");
    if (choice !== "default") return format.number(choice);
    const automatic = current?.automaticTurnLimit ?? null;
    return automatic === null
      ? t("mobile.server.settings.turnLimitAutomaticUnlimited")
      : t("mobile.server.settings.turnLimitAutomatic", { count: automatic });
  };
  const agentTaskLimitLabel = (choice: AgentTaskLimitChoice) =>
    choice === "default"
      ? t("mobile.server.settings.agentTaskLimitDefault", { count: current?.defaultAgentTaskLimit ?? 0 })
      : format.number(choice);
  return (
    <>
      <LimitRow<TurnLimitChoice>
        icon={Gauge}
        title={t("mobile.server.settings.turnLimit")}
        description={t("mobile.server.settings.turnLimitDescription")}
        error={error}
        value={current ? (current.turnLimit ?? "default") : undefined}
        choices={TURN_LIMIT_CHOICES}
        label={turnLimitLabel}
        enabled={!saving}
        onChange={(choice) => {
          if (current) save(current, { turnLimit: choice === "default" ? null : choice });
        }}
      />
      <LimitRow<AgentTaskLimitChoice>
        icon={Layers}
        title={t("mobile.server.settings.agentTaskLimit")}
        description={t("mobile.server.settings.agentTaskLimitDescription")}
        error={null}
        value={current ? (current.agentTaskLimit ?? "default") : undefined}
        choices={AGENT_TASK_LIMIT_CHOICES}
        label={agentTaskLimitLabel}
        enabled={!saving}
        onChange={(choice) => {
          if (current) save(current, { agentTaskLimit: choice === "default" ? null : choice });
        }}
      />
    </>
  );
}
