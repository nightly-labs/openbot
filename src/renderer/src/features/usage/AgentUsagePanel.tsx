import { type AgentSummary, analyticsRange, type HostAnalytics, type HostAnalyticsInput } from "@openbot/contracts/ipc";
import { createEffect, createStore, onSettled, Show } from "solid-js";
import {
  ArrowLeft,
  Button,
  Input,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui";
import { AgentUsageReport } from "./AgentUsageReport";
import type { UsageMetric } from "./usage-format";

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
  custom: boolean;
  metric: UsageMetric;
  period: string;
  serverId: string;
}

export function AgentUsagePanel(props: AgentUsagePanelProps) {
  const [state, setState] = createStore<UsageState>({
    range: { ...analyticsRange("range"), agentId: props.agentId },
    agents: [],
    result: null,
    phase: "loading",
    custom: false,
    metric: "Cost",
    period: "30 days",
    serverId: props.serverId,
  });
  let generation = 0;
  async function load(range = state.range): Promise<void> {
    const request = ++generation;
    const serverId = props.serverId;
    const agentId = range.agentId;
    setState((draft) => {
      draft.phase = "loading";
      draft.result = null;
    });
    try {
      const [result, agents] = await Promise.all([
        window.openbot.agent.getHostAnalytics(range, serverId),
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
        void load();
    });
    const reconnect = window.openbot.servers.onEvent((servers) => {
      if (servers.some((server) => server.id === props.serverId && server.state === "online")) void load();
    });
    return () => {
      generation++;
      unsubscribe();
      reconnect();
    };
  });
  let reportBody: HTMLDivElement | undefined;
  let heading: HTMLHeadingElement | undefined;
  onSettled(() => heading?.focus());
  return (
    <section class="agent-usage" aria-label="Agent usage">
      <header class="agent-usage-header">
        <div class="agent-usage-identity">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={props.onBack}>
            <ArrowLeft />
          </Button>
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
                {itemProps.item.rawValue === "all"
                  ? "All agents"
                  : (state.agents.find((agent) => agent.id === itemProps.item.rawValue.slice(6))?.name ??
                    props.agentName ??
                    itemProps.item.rawValue.slice(6))}
              </SelectItem>
            )}
          >
            <SelectTrigger aria-label="Usage agents" size="sm">
              <SelectValue<string>>
                {(selection) =>
                  selection.selectedOption() === "all"
                    ? "All agents"
                    : (state.agents.find((agent) => `agent:${agent.id}` === selection.selectedOption())?.name ??
                      props.agentName ??
                      state.range.agentId)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
          <UsageSelect
            label="Usage metric"
            options={["Cost", "Tokens"]}
            value={state.metric}
            onChange={(value) => {
              if (value === "Cost" || value === "Tokens")
                setState((draft) => {
                  draft.metric = value;
                });
            }}
          />
          <UsageSelect
            label="Usage period"
            options={["7 days", "30 days", "90 days", "Custom range"]}
            value={state.period}
            onChange={(value) => {
              setState((draft) => {
                draft.period = value;
                draft.custom = value === "Custom range";
                if (!draft.custom)
                  draft.range = {
                    ...analyticsRange("range", Number.parseInt(value, 10)),
                    agentId: draft.range.agentId,
                  };
              });
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh usage"
            disabled={state.phase === "loading"}
            onClick={() => void load()}
          >
            <RefreshCw />
          </Button>
        </div>
      </header>
      <div ref={reportBody} class="agent-usage-body">
        <Show when={state.custom}>
          <div class="agent-usage-dates">
            <label>
              Start date
              <Input
                type="date"
                value={state.range.startDate}
                onInput={(event) =>
                  setState((draft) => {
                    draft.range.startDate = event.currentTarget.value;
                  })
                }
              />
            </label>
            <label>
              End date
              <Input
                type="date"
                value={state.range.endDate}
                onInput={(event) =>
                  setState((draft) => {
                    draft.range.endDate = event.currentTarget.value;
                  })
                }
              />
            </label>
          </div>
        </Show>
        <p class="agent-usage-range">
          {state.range.startDate} – {state.range.endDate} · {state.range.timeZone}
        </p>
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

function UsageSelect(props: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <Select<string>
      options={props.options}
      value={props.value}
      onChange={(value) => {
        if (value) props.onChange(value);
      }}
      itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<string>>{(state) => state.selectedOption()}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}
