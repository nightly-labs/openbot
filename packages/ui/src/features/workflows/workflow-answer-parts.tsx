import {
  parseWorkflowAnswerSpec,
  type WORKFLOW_ANSWER_FIELD,
  WORKFLOW_CHECK_FIELD,
  type WorkflowAnswerProblem,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { ListChecks, Popover, Textarea, TriangleAlert } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { useBoard } from "./workflow-board";
import { asString, ToolAction, useField } from "./workflow-node-parts";

type AnswerKey = typeof WORKFLOW_ANSWER_FIELD | typeof WORKFLOW_CHECK_FIELD;

export function answerProblemText(t: AppTranslate, problem: WorkflowAnswerProblem): string {
  switch (problem.code) {
    case "spec":
      switch (problem.spec.code) {
        case "name":
          return t("workflow.answer.problem.name", { line: problem.spec.line });
        case "type":
          return t("workflow.answer.problem.type", { name: problem.spec.name });
        case "labels":
          return t("workflow.answer.problem.labels", { name: problem.spec.name });
        case "duplicate":
          return t("workflow.answer.problem.duplicate", { name: problem.spec.name });
        case "many":
          return t("workflow.answer.problem.many");
      }
      break;
    case "check":
      return t("workflow.answer.problem.check");
    case "field":
    case "template":
      return t("workflow.answer.problem.field", { name: problem.name });
    case "test":
      return t("workflow.answer.problem.test", { name: problem.name });
    case "conflict":
      return t("workflow.answer.problem.conflict", { name: problem.name });
  }
}

export function useAnswerText(id: () => string, key: AnswerKey): [() => string, (value: string) => void] {
  const board = useBoard();
  const [value] = useField(id, key, "", asString);
  return [value, (next) => board.setField(id(), key, next, true)];
}

export function AnswerAction(props: { id: string; field: AnswerKey; locked: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [value, setValue] = useAnswerText(() => props.id, props.field);
  const check = () => props.field === WORKFLOW_CHECK_FIELD;
  const names = () => (check() ? board.answerNames(props.id) : []);
  let trigger: HTMLButtonElement | undefined;
  return (
    <Show when={board.catalogs().answers === true}>
      <ToolAction
        text={check() ? t("workflow.check.title") : t("workflow.answer.title")}
        icon={<ListChecks />}
        expanded={open()}
        ref={(element) => {
          trigger = element;
        }}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover.Root open={open()} onOpenChange={setOpen} anchorRef={() => trigger} placement="bottom-start" gutter={8}>
        <Popover.Portal>
          <Popover.Content
            class="ui-popover-menu-surface wfn-popover wfn-answer-popover"
            data-wfn-portal=""
            onInteractOutside={(event) => {
              if (event.target instanceof Node && trigger?.contains(event.target)) event.preventDefault();
            }}
          >
            <Popover.Title class="wfn-popover-title">
              {check() ? t("workflow.check.title") : t("workflow.answer.title")}
            </Popover.Title>
            <Textarea
              class="wfn-input wfn-answer-input"
              aria-label={check() ? t("workflow.check.title") : t("workflow.answer.title")}
              placeholder={check() ? t("workflow.check.placeholder") : t("workflow.answer.placeholder")}
              readonly={props.locked}
              spellcheck={false}
              value={value()}
              onValueChange={setValue}
            />
            <Show when={names().length > 0}>
              <p class="wfn-answer-names">{t("workflow.check.fields", { names: names().join(", ") })}</p>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Show>
  );
}

export function AnswerSummary(props: { id: string; field: AnswerKey }) {
  const board = useBoard();
  const { t } = useText();
  const [value] = useAnswerText(() => props.id, props.field);
  const text = () => {
    const spec = value().trim();
    if (!spec || board.catalogs().answers !== true) return "";
    if (props.field === WORKFLOW_CHECK_FIELD) return spec;
    const names = parseWorkflowAnswerSpec(spec).fields.map((field) => field.name);
    return names.length > 0 ? names.join(", ") : spec;
  };
  return (
    <Show when={text()}>
      {(shown) => (
        <p class="wfn-answer-summary">
          <ListChecks class="wfn-answer-summary-icon" aria-hidden="true" />
          <span class="sr-only">
            {props.field === WORKFLOW_CHECK_FIELD ? t("workflow.check.title") : t("workflow.answer.title")}
          </span>
          <span class="wfn-answer-summary-text">{shown()}</span>
        </p>
      )}
    </Show>
  );
}

export function AnswerProblems(props: { id: string }) {
  const board = useBoard();
  const { t } = useText();
  const problems = () => (board.catalogs().answers === true ? board.answerProblems(props.id) : []);
  return (
    <For each={problems()}>
      {(problem) => (
        <p class="wfn-alert" data-tone="warning">
          <TriangleAlert aria-hidden="true" />
          <span class="wfn-alert-text">{answerProblemText(t, problem)}</span>
        </p>
      )}
    </For>
  );
}
