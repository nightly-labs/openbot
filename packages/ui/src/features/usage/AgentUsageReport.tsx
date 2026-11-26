import { type AnalyticsTotals, analyticsTokens, type HostAnalytics } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, SlidingTabs } from "@openbot/ui";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { useText } from "../../text";
import { UsageChart } from "./UsageChart";
import { UsageProviderMark } from "./UsageProviderMark";
import {
  type UsageAgentLabel,
  type UsageBucket,
  type UsageMetric,
  usageBucket,
  usageCompact,
  usageCost,
  usageExactCost,
  usageNumber,
  usageProviderName,
  usageProviders,
  usageSeriesColors,
} from "./usage-format";

type UsageTotalField =
  | "processedTokens"
  | "cachedInput"
  | "uncachedInput"
  | "cacheCreation"
  | "output"
  | "userMessages"
  | "assistantMessages";

const TOTAL_ROWS = [
  { field: "processedTokens", label: "usage.totals.processedTokens" },
  { field: "cachedInput", label: "usage.totals.cachedInput" },
  { field: "uncachedInput", label: "usage.totals.uncachedInput" },
  { field: "cacheCreation", label: "usage.totals.cacheCreation" },
  { field: "output", label: "usage.totals.output" },
  { field: "userMessages", label: "usage.totals.userMessages" },
  { field: "assistantMessages", label: "usage.totals.assistantMessages" },
] as const satisfies ReadonlyArray<{ field: UsageTotalField; label: AppTextKey }>;

const TREND_TITLES = {
  cost: { day: "usage.dailyCost", week: "usage.weeklyCost", month: "usage.monthlyCost" },
  tokens: { day: "usage.dailyTokens", week: "usage.weeklyTokens", month: "usage.monthlyTokens" },
} as const satisfies Record<UsageMetric, Record<UsageBucket, AppTextKey>>;

const UPDATED_AT_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

function Amount(props: { value: number | null; cost?: boolean }) {
  const text = useText();
  return (
    <>
      <span aria-hidden="true">{props.cost ? usageCost(props.value, text) : usageCompact(props.value, text)}</span>
      <span class="sr-only">{props.cost ? usageExactCost(props.value, text) : usageNumber(props.value, text)}</span>
    </>
  );
}
function BreakdownColumns(props: { label: string }) {
  const { t } = useText();
  return (
    <tr>
      <th scope="col">{props.label}</th>
      <th scope="col">{t("usage.column.cost")}</th>
      <th scope="col">{t("usage.column.share")}</th>
      <th scope="col">{t("usage.column.tokens")}</th>
    </tr>
  );
}
function BreakdownCells(props: { row: AnalyticsTotals; cost: boolean; share: (amount: number | null) => string }) {
  return (
    <>
      <td>
        <Amount value={props.row.estimatedCostUsd} cost />
      </td>
      <td>{props.share(props.cost ? props.row.estimatedCostUsd : analyticsTokens(props.row))}</td>
      <td>
        <Amount value={analyticsTokens(props.row)} />
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
  const text = useText();
  const { t, format } = text;
  onSettled(() => queueMicrotask(props.onReady));
  const [state, setState] = createStore({ breakdown: "agent" });
  const totals = () => props.result.totals;
  const cost = () => props.metric === "cost";
  const providers = createMemo(() =>
    usageProviders(props.result.models).sort((a, b) =>
      cost() ? (b.cost ?? -1) - (a.cost ?? -1) : b.tokens - a.tokens,
    ),
  );
  const models = createMemo(() =>
    [...props.result.models].sort((a, b) =>
      cost() ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1) : analyticsTokens(b) - analyticsTokens(a),
    ),
  );
  const agents = createMemo(() =>
    [...props.result.agents].sort((a, b) =>
      cost() ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1) : analyticsTokens(b) - analyticsTokens(a),
    ),
  );
  const seriesColor = createMemo(() =>
    usageSeriesColors([
      ...props.result.models.map((model) => model.provider),
      ...props.result.providerDaily.map((cell) => cell.provider),
    ]),
  );
  const bucket = createMemo(() => usageBucket(props.result.daily.length));
  const share = (amount: number | null) => {
    const total = cost() ? totals().estimatedCostUsd : analyticsTokens(totals());
    return amount === null || total === null
      ? t("usage.unavailable")
      : format.percent(total ? amount / total : 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
      <Show
        when={totals().turns || totals().userMessages || totals().processedTokens}
        fallback={
          <p class="agent-usage-notice" role="status">
            {t("usage.empty")}
          </p>
        }
      >
        <div class="agent-usage-overview">
          <section class="agent-usage-summary" aria-label={t("usage.summary")}>
            <div>
              <p class="agent-usage-hero">
                <Amount value={cost() ? totals().estimatedCostUsd : analyticsTokens(totals())} cost={cost()} />
              </p>
              <p class="agent-usage-secondary">
                {t("usage.sessions", { count: totals().sessions, sessions: usageNumber(totals().sessions, text) })} ·{" "}
                {cost() ? t("usage.costEstimate") : t("usage.knownTokens")}
              </p>
            </div>
            <div class="agent-usage-providers">
              <For each={providers()}>
                {(provider) => (
                  <div class="agent-usage-provider">
                    <div class="agent-usage-provider-heading">
                      <span>
                        <span
                          class="agent-usage-series-dot"
                          style={{ background: seriesColor()(provider.provider) }}
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
                      <Show when={!cost() || provider.cost !== null}>
                        {cost()
                          ? t("usage.provider.shareOfCost", { share: share(provider.cost) })
                          : t("usage.provider.shareOfTokens", { share: share(provider.tokens) })}{" "}
                        ·{" "}
                      </Show>
                      {cost()
                        ? t("usage.tokensAmount", { tokens: usageCompact(provider.tokens, text) })
                        : usageCost(provider.cost, text)}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </section>
          <section class="agent-usage-trend" aria-label={t(TREND_TITLES[props.metric][bucket()])}>
            <div class="agent-usage-section-header">
              <h3>{t(TREND_TITLES[props.metric][bucket()])}</h3>
              <Button variant="ghost" size="xs" onClick={showDailyData}>
                {t("usage.viewDailyData")}
              </Button>
            </div>
            <UsageChart
              result={props.result}
              metric={props.metric}
              bucket={bucket()}
              label={t(TREND_TITLES[props.metric][bucket()])}
              seriesColor={seriesColor()}
            />
          </section>
        </div>
        <section aria-label={t("usage.totals.title")}>
          <h3>{t("usage.totals.title")}</h3>
          <dl class="agent-usage-totals">
            <div>
              <dt>{t("usage.totals.tokens")}</dt>
              <dd>
                <Amount value={analyticsTokens(totals())} />
              </dd>
            </div>
            <For each={TOTAL_ROWS}>
              {(item) => (
                <div>
                  <dt>{t(item.label)}</dt>
                  <dd>
                    <Amount value={totals()[item.field]} />
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </section>
        <SlidingTabs.Root
          value={state.breakdown === "skill" && !props.result.skills ? "agent" : state.breakdown}
          onChange={(value) =>
            setState((draft) => {
              draft.breakdown = value;
            })
          }
        >
          <div class="agent-usage-section-header">
            <h3>{t("usage.breakdown.title")}</h3>
            <SlidingTabs.List aria-label={t("usage.breakdown.label")}>
              <SlidingTabs.Trigger value="model">{t("usage.breakdown.model")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="agent">{t("usage.breakdown.agent")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="day">{t("usage.breakdown.day")}</SlidingTabs.Trigger>
              <Show when={props.result.skills}>
                <SlidingTabs.Trigger value="skill">{t("usage.breakdown.skill")}</SlidingTabs.Trigger>
              </Show>
            </SlidingTabs.List>
          </div>
          <SlidingTabs.ContentSlot class="agent-usage-breakdown">
            <SlidingTabs.Content value="model">
              <ScrollEdges axis="x" viewClass="agent-usage-table" label={t("usage.breakdown.byModel")}>
                <table>
                  <caption class="sr-only">{t("usage.breakdown.byModel")}</caption>
                  <thead>
                    <BreakdownColumns label={t("usage.breakdown.model")} />
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
              </ScrollEdges>
            </SlidingTabs.Content>
            <SlidingTabs.Content value="agent">
              <ScrollEdges axis="x" viewClass="agent-usage-table" label={t("usage.breakdown.byAgent")}>
                <table>
                  <caption class="sr-only">{t("usage.breakdown.byAgent")}</caption>
                  <thead>
                    <BreakdownColumns label={t("usage.breakdown.agent")} />
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
              </ScrollEdges>
            </SlidingTabs.Content>
            <SlidingTabs.Content value="day">
              <ScrollEdges axis="x" viewClass="agent-usage-table" label={t("usage.breakdown.byDay")}>
                <table ref={dailyTable} tabindex={-1}>
                  <caption class="sr-only">{t("usage.breakdown.byDay")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("usage.column.date")}</th>
                      <th scope="col">{t("usage.column.costUsd")}</th>
                      <th scope="col">{t("usage.column.tokens")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={[...props.result.daily].reverse()}>
                      {(day) => (
                        <tr>
                          <th scope="row">{day.date}</th>
                          <td>{usageExactCost(day.estimatedCostUsd, text)}</td>
                          <td>{usageNumber(analyticsTokens(day), text)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </ScrollEdges>
            </SlidingTabs.Content>
            <Show when={props.result.skills}>
              {(skills) => (
                <SlidingTabs.Content value="skill">
                  <ScrollEdges axis="x" viewClass="agent-usage-table" label={t("usage.breakdown.bySkill")}>
                    <table>
                      <caption class="sr-only">{t("usage.breakdown.bySkill")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("usage.breakdown.skill")}</th>
                          <th scope="col">{t("usage.column.loads")}</th>
                          <th scope="col">{t("usage.column.cost")}</th>
                          <th scope="col">{t("usage.column.share")}</th>
                          <th scope="col">{t("usage.column.tokens")}</th>
                          <th scope="col">{t("usage.column.agents")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For
                          each={skills()}
                          fallback={
                            <tr>
                              <td colspan={6} class="agent-usage-table-empty">
                                {t("usage.breakdown.skillEmpty")}
                              </td>
                            </tr>
                          }
                        >
                          {(skill) => (
                            <tr>
                              <th scope="row">{skill.skill}</th>
                              <td>{format.number(skill.loads)}</td>
                              <td>
                                <Amount value={skill.estimatedCostUsd} cost />
                              </td>
                              <td>
                                {format.percent(skill.share, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                              </td>
                              <td>
                                <Amount value={skill.tokens} />
                              </td>
                              <td>{format.number(skill.agents)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </ScrollEdges>
                </SlidingTabs.Content>
              )}
            </Show>
          </SlidingTabs.ContentSlot>
        </SlidingTabs.Root>
      </Show>
      <footer class="agent-usage-footer">
        <p>
          {t("usage.footer", {
            started: format.date(new Date(props.result.collectionStartedAt)),
            updated: props.result.updatedAt
              ? format.date(new Date(props.result.updatedAt), UPDATED_AT_FORMAT)
              : t("usage.updatedNever"),
          })}
        </p>
        <details>
          <summary>{t("usage.about.title")}</summary>
          <p>{t("usage.about.body")}</p>
          <p>{t("usage.about.tokens")}</p>
        </details>
      </footer>
    </>
  );
}
