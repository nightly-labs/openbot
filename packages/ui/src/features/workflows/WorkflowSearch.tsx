/** The canvas search: it finds a step by its name, its fields or its results, and shows the step. */

import type { WorkflowNodeKind } from "@openbot/contracts/ipc";
import { Button, Input, Search, X } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { AddItemLabel, addItem } from "./WorkflowAddMenu";
import { HudButton } from "./WorkflowCanvasHud";

/** The part of a text around the first match, so a long prompt shows where the words are. */
function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, at - 24);
  const part = flat.slice(start, start + 72);
  return `${start > 0 ? "…" : ""}${part}${start + 72 < flat.length ? "…" : ""}`;
}

export interface SearchMatch {
  node: { id: string; kind: WorkflowNodeKind };
  /** The text that holds the query. */
  text: string;
}

export function WorkflowSearch(props: {
  query: string;
  matches: readonly SearchMatch[];
  onQuery: (query: string) => void;
  onShow: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const show = (id: string) => {
    props.onShow(id);
    props.onClose();
  };
  return (
    <search class="wfn-hud wfn-search" aria-label={t("workflow.canvas.search.label")}>
      <div class="wfn-search-field">
        <Search class="wfn-search-icon" aria-hidden="true" />
        <Input
          ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())}
          class="wfn-search-input"
          aria-label={t("workflow.canvas.search.field")}
          placeholder={t("workflow.canvas.search.placeholder")}
          spellcheck={false}
          value={props.query}
          onValueChange={props.onQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClose();
            const first = props.matches[0];
            if (event.key === "Enter" && first) show(first.node.id);
          }}
        />
        <HudButton label={t("workflow.canvas.search.close")} keys={["Esc"]} onClick={props.onClose}>
          <X />
        </HudButton>
      </div>
      <Show when={props.query.trim()} fallback={<p class="wfn-search-empty">{t("workflow.canvas.search.empty")}</p>}>
        <Show
          when={props.matches.length > 0}
          fallback={
            <p class="wfn-search-empty">{t("workflow.canvas.search.noMatch", { query: props.query.trim() })}</p>
          }
        >
          <ul class="wfn-search-results">
            <For each={props.matches}>
              {(entry) => (
                <li>
                  <Button variant="ghost" size="sm" class="wfn-search-result" onClick={() => show(entry.node.id)}>
                    <AddItemLabel item={addItem(entry.node.kind)} />
                    <span class="wfn-search-snippet">{snippet(entry.text, props.query)}</span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </search>
  );
}
