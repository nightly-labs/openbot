/** A condition: a rule that sends the run down one of two branches. */

import { Button, CircleCheck, Play, Split, Textarea } from "@openbot/ui";
import { For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { BRANCH_NAME, resultValue, useBoard } from "./workflow-board";
import {
  FailureAlert,
  Field,
  NodeShell,
  NodeToolbar,
  Port,
  useLocked,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";

const BRANCHES = ["yes", "no"] as const;

/**
 * A rule that sends the run down one of two branches. Each branch has its own output port on its
 * row. After a run, the branch that the run took has a check and the other branch dims.
 */
export function ConditionNode(props: { id: string; rule?: string }) {
  const board = useBoard();
  const { t } = useText();
  const [rule, setRule] = useTextField(
    () => props.id,
    "rule",
    untrack(() => props.rule ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const taken = () => (run.running() ? undefined : resultValue(board.shown(props.id)));
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={locked() || !board.connected(props.id, "in", "text")}
          onClick={run.start}
        >
          {t("workflow.node.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.condition.title")}
      icon={<Split aria-hidden="true" />}
      kind="condition"
      inputs={["text"]}
      requires
      toolbar={<NodeToolbar id={props.id} name={t("workflow.condition.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-block-field">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.condition.rule")}
          placeholder={t("workflow.condition.rulePlaceholder")}
          readonly={locked()}
          value={rule()}
          onValueChange={setRule}
        />
      </Field>
      <For each={BRANCHES}>
        {(branch) => (
          <div
            class="wfn-branch"
            data-taken={taken() === branch ? "" : undefined}
            data-skipped={taken() !== undefined && taken() !== branch ? "" : undefined}
          >
            <span class="wfn-branch-name">{t(BRANCH_NAME[branch])}</span>
            <Show when={taken() === branch}>
              <span class="wfn-branch-check" role="img" aria-label={t("workflow.condition.taken")}>
                <CircleCheck aria-hidden="true" />
              </span>
            </Show>
            <span class="wfn-branch-port">
              <Port node={props.id} type="text" side="out" branch={branch} label={t(BRANCH_NAME[branch])} />
            </span>
          </div>
        )}
      </For>
      <FailureAlert id={props.id} running={run.running()} />
    </NodeShell>
  );
}
