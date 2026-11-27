import {
  type AgentModelOption,
  type AgentProviderId,
  type AgentReasoningEffort,
  agentProviderName,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type ForeignProviderId,
  type ProviderAccountStatus,
  providerDisplayName,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { planLimitWindowKind, spentUsageWindow } from "@openbot/team-client/plan-limits";
import { useQuery } from "@tanstack/react-query";
import { type Href, router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useUniwind } from "uniwind";
import { type AgentHostFieldsProps, AgentSpeedField } from "@/features/agents/components/agent-host-fields";
import { useAgentModelPicker, withAccountModels } from "@/features/agents/model/agent-model-picker";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  PLAN_LIMIT_RESET_FORMAT,
  planLimitResetDate,
  planLimitWindowLabel,
  usePlanLimits,
} from "@/features/servers/model/plan-limits";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";

const EFFORT_LABELS = {
  none: "mobile.agent.runtime.effort.none",
  minimal: "mobile.agent.runtime.effort.minimal",
  low: "mobile.agent.runtime.effort.low",
  medium: "mobile.agent.runtime.effort.medium",
  high: "mobile.agent.runtime.effort.high",
  xhigh: "mobile.agent.runtime.effort.xhigh",
  max: "mobile.agent.runtime.effort.max",
  ultra: "mobile.agent.runtime.effort.ultra",
} as const satisfies Record<AgentReasoningEffort, MobileTextKey>;

const MAX_PICKER_LABEL = 28;
function shortLabel(text: string): string {
  const characters = Array.from(text);
  return characters.length > MAX_PICKER_LABEL ? `${characters.slice(0, MAX_PICKER_LABEL).join("").trimEnd()}…` : text;
}
function pickerLabel(text: string, selected: boolean): string {
  return Platform.OS === "android" || !selected ? text : shortLabel(text);
}

export function useProviderAccounts(agent: MobileAgent, enabled: boolean) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const canManage = useMobileWorkspaceSelector((current) => current.canManageProviderAccounts(agent.serverId));
  const queryKey = queryKeys.agentProviderAccounts(queryScope, agent.serverId, agent.id);
  const accounts = useQuery({
    queryKey,
    queryFn: () => workspace.loadProviderAccounts(agent.serverId),
    enabled: enabled && canManage,
    retry: false,
    staleTime: 0,
  });
  return { queryKey, accounts: canManage ? (accounts.data ?? null) : null };
}

export function useProviderAccountName() {
  const { t } = useText();
  return (account: ProviderAccountStatus, index: number, accounts: readonly ProviderAccountStatus[]) =>
    account.label ||
    (accounts.some((other) => other !== account && sameEmail(other, account)) ? null : account.email) ||
    (account.id === CLAUDE_API_KEY_ACCOUNT_ID
      ? t("mobile.agent.runtime.accountApiKey")
      : t("mobile.agent.runtime.accountNumbered", { number: index + 1 }));
}

function sameEmail(first: ProviderAccountStatus, second: ProviderAccountStatus): boolean {
  const email = first.email?.trim().toLowerCase();
  return Boolean(email) && email === second.email?.trim().toLowerCase();
}

export function AgentRuntimeFields({
  serverId,
  available,
  saving,
  provider,
  foreignProvider,
  model,
  reasoningEffort,
  hostDefault = false,
  title,
  accounts = [],
  accountId = "",
  poolModels = [],
  onChange,
  onAccountChange,
  fastMode,
  modelPickerRoute,
  workspaceOnly = false,
}: {
  serverId: string;
  modelPickerRoute: Href;
  available: boolean;
  saving: boolean;
  provider?: AgentProviderId;
  foreignProvider?: ForeignProviderId | undefined;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  hostDefault?: boolean;
  title?: string;
  accounts?: readonly ProviderAccountStatus[];
  accountId?: string;
  poolModels?: readonly AgentModelOption[];
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
  onAccountChange?: (accountId: string) => void;
  fastMode?: AgentHostFieldsProps;
  workspaceOnly?: boolean;
}) {
  const { t } = useText();
  const accountName = useProviderAccountName();
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const { theme } = useUniwind();
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, serverId),
    queryFn: () => workspace.loadAgentModels(serverId),
    enabled: available,
    retry: false,
  });
  const ownModels = accounts.find((account) => account.id === accountId)?.models ?? [];
  const accountModels = poolModels.length ? [...ownModels, ...poolModels] : ownModels;
  const options = withAccountModels(models.data?.filter((option) => option.provider === provider) ?? [], accountModels);
  const selected = options.find((option) => option.id === model);
  const enabled = available && !saving && options.length > 0;
  const showsModel = foreignProvider === undefined && (!hostDefault || provider !== undefined);
  const spentLimit = useSpentLimitText(serverId, showsModel ? provider : undefined, accountId, model);
  const workspaceOnlyNote =
    workspaceOnly && options.some((option) => option.workspaceOnlyUnavailable)
      ? t("mobile.agent.runtime.workspaceOnlyUnavailable")
      : undefined;
  const openModelPicker = useAgentModelPicker((state) => state.open);
  const chooseModel = (next: AgentModelOption) => {
    onChange({
      model: next.id,
      reasoningEffort:
        reasoningEffort && next.supportedReasoningEfforts.includes(reasoningEffort)
          ? reasoningEffort
          : next.defaultReasoningEffort,
    });
  };
  return (
    <>
      <SettingsSection title={title} footer={[workspaceOnlyNote, spentLimit].filter(Boolean).join(" ") || undefined}>
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={provider ?? ""}
              options={
                foreignProvider !== undefined
                  ? [
                      {
                        value: "",
                        label: t("mobile.agent.runtime.updateToUse", { name: providerDisplayName(foreignProvider) }),
                      },
                    ]
                  : [
                      ...(hostDefault ? [{ value: "", label: t("mobile.agent.runtime.hostDefault") }] : []),
                      ...(!models.data?.some((option) => option.provider === provider) && showsModel
                        ? [
                            {
                              value: provider ?? "",
                              label: provider ? agentProviderName(provider) : t("mobile.agent.runtime.unavailable"),
                            },
                          ]
                        : []),
                      ...Array.from(new Set(models.data?.map((option) => option.provider))).map((value) => ({
                        value,
                        label: agentProviderName(value),
                      })),
                    ]
              }
              enabled={foreignProvider === undefined && available && !saving && Boolean(models.data?.length)}
              dark={theme === "dark"}
              label={t("mobile.agent.runtime.provider")}
              onChange={(value) => {
                if (hostDefault && value === "") {
                  onChange({ provider: undefined, model: undefined, reasoningEffort: undefined });
                  return;
                }
                const next = models.data?.find((option) => option.provider === value && option.listing !== "kept");
                if (next)
                  onChange({ provider: next.provider, model: next.id, reasoningEffort: next.defaultReasoningEffort });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.runtime.provider")}</Typography.Paragraph>
        </SettingsRow>
        {onAccountChange && accounts.length > 1 ? (
          <SettingsRow
            trailing={
              <SettingsPicker<string>
                value={accountId}
                options={[
                  ...(!accounts.some((account) => account.id === accountId)
                    ? [{ value: accountId, label: t("mobile.agent.runtime.unavailable") }]
                    : []),
                  ...accounts.map((account, index) => ({
                    value: account.id,
                    label: pickerLabel(accountName(account, index, accounts), account.id === accountId),
                  })),
                ]}
                enabled={available && !saving}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.account")}
                onChange={onAccountChange}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.account")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {showsModel ? (
          <SettingsRow
            disabled={!enabled}
            value={shortLabel(selected?.name ?? model ?? t("mobile.agent.runtime.unavailable"))}
            onPress={() => {
              if (!provider) return;
              openModelPicker({ serverId, provider, model, accountModels, choose: chooseModel });
              router.push(modelPickerRoute);
            }}
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.model")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {showsModel ? (
          <SettingsRow
            trailing={
              <SettingsPicker<string>
                value={reasoningEffort ?? ""}
                options={[
                  ...(!reasoningEffort || !selected?.supportedReasoningEfforts.includes(reasoningEffort)
                    ? [
                        {
                          value: reasoningEffort ?? "",
                          label: reasoningEffort ?? t("mobile.agent.runtime.unavailable"),
                        },
                      ]
                    : []),
                  ...(selected?.supportedReasoningEfforts.map((effort) => ({
                    value: effort,
                    label: t(EFFORT_LABELS[effort]),
                  })) ?? []),
                ]}
                enabled={enabled && Boolean(selected?.supportedReasoningEfforts.length)}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.reasoning")}
                onChange={(effort) => {
                  const next = selected?.supportedReasoningEfforts.find((option) => option === effort);
                  if (next) onChange({ reasoningEffort: next });
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.agent.runtime.reasoning")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {fastMode && showsModel && selected?.fastServiceTier ? <AgentSpeedField {...fastMode} model={selected} /> : null}
      {models.isError ? (
        <Button variant="ghost" onPress={() => void models.refetch()}>
          <Button.Label>{t("mobile.agent.runtime.retryModels")}</Button.Label>
        </Button>
      ) : available && models.isPending ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.loadingModels")}</Typography.Paragraph>
      ) : available && showsModel && !options.length ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.noModels")}</Typography.Paragraph>
      ) : null}
    </>
  );
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function useSpentLimitText(
  serverId: string,
  provider: AgentProviderId | undefined,
  accountId: string,
  model: string | undefined,
): string | null {
  const { t, format } = useText();
  const { usage } = usePlanLimits(serverId);
  const [now, setNow] = useState(Date.now);
  const spent = provider
    ? spentUsageWindow(usage?.limits, provider, accountId || DEFAULT_PROVIDER_ACCOUNT_ID, model, now)
    : null;
  const spentWindow = spent?.covers && !spent.onCredits ? spent.window : null;
  const resetsAt = spentWindow?.resetsAt ?? null;
  useEffect(() => {
    if (resetsAt === null) return;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, resetsAt * 1_000 - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [resetsAt]);
  if (!spentWindow) return null;
  const limit =
    planLimitWindowKind(spentWindow.windowDurationMins).kind === "limit"
      ? t("mobile.agent.runtime.usageLimit")
      : t("mobile.agent.runtime.usageLimitWindow", { window: planLimitWindowLabel(spentWindow.windowDurationMins, t) });
  const date = planLimitResetDate(spentWindow);
  return date
    ? t("mobile.agent.runtime.usageLimitResets", { limit, time: format.date(date, PLAN_LIMIT_RESET_FORMAT) })
    : limit;
}
