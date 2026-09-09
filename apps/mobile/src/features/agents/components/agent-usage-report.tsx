import type { AgentAnalytics } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";

const number = (value: number | null) => (value === null ? "Unavailable" : value.toLocaleString());
const money = (value: number | null) => (value === null ? "Unavailable" : `$${value.toFixed(4)}`);
const date = (value: string, includeYear = false) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
    timeZone: "UTC",
  });

export function AgentUsageReport({ result }: { result: AgentAnalytics }) {
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
            Processed tokens
          </Typography>
          <Typography className="text-2xl font-semibold">{number(totals.processedTokens)}</Typography>
        </View>
        <View className="flex-1 gap-1 rounded-grouped bg-grouped p-4">
          <Typography type="body-xs" className="text-grouped-secondary">
            Estimated cost
          </Typography>
          <Typography className="text-2xl font-semibold">{money(totals.estimatedCostUsd)}</Typography>
        </View>
      </View>
      <SettingsSection title="Daily usage">
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
                <Button.Label>{value === "processedTokens" ? "Tokens" : "Cost"}</Button.Label>
              </Button>
            ))}
          </View>
          {max > 0 ? (
            <>
              <Typography type="body-xs" className="text-grouped-secondary">
                Peak {metric === "processedTokens" ? number(max) : money(max)}
              </Typography>
              <View className={result.daily.length > 90 ? "h-32 flex-row items-end" : "h-32 flex-row items-end gap-px"}>
                {result.daily.map((day) => (
                  <Pressable
                    key={day.date}
                    className="h-full flex-1 justify-end"
                    accessibilityRole="button"
                    accessibilityLabel={`${day.date}: ${metric === "processedTokens" ? `${number(day[metric])} tokens` : money(day[metric])}`}
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
              {metric === "estimatedCostUsd"
                ? "No daily cost estimates available in this range."
                : "No daily token usage recorded in this range."}
            </Typography.Paragraph>
          )}
          <Typography type="body-xs" className="text-grouped-secondary">
            {selected
              ? `${date(selected.date)} · ${number(selected.processedTokens)} tokens · ${money(selected.estimatedCostUsd)} · ${number(selected.sessions)} sessions`
              : max > 0
                ? "Select a day to see its totals."
                : "Try a different date range to see earlier activity."}
          </Typography>
        </View>
      </SettingsSection>
      <SettingsSection title="Activity">
        {[
          ["Sessions", totals.sessions],
          ["User messages", totals.userMessages],
          ["Assistant messages", totals.assistantMessages],
        ].map(([label, value]) => (
          <SettingsRow key={label} trailing={<Typography>{value.toLocaleString()}</Typography>}>
            <Typography>{label}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title="Token breakdown">
        {(
          [
            ["Uncached input", totals.uncachedInput],
            ["Cached input", totals.cachedInput],
            ["Cache creation", totals.cacheCreation],
            ["Output", totals.output],
          ] as const
        ).map(([label, value]) => (
          <SettingsRow key={label} trailing={<Typography>{number(value)}</Typography>}>
            <Typography>{label}</Typography>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title="Models">
        {result.models.length ? (
          result.models.map((model) => (
            <View key={`${model.provider}:${model.model}`} className="gap-2 p-4">
              <Typography>{model.model || "Unknown model"}</Typography>
              <Typography type="body-xs" className="text-grouped-secondary">
                {model.provider} · {number(model.processedTokens)} tokens · {money(model.estimatedCostUsd)}
              </Typography>
              <View className="h-1 overflow-hidden rounded-full bg-grouped-border">
                <View
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, Math.max(0, model.share * 100))}%` }}
                />
              </View>
              <Typography type="body-xs" className="text-grouped-secondary">
                {(model.share * 100).toFixed(1)}% of known tokens
              </Typography>
            </View>
          ))
        ) : (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              No model usage recorded in this range.
            </Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
      <View className="gap-2 px-1">
        {partial ? (
          <Typography type="body-xs" className="text-grouped-secondary">
            Partial data: {totals.missingUsageTurns} turns without usage, {totals.incompleteRecords} incomplete records,{" "}
            {totals.unpricedRecords} records without a cost estimate.
          </Typography>
        ) : null}
        <Typography type="body-xs" className="text-grouped-secondary">
          API-equivalent cost in USD. This estimate excludes subscription charges, tools, and media fees.
        </Typography>
        <Typography type="body-xs" className="text-grouped-secondary">
          Collection started {new Date(result.collectionStartedAt).toLocaleDateString()}. Updated{" "}
          {result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "never"}.
        </Typography>
      </View>
    </View>
  );
}
