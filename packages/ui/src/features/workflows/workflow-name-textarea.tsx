import {
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowAnswerField,
  type WorkflowAnswerSource,
  type WorkflowAnswerType,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { Braces, IconButton, Listbox, Popover, Textarea, type TextareaProps } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, flush, omit, Show } from "solid-js";
import { useText } from "../../text";
import { KIND_LABEL } from "./WorkflowAddMenu";
import { useBoard } from "./workflow-board";

interface NameQuery {
  start: number;
  end: number;
  typed: string;
  opened?: true;
}

interface NameOption {
  name: string;
  steps: string[];
  detail: string;
}

const TYPED_NAME = /\{\{\s*([A-Za-z0-9_]{0,40})$/u;
const OPENED_NAME = /^[A-Za-z0-9_]{0,40}$/u;
const NAME_REST = /^[A-Za-z0-9_]*/u;
const CLOSING = /^\s*\}\}/u;

function nameQuery(text: string, caret: number): NameQuery | null {
  const typed = TYPED_NAME.exec(text.slice(0, caret))?.[1];
  return typed === undefined ? null : { start: caret - typed.length, end: caret, typed };
}

const TYPE_LABEL: Readonly<Record<WorkflowAnswerType, AppTextKey>> = {
  text: "workflow.names.type.text",
  number: "workflow.names.type.number",
  integer: "workflow.names.type.integer",
  "yes/no": "workflow.names.type.yesNo",
  list: "workflow.names.type.list",
  choice: "workflow.names.type.choice",
};

function sourceStep(t: AppTranslate, source: WorkflowAnswerSource): string {
  const name = source.node.fields[WORKFLOW_STEP_NAME_FIELD];
  return (typeof name === "string" && name.trim()) || t(KIND_LABEL[source.node.kind]);
}

function fieldDetail(t: AppTranslate, field: WorkflowAnswerField): string {
  return field.labels.length > 0 ? field.labels.join(", ") : t(TYPE_LABEL[field.type]);
}

function nameOptions(t: AppTranslate, sources: readonly WorkflowAnswerSource[]): NameOption[] {
  const options = new Map<string, NameOption>();
  for (const source of sources) {
    const step = sourceStep(t, source);
    for (const field of source.fields) {
      const known = options.get(field.name);
      if (!known) options.set(field.name, { name: field.name, steps: [step], detail: fieldDetail(t, field) });
      else if (!known.steps.includes(step)) known.steps.push(step);
    }
  }
  return [...options.values()];
}

function withName(text: string, query: NameQuery, name: string): { text: string; caret: number } {
  if (query.opened) {
    const before = text.slice(0, query.start);
    const gap = before === "" || /\s$/u.test(before) ? "" : " ";
    const head = `${before}${gap}{{${name}}}`;
    return { text: `${head}${text.slice(query.end)}`, caret: head.length };
  }
  const after = text.slice(query.end);
  const rest = after.slice(NAME_REST.exec(after)?.[0].length ?? 0);
  const closing = CLOSING.exec(rest)?.[0] ?? "";
  const head = `${text.slice(0, query.start)}${name}${closing || "}}"}`;
  return { text: `${head}${rest.slice(closing.length)}`, caret: head.length };
}

export type NameTextareaProps = Omit<TextareaProps, "value" | "onValueChange"> & {
  node: string;
  value: string;
  onValueChange: (value: string) => void;
};

export function NameTextarea(props: NameTextareaProps) {
  const board = useBoard();
  const { t } = useText();
  const listId = createUniqueId();
  const textareaProps = omit(props, "node", "value", "onValueChange", "onKeyDown", "onBlur", "ref");
  const [query, setQuery] = createSignal<NameQuery | null>(null);
  const [active, setActive] = createSignal(0);
  let field: HTMLTextAreaElement | undefined;
  let fieldHadFocus = false;
  const available = createMemo(() =>
    props.readonly || board.catalogs().answers !== true ? [] : nameOptions(t, board.answerSources(props.node)),
  );
  const names = createMemo(() => {
    const found = query();
    if (!found) return [];
    const typed = found.typed.toLowerCase();
    return available().filter((option) => option.name.toLowerCase().startsWith(typed));
  });
  const open = () => names().length > 0;
  const activeOption = () => names()[Math.min(active(), names().length - 1)];
  const activeKeys = () => {
    const option = activeOption();
    return option ? [option.name] : [];
  };
  const optionId = (option: NameOption | undefined) => `${listId}-${option ? names().indexOf(option) : -1}`;
  const activeId = () => (open() ? optionId(activeOption()) : undefined);
  const listControls = () => (open() ? listId : undefined);
  const expanded = () => (open() ? "true" : "false");
  const openedQuery = (element: HTMLTextAreaElement): NameQuery | null => {
    const current = query();
    if (!current?.opened || element.selectionStart !== element.selectionEnd) return null;
    const caret = element.selectionStart;
    const typed = element.value.slice(current.start, caret);
    return caret >= current.start && OPENED_NAME.test(typed) ? { ...current, end: caret, typed } : null;
  };
  const look = (element: HTMLTextAreaElement) => {
    const next =
      openedQuery(element) ??
      (element.selectionStart === element.selectionEnd ? nameQuery(element.value, element.selectionStart) : null);
    setQuery(next);
    setActive(0);
  };
  const openList = () => {
    if (!field) return;
    const caret = fieldHadFocus ? field.selectionStart : props.value.length;
    field.focus();
    field.setSelectionRange(caret, caret);
    setQuery({ start: caret, end: caret, typed: "", opened: true });
    setActive(0);
  };
  const choose = (name: string) => {
    const found = query();
    if (!found || !field) return;
    const next = withName(props.value, found, name);
    props.onValueChange(next.text);
    flush();
    field.setSelectionRange(next.caret, next.caret);
    setQuery(null);
  };
  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (!open() || event.isComposing) return;
    const count = names().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const option = activeOption();
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      choose(option.name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };
  return (
    <div class="wfn-name-box">
      <Textarea
        {...textareaProps}
        ref={(element: HTMLTextAreaElement) => {
          field = element;
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded()}
        aria-controls={listControls()}
        aria-activedescendant={activeId()}
        value={props.value}
        onValueChange={(value) => {
          props.onValueChange(value);
          if (field) look(field);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
          if (event.key.startsWith("Arrow") && !open()) look(event.currentTarget);
        }}
        onPointerUp={(event: PointerEvent & { currentTarget: HTMLTextAreaElement }) => look(event.currentTarget)}
        onBlur={() => setQuery(null)}
      />
      <Show when={available().length > 0}>
        <IconButton
          class="wfn-name-insert"
          variant="ghost"
          size="icon-xs"
          label={t("workflow.names.insert")}
          onPointerDown={(event: PointerEvent) => {
            fieldHadFocus = document.activeElement === field;
            event.preventDefault();
          }}
          onClick={() => {
            openList();
            fieldHadFocus = false;
          }}
        >
          <Braces />
        </IconButton>
      </Show>
      <Popover.Root
        open={open()}
        onOpenChange={(next) => {
          if (!next) setQuery(null);
        }}
        anchorRef={() => field}
        placement="bottom-start"
        gutter={4}
      >
        <Popover.Portal>
          <Popover.Content
            class="ui-popover-menu-surface wfn-popover wfn-name-popover"
            data-wfn-portal=""
            onOpenAutoFocus={(event: Event) => event.preventDefault()}
            onCloseAutoFocus={(event: Event) => event.preventDefault()}
          >
            <Show when={open()}>
              <Listbox.Root<NameOption>
                as="div"
                id={listId}
                aria-label={t("workflow.names.title")}
                class="wfn-picker-list wfn-model-list"
                options={names()}
                optionValue={(option) => option.name}
                optionTextValue={(option) => option.name}
                selectionMode="single"
                disallowEmptySelection={true}
                allowDuplicateSelectionEvents={true}
                shouldUseVirtualFocus={true}
                shouldSelectOnPressUp={true}
                value={activeKeys()}
                onChange={(keys) => {
                  const name = keys.values().next().value;
                  if (name) choose(name);
                }}
                renderItem={(item) => (
                  <Listbox.Item
                    item={item}
                    id={optionId(item.rawValue)}
                    class="wfn-picker-row"
                    onPointerDown={(event: PointerEvent) => event.preventDefault()}
                  >
                    <span class="wfn-name-option">{item.rawValue.name}</span>
                    <span class="wfn-name-source">
                      {t("workflow.names.source", {
                        step: item.rawValue.steps.join(", "),
                        detail: item.rawValue.detail,
                      })}
                    </span>
                  </Listbox.Item>
                )}
              />
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
