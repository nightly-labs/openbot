import { type AgentAnalytics, analyticsRange } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Button, Input, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

const number = (value: number | null) => (value === null ? "Unavailable" : value.toLocaleString());
const cost = (value: number | null) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);

export function AgentUsageScreen() {
  const { agentId = "", serverId = "" } = useLocalSearchParams<{ agentId: string; serverId: string }>();
  const workspace = useMobileWorkspace();
  const agent = workspace.agents.find((entry) => entry.id === agentId && entry.serverId === serverId);
  const host = workspace.servers.find((entry) => entry.id === serverId);
  const [range, setRange] = useState(() => analyticsRange(agentId));
  const [custom, setCustom] = useState(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    phase: "loading" | "ready" | "unsupported" | "error";
    result: AgentAnalytics | null;
  }>({ key: "", phase: "loading", result: null });
  const load = useRef(workspace.loadAgentAnalytics);
  load.current = workspace.loadAgentAnalytics;
  const conversation = workspace.conversations[agentId];
  const activeTurnId = workspace.activityByServer[serverId]?.[agentId]?.turnId ?? conversation?.activeTurnId;
  const key = JSON.stringify([
    agentId,
    serverId,
    workspace.activeServer.id,
    range,
    host?.state,
    activeTurnId,
    revision,
  ]);
  useEffect(() => {
    let cancelled = false;
    setState({ key, phase: "loading", result: null });
    void load
      .current({ ...range, agentId }, serverId)
      .then((result) => {
        if (!cancelled) setState({ key, phase: result ? "ready" : "unsupported", result });
      })
      .catch(() => {
        if (!cancelled) setState({ key, phase: "error", result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, agentId, serverId, range]);
  const result = state.key === key ? state.result : null;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-8"
    >
      <Typography.Heading>{agent?.name ?? "Agent"}</Typography.Heading>
      <Typography>{host?.name ?? "Host"}</Typography>
      <View className="flex-row flex-wrap gap-2">
        {[7, 30, 90].map((days) => (
          <Button
            key={days}
            variant="secondary"
            onPress={() => {
              setRange(analyticsRange(agentId, days));
              setCustom(false);
            }}
          >
            {days} days
          </Button>
        ))}
        <Button variant="ghost" onPress={() => setCustom(!custom)}>
          Custom range
        </Button>
      </View>
      {custom ? (
        <View className="gap-2">
          <Typography>Start date (YYYY-MM-DD)</Typography>
          <Input
            accessibilityLabel="Start date"
            value={range.startDate}
            onChangeText={(startDate) => setRange({ ...range, startDate })}
          />
          <Typography>End date (YYYY-MM-DD)</Typography>
          <Input
            accessibilityLabel="End date"
            value={range.endDate}
            onChangeText={(endDate) => setRange({ ...range, endDate })}
          />
        </View>
      ) : null}
      <Typography>
        {range.startDate} – {range.endDate} · {range.timeZone}
      </Typography>
      <Typography>
        API-equivalent token cost in USD. This is an estimate, not a subscription charge. Tool and media fees are
        excluded.
      </Typography>
      {state.key !== key || state.phase === "loading" ? (
        <Typography accessibilityRole="text">Loading usage…</Typography>
      ) : null}
      {state.phase === "error" ? (
        <View>
          <Typography accessibilityRole="alert">Could not load usage. Check the connection and date range.</Typography>
          <Button onPress={() => setRevision((value) => value + 1)}>Retry</Button>
        </View>
      ) : null}
      {state.phase === "unsupported" ? (
        <Typography>This host does not support agent analytics. Update the host to use this view.</Typography>
      ) : null}
      {result ? (
        <>
          <Button variant="ghost" onPress={() => setRevision((value) => value + 1)}>
            Refresh
          </Button>
          <MobileUsageReport result={result} />
        </>
      ) : null}
    </ScrollView>
  );
}
function MobileUsageReport({ result }: { result: AgentAnalytics }) {
  const totals = result.totals;
  const metrics = [
    ["Sessions", number(totals.sessions)],
    ["User messages", number(totals.userMessages)],
    ["Assistant messages", number(totals.assistantMessages)],
    ["Processed tokens", number(totals.processedTokens)],
    ["Uncached input", number(totals.uncachedInput)],
    ["Cached input", number(totals.cachedInput)],
    ["Cache creation", number(totals.cacheCreation)],
    ["Output tokens", number(totals.output)],
    ["Estimated cost", cost(totals.estimatedCostUsd)],
  ];
  return (
    <>
      <Typography>
        Collection started {new Date(result.collectionStartedAt).toLocaleDateString()}. Updated{" "}
        {result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "never"}.
      </Typography>
      {!totals.turns && !totals.userMessages && !totals.processedTokens ? (
        <Typography>No usage recorded in this range.</Typography>
      ) : null}
      {totals.missingUsageTurns || totals.unpricedRecords || totals.incompleteRecords ? (
        <Typography>
          Partial data: {totals.missingUsageTurns} turns have no reported usage; {totals.unpricedRecords} usage records
          have no cost estimate.
        </Typography>
      ) : null}
      {metrics.map(([label, value]) => (
        <View className="flex-row justify-between gap-4" key={label}>
          <Typography>{label}</Typography>
          <Typography>{value}</Typography>
        </View>
      ))}
      <Typography.Heading>Daily usage</Typography.Heading>
      <UsageChart result={result} metric="processedTokens" label="Processed tokens by day" />
      <UsageChart result={result} metric="estimatedCostUsd" label="Estimated USD cost by day" />
      {result.daily.map((day) => (
        <View
          key={day.date}
          accessible
          accessibilityLabel={`${day.date}: ${number(day.processedTokens)} tokens, ${cost(day.estimatedCostUsd)} estimated cost`}
        >
          <Typography>
            {day.date} · {number(day.processedTokens)} tokens · {cost(day.estimatedCostUsd)}
          </Typography>
        </View>
      ))}
      <Typography.Heading>Models and providers</Typography.Heading>
      {result.models.map((model) => (
        <View key={`${model.provider}:${model.model}`}>
          <Typography>
            {model.model || "Unknown model"} · {model.provider}
          </Typography>
          <Typography>
            {(model.share * 100).toFixed(1)}% of known tokens · {number(model.processedTokens)} tokens ·{" "}
            {cost(model.estimatedCostUsd)}
          </Typography>
        </View>
      ))}
    </>
  );
}
function UsageChart({
  result,
  metric,
  label,
}: {
  result: AgentAnalytics;
  metric: "processedTokens" | "estimatedCostUsd";
  label: string;
}) {
  const color = String(useCSSVariable("--openbot-accent"));
  const max = Math.max(0, ...result.daily.map((day) => day[metric] ?? 0)) || 1;
  return (
    <View>
      <Typography>{label}</Typography>
      <Svg
        width="100%"
        height={100}
        viewBox="0 0 360 100"
        accessible
        accessibilityLabel={`${label}. Exact values follow in the daily list.`}
      >
        {result.daily.map((day, index) => (
          <Rect
            key={day.date}
            x={(index * 360) / result.daily.length}
            y={100 - ((day[metric] ?? 0) / max) * 100}
            width={Math.max(0.5, 360 / result.daily.length - 1)}
            height={((day[metric] ?? 0) / max) * 100}
            fill={color}
          />
        ))}
      </Svg>
    </View>
  );
}
