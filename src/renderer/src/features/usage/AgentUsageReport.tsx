import type { AnalyticsTotals, HostAnalytics } from "@openbot/contracts/ipc";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import { Button, SlidingTabs } from "../../components/ui";
import { UsageChart } from "./UsageChart";
import { UsageProviderMark } from "./UsageProviderMark";
import {
  type UsageAgentLabel,
  type UsageMetric,
  usageCompact,
  usageCost,
  usageExactCost,
  usageNumber,
  usageProviderName,
  usageProviders,
  usageSeriesColor,
} from "./usage-format";

function Amount(props: { value: number | null; cost?: boolean }) {
  return (
    <>
      <span aria-hidden="true">{props.cost ? usageCost(props.value) : usageCompact(props.value)}</span>
      <span class="sr-only">{props.cost ? usageExactCost(props.value) : usageNumber(props.value)}</span>
    </>
  );
}
// The model and agent tables carry the same three value columns, so they share them and
// the metric switch changes the same one column in both by construction. The headers name
// the measure only: every cost cell carries its currency, and the note under the tables
// already says a share is of the known amount.
function BreakdownColumns(props: { label: string }) {
  return (
    <tr>
      <th scope="col">{props.label}</th>
      <th scope="col">Cost</th>
      <th scope="col">Share</th>
      <th scope="col">Tokens</th>
    </tr>
  );
}
function BreakdownCells(props: { row: AnalyticsTotals; cost: boolean; share: (amount: number | null) => string }) {
  return (
    <>
      <td>
        <Amount value={props.row.estimatedCostUsd} cost />
      </td>
      <td>{props.share(props.cost ? props.row.estimatedCostUsd : props.row.processedTokens)}</td>
      <td>
        <Amount value={props.row.processedTokens} />
      </td>
    </>
  );
}
export function AgentUsageReport(props: {
  result: HostAnalytics;
  metric: UsageMetric;
  agentLabel: (agentId: string) => UsageAgentLabel;
  onReady: () => void;
}) {
  onSettled(() => queueMicrotask(props.onReady));
  // The host report answers "which teammate spent this" first, so the split by agent is
  // the tab that opens.
  const [state, setState] = createStore({ breakdown: "agent" });
  const totals = () => props.result.totals;
  const cost = () => props.metric === "Cost";
  const providers = createMemo(() =>
    usageProviders(props.result.models).sort((a, b) =>
      cost() ? (b.cost ?? -1) - (a.cost ?? -1) : b.tokens - a.tokens,
    ),
  );
  const models = createMemo(() =>
    [...props.result.models].sort((a, b) =>
      cost() ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1) : b.processedTokens - a.processedTokens,
    ),
  );
  const agents = createMemo(() =>
    [...props.result.agents].sort((a, b) =>
      cost() ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1) : b.processedTokens - a.processedTokens,
    ),
  );
  const partial = () =>
    totals().missingUsageTurns > 0 || totals().unpricedRecords > 0 || totals().incompleteRecords > 0;
  const share = (amount: number | null) => {
    const total = cost() ? totals().estimatedCostUsd : totals().processedTokens;
    return amount === null || total === null ? "Unavailable" : `${(total ? (amount / total) * 100 : 0).toFixed(1)}%`;
  };
  let dailyTable: HTMLTableElement | undefined;
  function showDailyData() {
    setState((draft) => {
      draft.breakdown = "day";
    });
    queueMicrotask(() => dailyTable?.focus());
  }
  return (
    <>
      <Show when={!totals().turns && !totals().userMessages && !totals().processedTokens}>
        <p class="agent-usage-notice" role="status">
          No usage recorded in this range.
        </p>
      </Show>
      <Show when={partial()}>
        <p class="agent-usage-notice" role="status">
          Partial data · {totals().missingUsageTurns} turns have no reported usage; {totals().unpricedRecords} records
          have no cost estimate; {totals().incompleteRecords} records have incomplete token data.
        </p>
      </Show>
      <div class="agent-usage-overview">
        <section class="agent-usage-summary" aria-label="Usage summary">
          <div>
            <p class="agent-usage-hero">
              <Amount value={cost() ? totals().estimatedCostUsd : totals().processedTokens} cost={cost()} />
            </p>
            <p class="agent-usage-secondary">
              {usageNumber(totals().sessions)} {totals().sessions === 1 ? "session" : "sessions"} ·{" "}
              {cost() ? "API estimate · USD" : "Known processed tokens"}
            </p>
          </div>
          <div class="agent-usage-providers">
            <For each={providers()}>
              {(provider) => (
                <div class="agent-usage-provider">
                  <div class="agent-usage-provider-heading">
                    <span>
                      {/* The chart needs a legend, and this list already names every
                          series, so the dot is it - which is why the colour follows the
                          provider rather than the row's place in a metric-sorted list. */}
                      <span
                        class="agent-usage-series-dot"
                        style={{ background: usageSeriesColor(provider.provider) }}
                        aria-hidden="true"
                      />
                      <UsageProviderMark provider={provider.provider} />
                      {usageProviderName(provider.provider)}
                    </span>
                    <strong>
                      <Amount value={cost() ? provider.cost : provider.tokens} cost={cost()} />
                    </strong>
                  </div>
                  <p>
                    {share(cost() ? provider.cost : provider.tokens)} of known {cost() ? "cost" : "tokens"} ·{" "}
                    {cost() ? `${usageCompact(provider.tokens)} tokens` : usageCost(provider.cost)}
                  </p>
                </div>
              )}
            </For>
          </div>
        </section>
        <section class="agent-usage-trend" aria-label="Daily trend">
          <div class="agent-usage-section-header">
            <h3>Daily {cost() ? "cost" : "tokens"}</h3>
            <Button variant="ghost" size="xs" onClick={showDailyData}>
              View daily data
            </Button>
          </div>
          <UsageChart result={props.result} metric={props.metric} />
        </section>
      </div>
      <section aria-label="Totals">
        <h3>Totals</h3>
        <dl class="agent-usage-totals">
          <For
            each={[
              { label: "Processed tokens", value: totals().processedTokens },
              { label: "Cached input", value: totals().cachedInput },
              { label: "Uncached input", value: totals().uncachedInput },
              { label: "Cache creation", value: totals().cacheCreation },
              { label: "Output", value: totals().output },
              { label: "User messages", value: totals().userMessages },
              { label: "Completed assistant messages", value: totals().assistantMessages },
            ]}
          >
            {(item) => (
              <div>
                <dt>{item.label}</dt>
                <dd>
                  <Amount value={item.value} />
                </dd>
              </div>
            )}
          </For>
        </dl>
      </section>
      <SlidingTabs.Root
        value={state.breakdown}
        onChange={(value) =>
          setState((draft) => {
            draft.breakdown = value;
          })
        }
      >
        <div class="agent-usage-section-header">
          <h3>Breakdown</h3>
          <SlidingTabs.List aria-label="Usage breakdown">
            <SlidingTabs.Trigger value="model">Model</SlidingTabs.Trigger>
            <SlidingTabs.Trigger value="agent">Agent</SlidingTabs.Trigger>
            <SlidingTabs.Trigger value="day">Day</SlidingTabs.Trigger>
          </SlidingTabs.List>
        </div>
        {/* Every panel is force-mounted, and the grid slot is what makes the hidden ones
            share one cell instead of each reserving its own height below the visible table. */}
        <SlidingTabs.ContentSlot>
          <SlidingTabs.Content value="model">
            <div class="agent-usage-table">
              <table>
                <caption class="sr-only">Usage by model</caption>
                <thead>
                  <BreakdownColumns label="Model" />
                </thead>
                <tbody>
                  <For each={models()}>
                    {(model) => (
                      <tr>
                        <th scope="row">
                          <span class="agent-usage-model-name">
                            <UsageProviderMark provider={model.provider} />
                            <span>
                              {model.model || "Unknown model"}
                              <small>{usageProviderName(model.provider)}</small>
                            </span>
                          </span>
                        </th>
                        <BreakdownCells row={model} cost={cost()} share={share} />
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </SlidingTabs.Content>
          <SlidingTabs.Content value="agent">
            <div class="agent-usage-table">
              <table>
                <caption class="sr-only">Usage by agent</caption>
                <thead>
                  <BreakdownColumns label="Agent" />
                </thead>
                <tbody>
                  <For each={agents()}>
                    {(agent) => (
                      <tr>
                        <th scope="row">
                          <span class="agent-usage-model-name">
                            <UsageProviderMark provider={props.agentLabel(agent.agentId).provider} />
                            <span>{props.agentLabel(agent.agentId).name}</span>
                          </span>
                        </th>
                        <BreakdownCells row={agent} cost={cost()} share={share} />
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </SlidingTabs.Content>
          <SlidingTabs.Content value="day">
            <div class="agent-usage-table">
              <table ref={dailyTable} tabindex={-1}>
                <caption class="sr-only">Daily usage and cost</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Cost · USD</th>
                    <th scope="col">Processed tokens</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={[...props.result.daily].reverse()}>
                    {(day) => (
                      <tr>
                        <th scope="row">{day.date}</th>
                        <td>{usageExactCost(day.estimatedCostUsd)}</td>
                        <td>{usageNumber(day.processedTokens)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </SlidingTabs.Content>
        </SlidingTabs.ContentSlot>
      </SlidingTabs.Root>
      <footer class="agent-usage-footer">
        <p>
          Collection started {new Date(props.result.collectionStartedAt).toLocaleDateString()} · Updated{" "}
          {props.result.updatedAt ? new Date(props.result.updatedAt).toLocaleString() : "never"}
        </p>
        <details>
          <summary>About these estimates</summary>
          <p>
            API-equivalent token cost in USD. This is an estimate, not a subscription charge. Separate tool and media
            fees are not calculated. Unknown prices and incomplete usage stay unavailable. Shares use known amounts
            only; partial data can understate totals.
          </p>
        </details>
      </footer>
    </>
  );
}
