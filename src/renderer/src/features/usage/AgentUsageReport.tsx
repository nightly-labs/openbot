import type { AnalyticsTotals, HostAnalytics } from "@openbot/contracts/ipc";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import { Button, SlidingTabs } from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
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
  const { t } = useI18n();
  return (
    <tr>
      <th scope="col">{props.label}</th>
      <th scope="col">{t("usage.cost")}</th>
      <th scope="col">{t("usage.share")}</th>
      <th scope="col">{t("usage.tokens")}</th>
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
  const { t } = useI18n();
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
    return amount === null || total === null
      ? t("usage.unavailable")
      : `${(total ? (amount / total) * 100 : 0).toFixed(1)}%`;
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
          {t("usage.noUsage")}
        </p>
      </Show>
      <Show when={partial()}>
        <p class="agent-usage-notice" role="status">
          {t("usage.partialData", {
            missing: totals().missingUsageTurns,
            unpriced: totals().unpricedRecords,
            incomplete: totals().incompleteRecords,
          })}
        </p>
      </Show>
      <div class="agent-usage-overview">
        <section class="agent-usage-summary" aria-label={t("usage.summary")}>
          <div>
            <p class="agent-usage-hero">
              <Amount value={cost() ? totals().estimatedCostUsd : totals().processedTokens} cost={cost()} />
            </p>
            <p class="agent-usage-secondary">
              {t(totals().sessions === 1 ? "usage.session" : "usage.sessions", { count: totals().sessions })} ·{" "}
              {cost() ? t("usage.apiEstimate") : t("usage.knownTokens")}
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
        <section class="agent-usage-trend" aria-label={t("usage.dailyTrend")}>
          <div class="agent-usage-section-header">
            <h3>{t("usage.daily", { measure: cost() ? t("usage.cost") : t("usage.tokens") })}</h3>
            <Button variant="ghost" size="xs" onClick={showDailyData}>
              {t("usage.viewDaily")}
            </Button>
          </div>
          <UsageChart result={props.result} metric={props.metric} />
        </section>
      </div>
      <section aria-label={t("usage.totals")}>
        <h3>{t("usage.totals")}</h3>
        <dl class="agent-usage-totals">
          <For
            each={[
              { label: t("usage.processedTokens"), value: totals().processedTokens },
              { label: t("usage.cachedInput"), value: totals().cachedInput },
              { label: t("usage.uncachedInput"), value: totals().uncachedInput },
              { label: t("usage.cacheCreation"), value: totals().cacheCreation },
              { label: t("usage.output"), value: totals().output },
              { label: t("usage.userMessages"), value: totals().userMessages },
              { label: t("usage.assistantMessages"), value: totals().assistantMessages },
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
          <h3>{t("usage.breakdown")}</h3>
          <SlidingTabs.List aria-label={t("usage.breakdown")}>
            <SlidingTabs.Trigger value="model">{t("usage.model")}</SlidingTabs.Trigger>
            <SlidingTabs.Trigger value="agent">{t("usage.agent")}</SlidingTabs.Trigger>
            <SlidingTabs.Trigger value="day">{t("usage.day")}</SlidingTabs.Trigger>
          </SlidingTabs.List>
        </div>
        {/* Every panel is force-mounted, and the grid slot is what makes the hidden ones
            share one cell instead of each reserving its own height below the visible table. */}
        <SlidingTabs.ContentSlot>
          <SlidingTabs.Content value="model">
            <div class="agent-usage-table">
              <table>
                <caption class="sr-only">{t("usage.byModel")}</caption>
                <thead>
                  <BreakdownColumns label={t("usage.model")} />
                </thead>
                <tbody>
                  <For each={models()}>
                    {(model) => (
                      <tr>
                        <th scope="row">
                          <span class="agent-usage-model-name">
                            <UsageProviderMark provider={model.provider} />
                            <span>
                              {model.model || t("usage.unknownModel")}
                              {/* The logo carries the provider for a reader who sees it, and the
                                  row stays one line high; the name is still spoken. */}
                              <span class="sr-only">{usageProviderName(model.provider)}</span>
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
                <caption class="sr-only">{t("usage.byAgent")}</caption>
                <thead>
                  <BreakdownColumns label={t("usage.agent")} />
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
                <caption class="sr-only">{t("usage.dailyUsageCost")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("usage.date")}</th>
                    <th scope="col">{t("usage.costUsd")}</th>
                    <th scope="col">{t("usage.processedTokens")}</th>
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
          {t("usage.collectionUpdated", {
            started: new Date(props.result.collectionStartedAt).toLocaleDateString(),
            updated: props.result.updatedAt ? new Date(props.result.updatedAt).toLocaleString() : t("usage.never"),
          })}
        </p>
        <details>
          <summary>{t("usage.aboutEstimates")}</summary>
          <p>{t("usage.estimateDescription")}</p>
        </details>
      </footer>
    </>
  );
}
