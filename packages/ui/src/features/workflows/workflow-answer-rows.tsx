import { parseWorkflowAnswerSpec, type WorkflowAnswerType } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Input, Plus, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, X } from "@openbot/ui";
import { type Accessor, createEffect, createSignal, For, type Setter, Show, untrack } from "solid-js";
import { useText } from "../../text";

interface AnswerRowValue {
  name: string;
  type: WorkflowAnswerType;
  labels: string;
}

interface AnswerRow {
  value: AnswerRowValue;
  type: Accessor<WorkflowAnswerType>;
  setType: Setter<WorkflowAnswerType>;
  fresh: boolean;
}

const ANSWER_TYPES: WorkflowAnswerType[] = ["text", "number", "integer", "yes/no", "list", "choice"];

const ANSWER_TYPE_TEXT = {
  text: "workflow.answer.type.text",
  number: "workflow.answer.type.number",
  integer: "workflow.answer.type.integer",
  "yes/no": "workflow.answer.type.yesNo",
  list: "workflow.answer.type.list",
  choice: "workflow.answer.type.choice",
} as const satisfies Record<WorkflowAnswerType, AppTextKey>;

const LINE_BREAK = /[\n;]/u;
const ONE_OF = /^one of\s+/iu;

function splitLabels(text: string): string[] {
  return text
    .replace(ONE_OF, "")
    .split(text.includes("|") ? "|" : ",")
    .map((label) =>
      label
        .replace(/[;\n]/gu, " ")
        .trim()
        .replace(/^["']|["']$/gu, ""),
    )
    .filter(Boolean);
}

function labelsText(labels: readonly string[]): string {
  return labels.join(labels.some((label) => label.includes(",")) ? " | " : ", ");
}

export function answerRows(text: string): AnswerRowValue[] | null {
  const rows: AnswerRowValue[] = [];
  for (const line of text
    .split(LINE_BREAK)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const colon = line.indexOf(":");
    const name = (colon < 0 ? line : line.slice(0, colon)).trim();
    const typeText = colon < 0 ? "" : line.slice(colon + 1).trim();
    const spec = parseWorkflowAnswerSpec(`field: ${typeText}`);
    const field = spec.fields[0];
    if (field) {
      rows.push({ name, type: field.type, labels: labelsText(field.labels) });
      continue;
    }
    if (spec.problems[0]?.code !== "labels") return null;
    rows.push({ name, type: "choice", labels: labelsText(splitLabels(typeText)) });
  }
  return rows;
}

function choiceText(labels: readonly string[]): string {
  if (labels.length === 0) return "|";
  if (labels.length === 1) return `${labels[0]}|`;
  return labels.join("|");
}

function answerSpecText(rows: readonly AnswerRow[]): string {
  return rows
    .flatMap(({ value }) => {
      const name = value.name.replace(/[:;\n]/gu, "").trim();
      if (!name) return [];
      return [`${name}: ${value.type === "choice" ? choiceText(splitLabels(value.labels)) : value.type}`];
    })
    .join("\n");
}

function answerRow(value: AnswerRowValue, fresh: boolean): AnswerRow {
  const [type, setType] = createSignal<WorkflowAnswerType>(value.type);
  return { value: { ...value }, type, setType, fresh };
}

function rowsOf(text: string): AnswerRow[] {
  return (answerRows(text) ?? []).map((value) => answerRow(value, false));
}

export function AnswerRows(props: { value: string; locked: boolean; onChange: (value: string) => void }) {
  const { t } = useText();
  let list = untrack(() => rowsOf(props.value));
  let saved = untrack(() => props.value);
  let container: HTMLDivElement | undefined;
  const [rows, setRows] = createSignal<AnswerRow[]>(list);
  const show = (next: AnswerRow[]) => {
    list = next;
    setRows(next);
  };
  const save = () => {
    saved = answerSpecText(list);
    props.onChange(saved);
  };
  createEffect(
    () => props.value,
    (value) => {
      if (value === saved || answerRows(value) === null) return;
      saved = value;
      show(rowsOf(value));
    },
  );
  const add = () => show([...list, answerRow({ name: "", type: "text", labels: "" }, true)]);
  const remove = (row: AnswerRow) => {
    const index = list.indexOf(row);
    show(list.filter((candidate) => candidate !== row));
    save();
    requestAnimationFrame(() => {
      const buttons = container?.querySelectorAll<HTMLButtonElement>(".wfn-answer-remove");
      const next = buttons?.[Math.min(index, buttons.length - 1)];
      (next ?? container?.querySelector<HTMLButtonElement>(".wfn-answer-add"))?.focus();
    });
  };
  return (
    <div
      class="wfn-answer-rows"
      ref={(element: HTMLDivElement) => {
        container = element;
      }}
    >
      <For each={rows()}>
        {(row) => <AnswerFieldRow row={row} locked={props.locked} onChange={save} onRemove={() => remove(row)} />}
      </For>
      <Show when={!props.locked}>
        <Button variant="ghost" size="sm" class="wfn-answer-add" onClick={add}>
          <Plus aria-hidden="true" />
          {t("workflow.answer.add")}
        </Button>
      </Show>
    </div>
  );
}

function AnswerFieldRow(props: { row: AnswerRow; locked: boolean; onChange: () => void; onRemove: () => void }) {
  const { t } = useText();
  const row = props.row;
  return (
    <div class="wfn-answer-row">
      <Input
        size="sm"
        class="wfn-answer-name"
        aria-label={t("workflow.answer.name")}
        placeholder={t("workflow.answer.namePlaceholder")}
        spellcheck={false}
        autocomplete="off"
        readonly={props.locked}
        value={row.value.name}
        ref={(element: HTMLInputElement) => {
          if (row.fresh) requestAnimationFrame(() => element.focus());
        }}
        onValueChange={(next) => {
          row.value.name = next;
          props.onChange();
        }}
      />
      <Select<WorkflowAnswerType>
        options={ANSWER_TYPES}
        value={row.type()}
        disabled={props.locked}
        placement="bottom-start"
        onChange={(next) => {
          if (next === null || next === row.value.type) return;
          row.value.type = next;
          row.setType(next);
          props.onChange();
        }}
        itemComponent={(item) => <SelectItem item={item.item}>{t(ANSWER_TYPE_TEXT[item.item.rawValue])}</SelectItem>}
      >
        <SelectTrigger size="sm" class="wfn-answer-type" aria-label={t("workflow.answer.typeLabel")}>
          <SelectValue<WorkflowAnswerType>>{(state) => t(ANSWER_TYPE_TEXT[state.selectedOption()])}</SelectValue>
        </SelectTrigger>
        <SelectContent data-wfn-portal="" />
      </Select>
      <Show when={!props.locked}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="wfn-answer-remove"
          aria-label={t("workflow.answer.remove")}
          onClick={() => props.onRemove()}
        >
          <X aria-hidden="true" />
        </Button>
      </Show>
      <Show when={row.type() === "choice"}>
        <Input
          size="sm"
          class="wfn-answer-values"
          aria-label={t("workflow.answer.values")}
          placeholder={t("workflow.answer.valuesPlaceholder")}
          spellcheck={false}
          autocomplete="off"
          readonly={props.locked}
          value={row.value.labels}
          onValueChange={(next) => {
            row.value.labels = next;
            props.onChange();
          }}
        />
      </Show>
    </div>
  );
}
