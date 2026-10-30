import {
  type AgentProviderId,
  type AgentReasoningEffort,
  agentProviderName,
  type ForeignProviderId,
  type ProviderAccountStatus,
  providerDisplayName,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { Platform } from "react-native";
import { useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
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
  low: "mobile.agent.runtime.effort.low",
  medium: "mobile.agent.runtime.effort.medium",
  high: "mobile.agent.runtime.effort.high",
  xhigh: "mobile.agent.runtime.effort.xhigh",
  max: "mobile.agent.runtime.effort.max",
} as const satisfies Record<AgentReasoningEffort, MobileTextKey>;

/**
 * A menu picker is as wide as the label it shows, and the row puts that label beside its title on
 * one line. A model name has no length the host promises to respect -- OpenCode states the vendor,
 * the model and the price tier in one string -- so an untruncated name pushed "Model" until it
 * wrapped mid-word. The cap is on the visible label only; the id that gets saved is untouched.
 * Android keeps the full name: its picker cuts the row label to one line, and its menu wraps long
 * names, so a cap only removes the part of a name that tells two models apart.
 */
const MAX_PICKER_LABEL = 28;
function pickerLabel(text: string): string {
  if (Platform.OS === "android") return text;
  const characters = Array.from(text);
  return characters.length > MAX_PICKER_LABEL ? `${characters.slice(0, MAX_PICKER_LABEL).join("").trimEnd()}…` : text;
}

/**
 * The accounts of the host's providers, and the agents on an account after the first. Null for a
 * member, for a host without `provider-accounts-v1`, and until the host answers.
 */
export function useProviderAccounts(agent: MobileAgent, enabled: boolean) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const canManage = useMobileWorkspaceSelector((current) => current.canManageProviderAccounts(agent.serverId));
  // Under "agent-info", so the host's agent events refresh it with the other agent records.
  const queryKey = queryKeys.agentProviderAccounts(queryScope, agent.serverId, agent.id);
  const accounts = useQuery({
    queryKey,
    queryFn: () => workspace.loadProviderAccounts(agent.serverId),
    enabled: enabled && canManage,
    retry: false,
    // Another device can change the accounts at any time, so a reopened page reads the host again.
    staleTime: 0,
  });
  return { queryKey, accounts: canManage ? (accounts.data ?? null) : null };
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
  onChange,
  onAccountChange,
}: {
  serverId: string;
  available: boolean;
  saving: boolean;
  provider?: AgentProviderId;
  /** The provider when this build does not know it. The choice shows it and stays disabled. */
  foreignProvider?: ForeignProviderId | undefined;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  /**
   * A new agent: the provider list starts with the host's default, which sends no pair, so the host
   * keeps its saved provider choice. The model rows show after the user picks a provider.
   */
  hostDefault?: boolean;
  title?: string;
  /** The accounts of the provider. The choice shows only when there are two or more. */
  accounts?: readonly ProviderAccountStatus[];
  accountId?: string;
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
  onAccountChange?: (accountId: string) => void;
}) {
  const { t } = useText();
  // The name of an account, as on desktop: the user's name for it, its email, "API key", or its place in the list.
  const accountName = (account: ProviderAccountStatus, index: number) =>
    account.label ||
    account.email ||
    (account.id === CLAUDE_API_KEY_ACCOUNT_ID
      ? t("mobile.agent.runtime.accountApiKey")
      : t("mobile.agent.runtime.accountNumbered", { number: index + 1 }));
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const { theme } = useUniwind();
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, serverId),
    queryFn: () => workspace.loadAgentModels(serverId),
    enabled: available,
    retry: false,
  });
  const options = models.data?.filter((option) => option.provider === provider) ?? [];
  const selected = options.find((option) => option.id === model);
  const enabled = available && !saving && options.length > 0;
  const showsModel = foreignProvider === undefined && (!hostDefault || provider !== undefined);
  return (
    <>
      <SettingsSection title={title}>
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
                const next = models.data?.find((option) => option.provider === value);
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
                    label: pickerLabel(accountName(account, index)),
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
            trailing={
              <SettingsPicker<string>
                value={model ?? ""}
                options={[
                  ...(!selected
                    ? [
                        {
                          value: model ?? "",
                          label: model ? pickerLabel(model) : t("mobile.agent.runtime.unavailable"),
                        },
                      ]
                    : []),
                  ...options.map((option) => ({ value: option.id, label: pickerLabel(option.name) })),
                ]}
                enabled={enabled}
                dark={theme === "dark"}
                label={t("mobile.agent.runtime.model")}
                onChange={(id) => {
                  const next = options.find((option) => option.id === id);
                  if (!next) return;
                  onChange({
                    model: next.id,
                    reasoningEffort:
                      reasoningEffort && next.supportedReasoningEfforts.includes(reasoningEffort)
                        ? reasoningEffort
                        : next.defaultReasoningEffort,
                  });
                }}
              />
            }
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
