import {
  type AgentProviderId,
  type AgentReasoningEffort,
  agentProviderName,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
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
 */
const MAX_PICKER_LABEL = 28;
function pickerLabel(text: string): string {
  const characters = Array.from(text);
  return characters.length > MAX_PICKER_LABEL ? `${characters.slice(0, MAX_PICKER_LABEL).join("").trimEnd()}…` : text;
}

export function AgentRuntimeFields({
  agent,
  available,
  saving,
  provider,
  model,
  reasoningEffort,
  onChange,
}: {
  agent: MobileAgent;
  available: boolean;
  saving: boolean;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  onChange: (value: Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort">) => void;
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const { theme } = useUniwind();
  const models = useQuery({
    queryKey: ["agent-models", session?.apiUrl, session?.user.id, sessionScope, agent.serverId],
    queryFn: () => workspace.loadAgentModels(agent.serverId),
    enabled: available,
    retry: false,
  });
  const options = models.data?.filter((option) => option.provider === provider) ?? [];
  const selected = options.find((option) => option.id === model);
  const enabled = available && !saving && options.length > 0;
  return (
    <>
      <SettingsSection>
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={provider ?? ""}
              options={[
                ...(!models.data?.some((option) => option.provider === provider)
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
              ]}
              enabled={available && !saving && Boolean(models.data?.length)}
              dark={theme === "dark"}
              label={t("mobile.agent.runtime.provider")}
              onChange={(value) => {
                const next = models.data?.find((option) => option.provider === value);
                if (next)
                  onChange({ provider: next.provider, model: next.id, reasoningEffort: next.defaultReasoningEffort });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.runtime.provider")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={model ?? ""}
              options={[
                ...(!selected
                  ? [{ value: model ?? "", label: model ? pickerLabel(model) : t("mobile.agent.runtime.unavailable") }]
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
        <SettingsRow
          trailing={
            <SettingsPicker<string>
              value={reasoningEffort ?? ""}
              options={[
                ...(!reasoningEffort || !selected?.supportedReasoningEfforts.includes(reasoningEffort)
                  ? [{ value: reasoningEffort ?? "", label: reasoningEffort ?? t("mobile.agent.runtime.unavailable") }]
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
      </SettingsSection>
      {models.isError ? (
        <Button variant="ghost" onPress={() => void models.refetch()}>
          <Button.Label>{t("mobile.agent.runtime.retryModels")}</Button.Label>
        </Button>
      ) : available && models.isPending ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.loadingModels")}</Typography.Paragraph>
      ) : available && !options.length ? (
        <Typography.Paragraph>{t("mobile.agent.runtime.noModels")}</Typography.Paragraph>
      ) : null}
    </>
  );
}
