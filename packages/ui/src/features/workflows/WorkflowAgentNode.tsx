import { ProviderLogo } from "@openbot/brand";
import { Bot, Button, buttonVariants, ChevronDown, DropdownMenu, Play, TriangleAlert } from "@openbot/ui";
import { Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { PickerMenu, type PickerOption } from "./WorkflowPicker";
import { AnswerAction, AnswerProblems } from "./workflow-answer-parts";
import { useBoard } from "./workflow-board";
import { InputPictures } from "./workflow-input-pictures";
import type { WorkflowCatalogs } from "./workflow-model";
import { modelOption } from "./workflow-model-pills";
import { NameField } from "./workflow-name-field";
import {
  asString,
  Field,
  NodeShell,
  NodeToolbar,
  ResultField,
  useField,
  useLocked,
  useStepRun,
  useTextField,
  wfProviderLogo,
} from "./workflow-node-parts";
import { StepSettingsAction } from "./workflow-step-settings";

function agentModelName(catalogs: WorkflowCatalogs, agent: AgentProfile): string {
  return modelOption(catalogs.models, agent.model)?.name ?? agent.model;
}

function agentOptions(catalogs: WorkflowCatalogs): PickerOption<string>[] {
  return catalogs.agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    tile: () => <AgentAvatar agent={agent} motion="idle" />,
    chips: [
      { text: agent.title },
      {
        icon: () => <ProviderLogo provider={wfProviderLogo(agent.provider)} class="wfn-model-logo" />,
        text: agentModelName(catalogs, agent),
      },
    ],
  }));
}

function AgentPill(props: {
  agent: AgentProfile | undefined;
  removed: boolean;
  disabled?: boolean;
  onChange: (agent: AgentProfile) => void;
}) {
  const board = useBoard();
  const { t } = useText();
  const label = () => {
    if (props.agent) return t("workflow.agent.pill", { name: props.agent.name });
    return props.removed ? t("workflow.agent.removedLabel") : t("workflow.agent.choose");
  };
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-agent-pill`}
        data-missing={props.removed ? "" : undefined}
        aria-label={label()}
        disabled={props.disabled}
      >
        <Show
          when={props.agent}
          fallback={
            <Show when={props.removed} fallback={<span>{t("workflow.agent.choose")}</span>}>
              <TriangleAlert aria-hidden="true" />
              <span>{t("workflow.agent.removed")}</span>
              <span class="wfn-pill-action">{t("workflow.agent.choose")}</span>
            </Show>
          }
        >
          {(agent) => (
            <>
              <AgentAvatar agent={agent()} class="wfn-avatar" motion="idle" />
              <span>{agent().name}</span>
            </>
          )}
        </Show>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={t("workflow.agent.list")}
          search={t("workflow.agent.search")}
          groups={[{ options: agentOptions(board.catalogs()) }]}
          value={props.agent?.id}
          onSelect={(id) => {
            const agent = board.catalogs().agents.find((candidate) => candidate.id === id);
            if (agent) props.onChange(agent);
          }}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AgentModel(props: { agent: AgentProfile }) {
  const board = useBoard();
  const { t } = useText();
  const name = () => agentModelName(board.catalogs(), props.agent);
  return (
    <span class="wfn-pill wfn-model-pill" data-static="">
      <ProviderLogo provider={wfProviderLogo(props.agent.provider)} class="wfn-model-logo" />
      <span class="sr-only">{t("workflow.model.label", { name: name() })}</span>
      <span aria-hidden="true">{name()}</span>
    </span>
  );
}

export function AgentNode(props: { id: string; agentId?: string; task?: string }) {
  const board = useBoard();
  const { t } = useText();
  const [agentId] = useField(
    () => props.id,
    "agentId",
    untrack(() => props.agentId ?? board.catalogs().agents[0]?.id ?? ""),
    asString,
  );
  const agent = () => board.catalogs().agents.find((candidate) => candidate.id === agentId());
  const [task, setTask] = useTextField(
    () => props.id,
    "task",
    untrack(() => props.task ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const pictures = () => (board.catalogs().agentFiles === true ? board.inputs(props.id, "image") : []);
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={!task().trim() || locked() || !agent()}
          onClick={run.start}
        >
          {t("workflow.agent.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.agent.title")}
      icon={<Bot aria-hidden="true" />}
      kind="agent"
      inputs={["text", "image", "file"]}
      output="text"
      toolbar={
        <NodeToolbar id={props.id} name={t("workflow.agent.name")} locked={locked()} onLock={setLocked}>
          <AnswerAction id={props.id} field="answer" locked={locked()} />
          <StepSettingsAction id={props.id} kind="agent" />
        </NodeToolbar>
      }
    >
      <Field class="wfn-field-task">
        <Show when={pictures().length > 0}>
          <InputPictures sources={pictures()} />
        </Show>
        <NameField
          node={props.id}
          class="wfn-input"
          aria-label={t("workflow.agent.task")}
          placeholder={t("workflow.agent.taskPlaceholder")}
          readonly={locked()}
          value={task()}
          onValueChange={setTask}
        />
        <div class="wfn-field-foot">
          <AgentPill
            agent={agent()}
            removed={agentId() !== "" && !agent()}
            disabled={locked()}
            onChange={(choice) => board.setFields(props.id, { agentId: choice.id, provider: choice.provider })}
          />
          <Show when={agent()}>{(found) => <AgentModel agent={found()} />}</Show>
        </div>
      </Field>
      <AnswerProblems id={props.id} />
      <ResultField id={props.id} running={run.running()} />
    </NodeShell>
  );
}
