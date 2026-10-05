import {
  type AgentAnalytics,
  type AnalyticsAgent,
  type AnalyticsProviderDay,
  agentProviderCliName,
  isAgentProvider,
} from "@openbot/contracts/ipc";
import { usageSeries, usageTotalSeries } from "@openbot/team-client/usage-series";
import { Typography } from "heroui-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";
import { UsageChart, useUsageSeriesColor } from "./usage-chart";
import { UsageBar, UsageValue } from "./usage-motion";
import { UsageSegments } from "./usage-segments";

// A usage row names the provider the record carried, which is not always one OpenBot knows:
// an unrecognised string is shown as it was stored rather than guessed at.
const providerName = (value: string) => (isAgentProvider(value) ? agentProviderCliName(value) : value);

/** A row of the per-agent split of a server report, with the name the phone knows for the agent. */
export interface UsageAgentRow extends AnalyticsAgent {
  name: string;
}

/**
 * The report of one agent, or of a server. A server report also passes its per-agent split;
 * a press on an agent row narrows the report to that agent.
 */
export function AgentUsageReport({
  result,
  agents,
  onSelectAgent,
}: {
  /** A host report also splits the days by provider, which draws one area per provider. */
  result: Omit<AgentAnalytics, "agentId"> & { providerDaily?: AnalyticsProviderDay[] };
  agents?: UsageAgentRow[];
  onSelectAgent?: (agentId: string) => void;
}) {
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
  const selectedIndex = result.daily.findIndex((day) => day.date === selectedDate);
  const selected = selectedIndex < 0 ? undefined : result.daily[selectedIndex];
  const max = Math.max(0, ...result.daily.map((day) => day[metric] ?? 0));
  const dates = useMemo(() => result.daily.map((day) => day.date), [result]);
  const chart = useMemo(
    () => usageSeries(result.providerDaily ?? [], result.daily, metric === "estimatedCostUsd" ? "cost" : "tokens"),
    [result, metric],
  );
  const named = chart.series[0] !== usageTotalSeries;
  const seriesColor = useUsageSeriesColor();
  const chartSeries = useMemo(
    () =>
      chart.series.map((key) => ({
        key,
        color: seriesColor(key),
        values: chart.rows.map((row) => {
          const value = row[key];
          return typeof value === "number" ? value : null;
        }),
      })),
    [chart, seriesColor],
  );
  // The grid labels round to two significant digits, as the desktop axis does with compact values.
  const axisValue = (value: number) =>
    metric === "processedTokens"
      ? format.number(value, { notation: "compact", maximumFractionDigits: 1 })
      : format.currencyUsd(value, { maximumSignificantDigits: 2 });
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
          <UsageValue value={number(totals.processedTokens)}>
            <Typography className="text-2xl font-semibold">{number(totals.processedTokens)}</Typography>
          </UsageValue>
        </View>
        <View className="flex-1 gap-1 rounded-grouped bg-grouped p-4">
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.agent.usage.estimatedCost")}
          </Typography>
          <UsageValue value={money(totals.estimatedCostUsd)}>
            <Typography className="text-2xl font-semibold">{money(totals.estimatedCostUsd)}</Typography>
          </UsageValue>
        </View>
      </View>
      <SettingsSection title={t("mobile.agent.usage.daily")}>
        <View className="gap-4 p-4">
          <UsageSegments
            options={[
              { value: "processedTokens", label: t("mobile.agent.usage.tokens") },
              { value: "estimatedCostUsd", label: t("mobile.agent.usage.cost") },
            ]}
            value={metric}
            onChange={setMetric}
          />
          {max > 0 ? null : (
            <Typography type="body-xs" className="text-grouped-secondary">
              {t(metric === "estimatedCostUsd" ? "mobile.agent.usage.noDailyCost" : "mobile.agent.usage.noDailyTokens")}
            </Typography>
          )}
          <UsageChart
            dates={dates}
            series={chartSeries}
            formatValue={axisValue}
            formatDate={(value) => date(value).toUpperCase()}
            selected={selectedIndex < 0 ? null : selectedIndex}
            onSelect={(index) => setSelectedDate(index === null ? null : (dates[index] ?? null))}
            label={t(metric === "processedTokens" ? "mobile.agent.usage.chartTokens" : "mobile.agent.usage.chartCost")}
            value={
              selected
                ? `${date(selected.date)}: ${metric === "processedTokens" ? t("mobile.agent.usage.tokenCount", { tokens: number(selected.processedTokens) }) : money(selected.estimatedCostUsd)}`
                : t("mobile.agent.usage.selectDay")
            }
          />
          {/* As the desktop tooltip does, the legend names each provider with its value: of the selected day, or of the range. */}
          {named ? (
            <View className="gap-2">
              {chartSeries.map((item) => {
                const amount =
                  selectedIndex < 0
                    ? item.values.reduce<number | null>((sum, day) => (day === null ? sum : (sum ?? 0) + day), null)
                    : (item.values[selectedIndex] ?? null);
                const text = metric === "processedTokens" ? number(amount) : money(amount);
                return (
                  <View key={item.key} className="flex-row items-center gap-2">
                    <View className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <Typography type="body-xs" className="flex-1" numberOfLines={1}>
                      {providerName(item.key)}
                    </Typography>
                    <UsageValue value={text}>
                      <Typography type="body-xs" className="text-grouped-secondary">
                        {text}
                      </Typography>
                    </UsageValue>
                  </View>
                );
              })}
            </View>
          ) : null}
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
          <SettingsRow
            key={label}
            trailing={
              <UsageValue value={format.number(value)}>
                <Typography>{format.number(value)}</Typography>
              </UsageValue>
            }
          >
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
          <SettingsRow
            key={label}
            trailing={
              <UsageValue value={number(value)}>
                <Typography>{number(value)}</Typography>
              </UsageValue>
            }
          >
            <Typography>{t(label)}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>
      {agents ? (
        <SettingsSection title={t("mobile.server.usage.agents")}>
          {agents.length ? (
            agents.map((agent) => (
              <SettingsRow
                key={agent.agentId}
                onPress={onSelectAgent ? () => onSelectAgent(agent.agentId) : undefined}
                supportingText={t("mobile.server.usage.agentLine", {
                  tokens: number(agent.processedTokens),
                  cost: money(agent.estimatedCostUsd),
                  percent: format.percent(agent.share, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                })}
              >
                <Typography numberOfLines={1}>{agent.name}</Typography>
                <View className="h-1 overflow-hidden rounded-full bg-grouped-border">
                  <UsageBar
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(0, agent.share * 100))}%` }}
                  />
                </View>
              </SettingsRow>
            ))
          ) : (
            <SettingsRow>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.server.usage.noAgents")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      ) : null}
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
                <UsageBar
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
