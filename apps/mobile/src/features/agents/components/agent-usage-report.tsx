import { type AgentAnalytics, agentProviderCliName, isAgentProvider } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

// A usage row names the provider the record carried, which is not always one OpenBot knows:
// an unrecognised string is shown as it was stored rather than guessed at.
const providerName = (value: string) => (isAgentProvider(value) ? agentProviderCliName(value) : value);

export function AgentUsageReport({ result }: { result: AgentAnalytics }) {
  const { t, format } = useText();
  const number = (value: number | null) =>
    value === null ? t("mobile.agent.runtime.unavailable") : format.number(value);
  const money = (value: number | null) =>
    value === null
      ? t("mobile.agent.runtime.unavailable")
      : format.currencyUsd(value, { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false });
  const date = (value: string, includeYear = false) =>
    format.date(new Date(`${value}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      year: includeYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  const [metric, setMetric] = useState<"processedTokens" | "estimatedCostUsd">("processedTokens");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = result.daily.find((day) => day.date === selectedDate);
  const max = Math.max(0, ...result.daily.map((day) => day[metric] ?? 0));
  const totals = result.totals;
  const partial = totals.missingUsageTurns || totals.incompleteRecords || totals.unpricedRecords;
  return (
    <View className="gap-5">
      <Typography type="body-xs" className="text-center text-grouped-secondary">
        {date(result.startDate, true)} – {date(result.endDate, true)} · {result.timeZone}
      </Typography>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-1 rounded-grouped bg-grouped p-4">
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.agent.usage.processedTokens")}
          </Typography>
          <Typography className="text-2xl font-semibold">{number(totals.processedTokens)}</Typography>
        </View>
        <View className="flex-1 gap-1 rounded-grouped bg-grouped p-4">
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.agent.usage.estimatedCost")}
          </Typography>
          <Typography className="text-2xl font-semibold">{money(totals.estimatedCostUsd)}</Typography>
        </View>
      </View>
      <SettingsSection title={t("mobile.agent.usage.daily")}>
        <View className="gap-4 p-4">
          <View className="flex-row gap-2">
            {(["processedTokens", "estimatedCostUsd"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={metric === value ? "secondary" : "ghost"}
                accessibilityState={{ selected: metric === value }}
                onPress={() => setMetric(value)}
              >
                <Button.Label>
                  {t(value === "processedTokens" ? "mobile.agent.usage.tokens" : "mobile.agent.usage.cost")}
                </Button.Label>
              </Button>
            ))}
          </View>
          {max > 0 ? (
            <>
              <Typography type="body-xs" className="text-grouped-secondary">
                {t("mobile.agent.usage.peak", { value: metric === "processedTokens" ? number(max) : money(max) })}
              </Typography>
              <View className={result.daily.length > 90 ? "h-32 flex-row items-end" : "h-32 flex-row items-end gap-px"}>
                {result.daily.map((day) => (
                  <Pressable
                    key={day.date}
                    className="h-full flex-1 justify-end"
                    accessibilityRole="button"
                    accessibilityLabel={`${day.date}: ${metric === "processedTokens" ? t("mobile.agent.usage.tokenCount", { tokens: number(day[metric]) }) : money(day[metric])}`}
                    accessibilityState={{ selected: selectedDate === day.date }}
                    onPress={() => setSelectedDate(day.date)}
                  >
                    <View
                      className="rounded-t-sm bg-accent"
                      style={{
                        height: ((day[metric] ?? 0) / max) * 128,
                        opacity: selectedDate && selectedDate !== day.date ? 0.35 : 1,
                      }}
                    />
                  </Pressable>
                ))}
              </View>
              <View className="flex-row justify-between">
                <Typography type="body-xs" className="text-grouped-secondary">
                  {date(result.startDate)}
                </Typography>
                <Typography type="body-xs" className="text-grouped-secondary">
                  {date(result.endDate)}
                </Typography>
              </View>
            </>
          ) : (
            <Typography.Paragraph className="text-grouped-secondary">
              {t(metric === "estimatedCostUsd" ? "mobile.agent.usage.noDailyCost" : "mobile.agent.usage.noDailyTokens")}
            </Typography.Paragraph>
          )}
          <Typography type="body-xs" className="text-grouped-secondary">
            {selected
              ? t("mobile.agent.usage.selectedDay", {
                  date: date(selected.date),
                  tokens: number(selected.processedTokens),
                  cost: money(selected.estimatedCostUsd),
                  sessions: number(selected.sessions),
                })
              : t(max > 0 ? "mobile.agent.usage.selectDay" : "mobile.agent.usage.tryOtherRange")}
          </Typography>
        </View>
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.usage.activity")}>
        {(
          [
            ["mobile.agent.usage.sessions", totals.sessions],
            ["mobile.agent.usage.userMessages", totals.userMessages],
            ["mobile.agent.usage.assistantMessages", totals.assistantMessages],
          ] as const
        ).map(([label, value]) => (
          <SettingsRow key={label} trailing={<Typography>{format.number(value)}</Typography>}>
            <Typography>{t(label)}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.usage.tokenBreakdown")}>
        {(
          [
            ["mobile.agent.usage.uncachedInput", totals.uncachedInput],
            ["mobile.agent.usage.cachedInput", totals.cachedInput],
            ["mobile.agent.usage.cacheCreation", totals.cacheCreation],
            ["mobile.agent.usage.output", totals.output],
          ] as const
        ).map(([label, value]) => (
          <SettingsRow key={label} trailing={<Typography>{number(value)}</Typography>}>
            <Typography>{t(label)}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.usage.models")}>
        {result.models.length ? (
          result.models.map((model) => (
            <View key={`${model.provider}:${model.model}`} className="gap-2 p-4">
              <Typography>{model.model || t("mobile.agent.usage.unknownModel")}</Typography>
              <Typography type="body-xs" className="text-grouped-secondary">
                {t("mobile.agent.usage.modelLine", {
                  provider: providerName(model.provider),
                  tokens: number(model.processedTokens),
                  cost: money(model.estimatedCostUsd),
                })}
              </Typography>
              <View className="h-1 overflow-hidden rounded-full bg-grouped-border">
                <View
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, Math.max(0, model.share * 100))}%` }}
                />
              </View>
              <Typography type="body-xs" className="text-grouped-secondary">
                {t("mobile.agent.usage.share", {
                  percent: format.percent(model.share, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                })}
              </Typography>
            </View>
          ))
        ) : (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.agent.usage.noModels")}
            </Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
      <View className="gap-2 px-1">
        {partial ? (
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.agent.usage.partial", {
              missingUsage: totals.missingUsageTurns,
              incomplete: totals.incompleteRecords,
              unpriced: totals.unpricedRecords,
            })}
          </Typography>
        ) : null}
        <Typography type="body-xs" className="text-grouped-secondary">
          {t("mobile.agent.usage.costNote")}
        </Typography>
        <Typography type="body-xs" className="text-grouped-secondary">
          {t("mobile.agent.usage.collection", {
            started: format.date(new Date(result.collectionStartedAt)),
            updated: result.updatedAt
              ? format.date(new Date(result.updatedAt), {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                })
              : t("mobile.agent.usage.never"),
          })}
        </Typography>
      </View>
    </View>
  );
}
