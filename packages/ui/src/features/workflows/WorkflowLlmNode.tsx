/** An LLM step: one model call with no agent, no tools and no workspace. */

import { AGENT_REASONING_EFFORTS, type AgentModelId, type AgentReasoningEffort } from "@openbot/contracts/ipc";
import { Button, Play, Sparkles, Textarea } from "@openbot/ui";
import { untrack } from "solid-js";
import { useText } from "../../text";
import { useBoard } from "./workflow-board";
import { defaultWorkflowModel } from "./workflow-model";
import { EffortPill, ModelPill, modelOption } from "./workflow-model-pills";
import {
  asProvider,
  asString,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  ResultField,
  useField,
  useLocked,
  useStepRun,
  useTextField,
  type WfProvider,
} from "./workflow-node-parts";

/**
 * One model call with no agent, no tools and no workspace: a prompt, an optional system prompt and
 * the model with its effort, as the Higgsfield LLM Assistant has them.
 */
export function LlmNode(props: { id: string; prompt?: string; system?: string }) {
  const board = useBoard();
  const { t } = useText();
  const models = () => board.catalogs().models;
  const first = untrack(() => defaultWorkflowModel(board.catalogs()));
  const [model] = useField<AgentModelId>(() => props.id, "model", first?.id ?? "", asString);
  const [provider] = useField<WfProvider>(() => props.id, "provider", first?.provider ?? "codex", asProvider);
  const [effort, setEffort] = useField<AgentReasoningEffort>(
    () => props.id,
    "effort",
    first?.defaultReasoningEffort ?? "medium",
    oneOf(AGENT_REASONING_EFFORTS),
  );
  const [prompt, setPrompt] = useTextField(
    () => props.id,
    "prompt",
    untrack(() => props.prompt ?? ""),
  );
  const [system, setSystem] = useTextField(
    () => props.id,
    "system",
    untrack(() => props.system ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={!prompt().trim() || locked()}
          onClick={run.start}
        >
          {t("workflow.node.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.llm.title")}
      icon={<Sparkles aria-hidden="true" />}
      kind="llm"
      inputs={["text", "image", "file"]}
      output="text"
      toolbar={<NodeToolbar id={props.id} name={t("workflow.llm.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-field-task">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.prompt.title")}
          placeholder={t("workflow.prompt.placeholder")}
          readonly={locked()}
          value={prompt()}
          onValueChange={setPrompt}
        />
        <div class="wfn-field-foot">
          <ModelPill
            provider={provider()}
            value={model()}
            disabled={locked()}
            onChange={(next, nextProvider) => {
              const options = modelOption(models(), next);
              const keep = !options || options.supportedReasoningEfforts.includes(effort());
              board.setFields(props.id, {
                model: next,
                provider: nextProvider,
                ...(keep ? {} : { effort: options.defaultReasoningEffort }),
              });
            }}
          />
          <EffortPill
            efforts={modelOption(models(), model())?.supportedReasoningEfforts ?? []}
            value={effort()}
            disabled={locked()}
            onChange={setEffort}
          />
        </div>
      </Field>
      <Field class="wfn-field-system">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.llm.system")}
          placeholder={t("workflow.llm.systemPlaceholder")}
          readonly={locked()}
          value={system()}
          onValueChange={setSystem}
        />
      </Field>
      <ResultField id={props.id} running={run.running()} />
    </NodeShell>
  );
}
