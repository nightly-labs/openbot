import { Button, Plus, Workflow } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { SwitcherWorkflow } from "./WorkflowSwitcher";

export function WorkflowDeletedState(props: {
  workflows: readonly SwitcherWorkflow[];
  onOpen: (workflowId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useText();
  return (
    <div class="wfn-empty wfn-deleted">
      <span class="wfn-menu-icon wfn-empty-icon" aria-hidden="true">
        <Workflow />
      </span>
      <h2 class="wfn-empty-title">
        {props.workflows.length === 0 ? t("workflow.canvas.deleted.none") : t("workflow.canvas.deleted.open")}
      </h2>
      <Show when={props.workflows.length > 0}>
        <ul class="wfn-deleted-list" aria-label={t("workflow.canvas.switcher.label")}>
          <For each={props.workflows} keyed={(workflow) => workflow.id}>
            {(workflow) => (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="wfn-deleted-item"
                  onClick={() => props.onOpen(workflow().id)}
                >
                  <span class="wfn-deleted-name">{workflow().title}</span>
                  <span class="wfn-deleted-steps">
                    {t("workflow.canvas.switcher.steps", { count: workflow().steps })}
                  </span>
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Button type="button" size="sm" onClick={() => props.onCreate()}>
        <Plus aria-hidden="true" />
        {t("workflow.canvas.switcher.new")}
      </Button>
    </div>
  );
}
