import { type AgentSummary, analyticsRange, type HostAnalytics, type HostAnalyticsInput } from "@openbot/contracts/ipc";
import { createEffect, createStore, onSettled, Show } from "solid-js";
import {
  ArrowLeft,
  Button,
  IconButton,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui";
import { AgentUsageReport } from "./AgentUsageReport";
import {
  type UsageAgentLabel,
  type UsageMetric,
  type UsagePeriod,
  usageMetrics,
  usagePeriodDays,
  usagePeriods,
} from "./usage-format";

interface AgentUsagePanelProps {
  agentId?: string;
  agentName?: string;
  serverId: string;
  hostName: string;
  onBack: () => void;
}
interface UsageState {
  range: HostAnalyticsInput;
  result: HostAnalytics | null;
  phase: "loading" | "ready" | "unsupported" | "error";
  agents: AgentSummary[];
  metric: UsageMetric;
  period: UsagePeriod;
  serverId: string;
}

export function AgentUsagePanel(props: AgentUsagePanelProps) {
  const [state, setState] = createStore<UsageState>({
    range: { ...analyticsRange("range"), agentId: props.agentId },
    agents: [],
    result: null,
    phase: "loading",
    metric: "Cost",
    period: "30 days",
    serverId: props.serverId,
  });
  let generation = 0;
  /**
   * A refresh nobody asked for keeps the report on screen. Clearing `result` unmounts
   * `AgentUsageReport`, which returns on the next response with its breakdown back to
   * Agent and scrolled to the total - and a turn completes while the report is open
   * often enough that this is the common case, not the rare one. Only a request the
   * user made may blank the body: the first load, a filter change, Refresh.
   */
  async function load(range = state.range, background = false): Promise<void> {
    const request = ++generation;
    const serverId = props.serverId;
    const agentId = range.agentId;
    if (!background)
      setState((draft) => {
        draft.phase = "loading";
        draft.result = null;
      });
    try {
      const [result, agents] = await Promise.all([
        // Electron cannot clone the Solid store proxy across the context bridge.
        window.openbot.agent.getHostAnalytics({ ...range }, serverId),
        window.openbot.agent.listAgents(serverId),
      ]);
      if (request === generation && props.serverId === serverId && state.range.agentId === agentId)
        setState((draft) => {
          draft.agents = agents;
          draft.serverId = serverId;
          draft.result = result;
          draft.phase = result ? "ready" : "unsupported";
        });
    } catch {
      // A background refresh that fails leaves the last good report where it is rather
      // than replacing it with an error the user cannot act on; the next turn retries.
      // Only while a report is on screen, though: a background request that overtakes the
      // first load takes the generation with it, so the foreground response is discarded
      // too, and a silent failure would leave the panel on Loading with no Retry.
      if (background && state.result) return;
      if (request === generation && props.serverId === serverId && state.range.agentId === agentId)
        setState((draft) => {
          draft.result = null;
          draft.phase = "error";
        });
    }
  }
  createEffect(
    () => [props.agentId, props.serverId],
    () => {
      setState((draft) => {
        draft.range.agentId = props.agentId;
        draft.agents = [];
      });
    },
  );
  createEffect(
    () => [state.range.agentId, props.serverId, state.range.startDate, state.range.endDate],
    () => {
      void load();
    },
  );
  onSettled(() => {
    const unsubscribe = window.openbot.agent.onScopedEvent(({ serverId, event }) => {
      if (
        serverId === props.serverId &&
        event.type === "turn-completed" &&
        (!state.range.agentId || event.agentId === state.range.agentId)
      )
        void load(state.range, true);
    });
    const reconnect = window.openbot.servers.onEvent((servers) => {
      if (servers.some((server) => server.id === props.serverId && server.state === "online"))
        void load(state.range, true);
    });
    return () => {
      generation++;
      unsubscribe();
      reconnect();
    };
  });
  // The filter and the per-agent table both name an agent by id, and props.agentName only
  // names the panel's own agent, so it must not label another agent's row.
  const agentLabel = (id: string): UsageAgentLabel => {
    const agent = state.agents.find((candidate) => candidate.id === id);
    return {
      name: agent?.name ?? (id === props.agentId ? props.agentName : undefined) ?? id,
      provider: agent?.provider ?? "",
    };
  };
  let reportBody: HTMLDivElement | undefined;
  let heading: HTMLHeadingElement | undefined;
  onSettled(() => heading?.focus());
  return (
    <section class="agent-usage" aria-label="Agent usage">
      <header class="agent-usage-header">
        <div class="agent-usage-identity">
          <IconButton variant="ghost" label="Back" onClick={props.onBack}>
            <ArrowLeft />
          </IconButton>
          <h2 ref={heading} tabindex={-1}>
            Usage <span aria-hidden="true">/</span> <span>{props.hostName}</span>
          </h2>
        </div>
        <div class="agent-usage-controls">
          <Select
            options={[
              "all",
              ...[
                ...new Set([
                  ...state.agents.map((agent) => agent.id),
                  ...(state.range.agentId ? [state.range.agentId] : []),
                ]),
              ].map((id) => `agent:${id}`),
            ]}
            value={state.range.agentId ? `agent:${state.range.agentId}` : "all"}
            onChange={(value) => {
              if (value)
                setState((draft) => {
                  draft.range.agentId = value === "all" ? undefined : value.slice(6);
                });
            }}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {itemProps.item.rawValue === "all" ? "All agents" : agentLabel(itemProps.item.rawValue.slice(6)).name}
              </SelectItem>
            )}
          >
            <SelectTrigger aria-label="Usage agents" size="sm">
              <SelectValue<string>>
                {(selection) =>
                  selection.selectedOption() === "all"
                    ? "All agents"
                    : agentLabel(selection.selectedOption().slice(6)).name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
          <UsageSelect
            label="Usage metric"
            options={usageMetrics}
            value={state.metric}
            onChange={(value) => {
              setState((draft) => {
                draft.metric = value;
              });
            }}
          />
          <UsageSelect
            label="Usage period"
            options={usagePeriods}
            value={state.period}
            onChange={(value) => {
              setState((draft) => {
                draft.period = value;
                draft.range = {
                  ...analyticsRange("range", usagePeriodDays[value]),
                  agentId: draft.range.agentId,
                };
              });
            }}
          />
          <IconButton
            variant="outline"
            label="Refresh usage"
            disabled={state.phase === "loading"}
            onClick={() => void load()}
          >
            <RefreshCw />
          </IconButton>
        </div>
      </header>
      <div ref={reportBody} class="agent-usage-body">
        <Show when={state.phase === "loading"}>
          <div class="agent-usage-loading" role="status">
            <span>Loading usage…</span>
            <div class="agent-usage-placeholder" />
          </div>
        </Show>
        <Show when={state.phase === "unsupported"}>
          <p class="agent-usage-notice" role="status">
            This host does not support agent analytics. Update the host to use this view.
          </p>
        </Show>
        <Show when={state.phase === "error"}>
          <div class="agent-usage-notice">
            <p role="alert">Could not load usage. Check the connection and date range.</p>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </Show>
        <Show
          when={
            state.serverId === props.serverId &&
            state.result &&
            state.result.agentId === state.range.agentId &&
            state.result.startDate === state.range.startDate &&
            state.result.endDate === state.range.endDate &&
            state.result
          }
        >
          {(result) => (
            <AgentUsageReport
              result={result()}
              metric={state.metric}
              agentLabel={agentLabel}
              onReady={() => {
                // Start each loaded report at its total, after the tabs settle their initial selection.
                if (reportBody) reportBody.scrollTop = 0;
              }}
            />
          )}
        </Show>
      </div>
    </section>
  );
}

// The header filters share one chip dropdown so the metric and period read as the
// same kind of control as the agent picker beside them.
function UsageSelect<Value extends string>(props: {
  label: string;
  options: readonly Value[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <Select<Value>
      options={[...props.options]}
      value={props.value}
      onChange={(value) => {
        if (value) props.onChange(value);
      }}
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<Value>>{(selection) => selection.selectedOption()}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}
