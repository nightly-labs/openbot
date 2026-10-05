import { For, Show } from "solid-js";
import {
  BENCHMARK_METHOD_URL,
  BENCHMARK_URL,
  type Benchmark,
  type BenchmarkRow,
} from "../../content/compare/comparison";
import { formatArticleDate } from "../../lib/content-collection";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import { RevealSection } from "./CompareParts";
import { RivalMark } from "./RivalMark";

type Measure = "score" | "costUsd" | "minutes";

const MEASURES: readonly { key: Measure; label: string; hint: string; format: (value: number) => string }[] = [
  { key: "score", label: "Index score", hint: "Higher is better", format: (value) => `${value}` },
  { key: "costUsd", label: "API cost per task", hint: "Lower is better", format: (value) => `$${value.toFixed(2)}` },
  { key: "minutes", label: "Time per task", hint: "Lower is better", format: (value) => `${Math.round(value)} min` },
];

// The Artificial Analysis Coding Agent Index as a table with a bar in each cell: the
// table is the chart and its own text version. Each measure has its own column and
// scale, from zero to the largest value in the column. A bar takes the colour of its
// agent; the row names the agent, so the colour is never the only label.
export function CompareBenchmark(props: { benchmark: Benchmark }) {
  const largest = (key: Measure) => Math.max(...props.benchmark.rows.map((row) => row[key]));
  const share = (row: BenchmarkRow, key: Measure) => row[key] / largest(key);

  return (
    <RevealSection class="compare-bench" titleId="compare-bench-title" title="By the numbers">
      <p class="compare-bench-takeaway">{props.benchmark.takeaway}</p>
      <div class="compare-table-frame">
        <table class="compare-table compare-bench-table">
          <caption class="landing-visually-hidden">
            Artificial Analysis Coding Agent Index, read on {formatArticleDate(props.benchmark.checkedAt)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Agent and model</th>
              <For each={MEASURES}>
                {(measure) => (
                  <th scope="col">
                    {measure.label}
                    <span class="compare-bench-hint">{measure.hint}</span>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.benchmark.rows}>
              {(row, index) => (
                <tr data-agent={row.agent} style={{ "--compare-index": index() }}>
                  <th scope="row">
                    <span class="compare-bench-agent">
                      <RivalMark name={row.agent} class="compare-table-logo compare-mark-rival" />
                      <span>
                        <span class="compare-bench-name">{row.name}</span>
                        <span class="compare-bench-model">{row.model}</span>
                        <Show when={row.note}>{(note) => <span class="compare-bench-note">{note()}</span>}</Show>
                      </span>
                    </span>
                  </th>
                  <For each={MEASURES}>
                    {(measure) => (
                      <td>
                        <span class="compare-bench-cell">
                          <span
                            class="compare-bench-bar"
                            style={{ "--compare-bench-share": share(row, measure.key) }}
                            aria-hidden="true"
                          />
                          <span class="compare-bench-value">{measure.format(row[measure.key])}</span>
                        </span>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <p class="compare-bench-credit">
        Data from the{" "}
        <a href={BENCHMARK_URL} target="_blank" rel={EXTERNAL_LINK_REL}>
          Artificial Analysis Coding Agent Index
        </a>
        , read on <time datetime={props.benchmark.checkedAt}>{formatArticleDate(props.benchmark.checkedAt)}</time>. Cost
        is what a task costs at pay-per-token API prices, not a plan price. Each row is one agent with one model, tested
        the{" "}
        <a href={BENCHMARK_METHOD_URL} target="_blank" rel={EXTERNAL_LINK_REL}>
          way Artificial Analysis describes
        </a>
        .
      </p>
    </RevealSection>
  );
}
