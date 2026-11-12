/** A condition: a rule that sends the run down one of two branches. */

import { AGENT_REASONING_EFFORTS, type AgentModelId, type AgentReasoningEffort } from "@openbot/contracts/ipc";
import { Button, CircleCheck, Play, Split, Textarea } from "@openbot/ui";
import { createMemo, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { BRANCH_NAME, resultValue, useBoard } from "./workflow-board";
import { defaultWorkflowModel } from "./workflow-model";
import { EffortPill, ModelPill, modelOption } from "./workflow-model-pills";
import {
  asProvider,
  asString,
  FailureAlert,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  Port,
  useField,
  useLocked,
  useStepRun,
  useTextField,
  type WfProvider,
} from "./workflow-node-parts";

const BRANCHES = ["yes", "no"] as const;

/**
 * A rule that sends the run down one of two branches, and the model that judges it. Each branch has
 * its own output port on its row. After a run, the branch that the run took has a check and the
 * other branch dims.
 */
export function ConditionNode(props: { id: string; rule?: string }) {
  const board = useBoard();
  const { t } = useText();
  const [rule, setRule] = useTextField(
    () => props.id,
    "rule",
    untrack(() => props.rule ?? ""),
  );
  const models = () => board.catalogs().models;
  // A condition saved before it had a model has none, and the host chooses the model and effort of
  // each run. The model pill then says Auto, and the effort pill shows when the user chooses a model.
  const [model] = useField<AgentModelId>(() => props.id, "model", "", asString);
  const [provider] = useField<WfProvider | "">(() => props.id, "provider", "", asProvider);
  const [effort, setEffort] = useField<AgentReasoningEffort | "">(
    () => props.id,
    "effort",
    "",
    oneOf(AGENT_REASONING_EFFORTS),
  );
  const chosen = () => modelOption(models(), model());
  /** The provider tab that the model menu opens on: the one of the step, else the one of a new step. */
  const tab = createMemo(
    (): WfProvider => provider() || chosen()?.provider || defaultWorkflowModel(board.catalogs())?.provider || "codex",
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
        <div class="wfn-field-foot wfn-condition-foot">
          <ModelPill
            provider={tab()}
            value={model()}
            placeholder={t("workflow.model.auto")}
            disabled={locked()}
            onChange={(next, nextProvider) => {
              const options = modelOption(models(), next);
              const current = effort();
              const keep = current !== "" && options?.supportedReasoningEfforts.includes(current);
              board.setFields(props.id, {
                model: next,
                provider: nextProvider,
                ...(keep ? {} : { effort: options?.defaultReasoningEffort ?? "medium" }),
              });
            }}
          />
          <Show when={model()}>
            <EffortPill
              efforts={chosen()?.supportedReasoningEfforts ?? []}
              value={effort() || chosen()?.defaultReasoningEffort || "medium"}
              disabled={locked()}
              onChange={setEffort}
            />
          </Show>
        </div>
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
