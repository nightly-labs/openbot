import {
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowAnswerField,
  type WorkflowAnswerProblem,
  type WorkflowAnswerSource,
  type WorkflowAnswerType,
  type WorkflowNodeKind,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { Braces, IconButton, Listbox, Popover } from "@openbot/ui";
import { createEffect, createMemo, createSignal, createUniqueId, Show, untrack } from "solid-js";
import { referenceChipClasses } from "../../reference-chip";
import { useText } from "../../text";
import { addItem, KIND_LABEL } from "./WorkflowAddMenu";
import { answerProblemText } from "./workflow-answer-parts";
import { useBoard } from "./workflow-board";

interface NameQuery {
  start: number;
  end: number;
  typed: string;
  opened?: true;
}

interface NameOption {
  name: string;
  kind: WorkflowNodeKind;
  steps: string[];
  detail: string;
}

interface NameMatch {
  option: NameOption;
  at: number;
}

interface Snapshot {
  text: string;
  caret: number;
}

type EditKind = "type" | "delete" | "edit";

const TYPED_NAME = /\{\{\s*([A-Za-z0-9_]{0,40})$/u;
const OPENED_NAME = /^[A-Za-z0-9_]{0,40}$/u;
const NAME_REST = /^[A-Za-z0-9_]*/u;
const CLOSING = /^\s*\}\}/u;
const FIELD_NAME = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/gu;
const HAS_FIELD_NAME = new RegExp(FIELD_NAME.source, "u");
const BLOCK = /^(DIV|P)$/u;
const HISTORY = 100;
const CHIP = "wfn-name-chip";
const CHIP_PROBLEMS: ReadonlySet<WorkflowAnswerProblem["code"]> = new Set(["template", "conflict", "path", "repeated"]);

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
      if (!known)
        options.set(field.name, {
          name: field.name,
          kind: source.node.kind,
          steps: [step],
          detail: fieldDetail(t, field),
        });
      else if (!known.steps.includes(step)) known.steps.push(step);
    }
  }
  return [...options.values()];
}

function matchNames(options: readonly NameOption[], typed: string): NameMatch[] {
  const needle = typed.toLowerCase();
  const found = options.flatMap((option) => {
    const at = option.name.toLowerCase().indexOf(needle);
    return at < 0 ? [] : [{ option, at }];
  });
  return [...found.filter((match) => match.at === 0), ...found.filter((match) => match.at > 0)];
}

function MatchedName(props: { name: string; at: number; size: number }) {
  return (
    <span class="wfn-name-option">
      {props.name.slice(0, props.at)}
      <Show when={props.size > 0}>
        <span class="wfn-name-match">{props.name.slice(props.at, props.at + props.size)}</span>
      </Show>
      {props.name.slice(props.at + props.size)}
    </span>
  );
}

function withName(text: string, query: NameQuery, name: string): Snapshot {
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

function isEnd(node: Node | undefined): boolean {
  return node instanceof HTMLBRElement && node.dataset.end !== undefined;
}

function isTrailingPlaceholder(node: Node, before: string): boolean {
  return (
    node instanceof HTMLBRElement &&
    !isEnd(node) &&
    node.nextSibling === null &&
    (before === "" || before.endsWith("\n"))
  );
}

function nodeText(node: Node): string {
  if (node instanceof Text) return node.data;
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.raw !== undefined) return node.dataset.raw;
  if (node instanceof HTMLBRElement) return isEnd(node) ? "" : "\n";
  return fieldText(node);
}

function fieldText(parent: Node): string {
  let text = "";
  for (const node of parent.childNodes) {
    if (node instanceof HTMLElement && BLOCK.test(node.tagName) && text !== "" && !text.endsWith("\n")) text += "\n";
    if (isTrailingPlaceholder(node, text)) continue;
    text += nodeText(node);
  }
  return text;
}

function offsetAt(field: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(field);
  range.setEnd(node, offset);
  return fieldText(range.cloneContents()).length;
}

function selectionIn(field: HTMLElement): { start: number; end: number } | null {
  const selection = document.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !field.contains(range.startContainer) || !field.contains(range.endContainer)) return null;
  return {
    start: offsetAt(field, range.startContainer, range.startOffset),
    end: offsetAt(field, range.endContainer, range.endOffset),
  };
}

function pointAt(field: HTMLElement, offset: number): [Node, number] {
  let left = offset;
  const nodes = [...field.childNodes];
  for (const [index, node] of nodes.entries()) {
    const size = nodeText(node).length;
    if (node instanceof Text) {
      if (left <= size) return [node, left];
    } else if (left <= 0) return [field, index];
    else if (left < size) return [field, index + 1];
    left -= size;
  }
  return [field, isEnd(nodes.at(-1)) ? nodes.length - 1 : nodes.length];
}

function select(field: HTMLElement, start: number, end = start) {
  const [anchor, anchorOffset] = pointAt(field, start);
  const [focus, focusOffset] = pointAt(field, end);
  document.getSelection()?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
}

function createChip(raw: string, name: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${referenceChipClasses.root} ${CHIP}`;
  chip.contentEditable = "false";
  chip.dataset.raw = raw;
  chip.dataset.name = name;
  chip.textContent = name;
  return chip;
}

function markChips(field: HTMLElement, problems: ReadonlyMap<string, string>) {
  for (const chip of field.querySelectorAll<HTMLElement>(`.${CHIP}`)) {
    const problem = problems.get(chip.dataset.name ?? "");
    if (problem === undefined) {
      delete chip.dataset.problem;
      chip.removeAttribute("title");
    } else {
      chip.dataset.problem = "";
      chip.title = problem;
    }
  }
}

function renderField(field: HTMLElement, text: string, problems: ReadonlyMap<string, string>) {
  const parts: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(FIELD_NAME)) {
    if (match.index > last) parts.push(document.createTextNode(text.slice(last, match.index)));
    parts.push(createChip(match[0], match[1] ?? ""));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
  if (text.endsWith("\n")) {
    const end = document.createElement("br");
    end.dataset.end = "";
    parts.push(end);
  }
  field.replaceChildren(...parts);
  markChips(field, problems);
}

function isRendered(field: HTMLElement, text: string): boolean {
  const nodes = [...field.childNodes];
  const end = isEnd(nodes.at(-1));
  if (end !== text.endsWith("\n")) return false;
  const body = end ? nodes.slice(0, -1) : nodes;
  return body.every((node, index) =>
    node instanceof Text
      ? node.data !== "" && !(body[index - 1] instanceof Text) && !HAS_FIELD_NAME.test(node.data)
      : node instanceof HTMLElement && node.classList.contains(CHIP),
  );
}

function editKind(inputType: string): EditKind {
  if (inputType === "insertText" || inputType === "insertCompositionText") return "type";
  return inputType.startsWith("delete") ? "delete" : "edit";
}

export interface NameFieldProps {
  node: string;
  value: string;
  onValueChange: (value: string) => void;
  class?: string;
  "aria-label"?: string;
  placeholder?: string;
  readonly?: boolean;
}

export function NameField(props: NameFieldProps) {
  const board = useBoard();
  const { t } = useText();
  const listId = createUniqueId();
  const [query, setQuery] = createSignal<NameQuery | null>(null);
  const [active, setActive] = createSignal(0);
  let field: HTMLDivElement | undefined;
  let fieldHadFocus = false;
  let composing = false;
  let shown: Snapshot = { text: "", caret: 0 };
  let pending: { kind: EditKind; before: Snapshot } | null = null;
  let lastKind: EditKind | null = null;
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  const available = createMemo(() =>
    props.readonly || board.catalogs().answers !== true ? [] : nameOptions(t, board.answerSources(props.node)),
  );
  const chipProblems = createMemo(() => {
    const problems = new Map<string, string>();
    if (board.catalogs().answers !== true) return problems;
    for (const problem of board.answerProblems(props.node))
      if ("name" in problem && CHIP_PROBLEMS.has(problem.code) && !problems.has(problem.name))
        problems.set(problem.name, answerProblemText(t, problem));
    return problems;
  });
  const typed = () => query()?.typed ?? "";
  const names = createMemo(() => (query() ? matchNames(available(), typed()) : []));
  const open = () => query() !== null && available().length > 0;
  const activeMatch = () => names()[Math.min(active(), names().length - 1)];
  const activeOption = () => activeMatch()?.option;
  const activeKeys = () => {
    const option = activeOption();
    return option ? [option.name] : [];
  };
  const optionId = (match: NameMatch) => `${listId}-${names().indexOf(match)}`;
  const activeId = () => {
    const match = open() ? activeMatch() : undefined;
    return match ? optionId(match) : undefined;
  };
  const listControls = () => (open() && names().length > 0 ? listId : undefined);
  const expanded = () => (open() ? "true" : "false");
  const editable = () => (props.readonly ? "false" : "plaintext-only");
  const current = (element: HTMLElement): Snapshot => {
    const text = fieldText(element);
    return { text, caret: selectionIn(element)?.end ?? text.length };
  };
  const look = () => {
    if (!field) return;
    const text = fieldText(field);
    const range = selectionIn(field);
    const caret = range && range.start === range.end ? range.end : null;
    const found = query();
    const typed = found && caret !== null && caret >= found.start ? text.slice(found.start, caret) : null;
    const opened =
      found?.opened && typed !== null && OPENED_NAME.test(typed) ? { ...found, end: caret ?? 0, typed } : null;
    setQuery(opened ?? (caret === null ? null : nameQuery(text, caret)));
    setActive(0);
  };
  const commit = (kind: EditKind, before: Snapshot) => {
    if (!field) return;
    const next = current(field);
    if (!composing && !isRendered(field, next.text)) {
      renderField(field, next.text, chipProblems());
      select(field, next.caret);
    }
    if (next.text !== before.text) {
      if (kind === "edit" || kind !== lastKind) {
        past.push(before);
        if (past.length > HISTORY) past.shift();
      }
      future = [];
      lastKind = kind;
      props.onValueChange(next.text);
    }
    shown = next;
    look();
  };
  const apply = (next: Snapshot, kind: EditKind) => {
    if (!field) return;
    const before = current(field);
    renderField(field, next.text, chipProblems());
    select(field, next.caret);
    commit(kind, before);
  };
  const replaceSelection = (insert: string) => {
    if (!field) return;
    const text = fieldText(field);
    const range = selectionIn(field) ?? { start: text.length, end: text.length };
    apply(
      { text: `${text.slice(0, range.start)}${insert}${text.slice(range.end)}`, caret: range.start + insert.length },
      "edit",
    );
  };
  const travel = (from: Snapshot[], to: Snapshot[]) => {
    const target = from.pop();
    if (!field || !target) return;
    to.push(current(field));
    renderField(field, target.text, chipProblems());
    select(field, target.caret);
    shown = target;
    lastKind = null;
    props.onValueChange(target.text);
    look();
  };
  const undo = () => travel(past, future);
  const redo = () => travel(future, past);
  createEffect(
    () => props.value,
    (value) =>
      untrack(() => {
        if (!field || value === fieldText(field)) return;
        const focused = document.activeElement === field;
        renderField(field, value, chipProblems());
        shown = { text: value, caret: value.length };
        past = [];
        future = [];
        lastKind = null;
        if (focused) select(field, value.length);
      }),
  );
  createEffect(chipProblems, (problems) => {
    if (field) markChips(field, problems);
  });
  const openList = () => {
    if (!field) return;
    const caret = (fieldHadFocus ? selectionIn(field)?.end : undefined) ?? fieldText(field).length;
    field.focus();
    select(field, caret);
    setQuery({ start: caret, end: caret, typed: "", opened: true });
    setActive(0);
  };
  const choose = (name: string) => {
    const found = query();
    if (!found || !field) return;
    setQuery(null);
    apply(withName(fieldText(field), found, name), "edit");
  };
  const copy = (event: ClipboardEvent, cut: boolean) => {
    if (!field || !event.clipboardData) return;
    const range = selectionIn(field);
    if (!range || range.start === range.end) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", fieldText(field).slice(range.start, range.end));
    if (cut && !props.readonly) replaceSelection("");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === "z" || key === "y")) {
      if (props.readonly) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
      return;
    }
    if (!open()) return;
    const count = names().length;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
      event.preventDefault();
      event.stopPropagation();
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
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
  const onBeforeInput = (event: InputEvent) => {
    if (!field || props.readonly) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      if (event.inputType === "historyUndo") undo();
      else redo();
      return;
    }
    if (!composing && (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak")) {
      event.preventDefault();
      replaceSelection("\n");
      return;
    }
    const kind = editKind(event.inputType);
    if (kind === "type" && /\s/u.test(event.data ?? "")) lastKind = null;
    pending = { kind, before: shown.text === fieldText(field) ? shown : current(field) };
  };
  return (
    <div class="wfn-name-box">
      {/* biome-ignore lint/a11y/useFocusableInteractive: Solid 2 uses the lowercase tabindex DOM attribute. */}
      {/* biome-ignore lint/a11y/useAriaActivedescendantWithTabindex: Solid 2 uses the lowercase tabindex DOM attribute. */}
      <div
        ref={(element: HTMLDivElement) => {
          field = element;
        }}
        class={`wfn-name-field ${props.class ?? ""}`}
        role="combobox"
        tabindex="0"
        contenteditable={editable()}
        spellcheck={true}
        data-cuelume-type=""
        data-placeholder={props.placeholder}
        aria-label={props["aria-label"]}
        aria-readonly={props.readonly ? "true" : undefined}
        aria-autocomplete="list"
        aria-expanded={expanded()}
        aria-controls={listControls()}
        aria-activedescendant={activeId()}
        onBeforeInput={onBeforeInput}
        onInput={() => {
          const edit = pending ?? { kind: "edit" as const, before: shown };
          pending = null;
          commit(edit.kind, edit.before);
        }}
        onCompositionStart={() => {
          composing = true;
        }}
        onCompositionEnd={() => {
          composing = false;
          commit("type", shown);
        }}
        onPaste={(event: ClipboardEvent) => {
          event.preventDefault();
          if (props.readonly) return;
          replaceSelection((event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/gu, "\n"));
        }}
        onCopy={(event: ClipboardEvent) => copy(event, false)}
        onCut={(event: ClipboardEvent) => copy(event, true)}
        onDragStart={(event: DragEvent) => {
          const range = field ? selectionIn(field) : null;
          if (field && range && event.dataTransfer)
            event.dataTransfer.setData("text/plain", fieldText(field).slice(range.start, range.end));
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event: KeyboardEvent) => {
          if (event.key.startsWith("Arrow") && !open()) look();
        }}
        onPointerUp={() => look()}
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
              <Show when={names().length > 0} fallback={<p class="wfn-name-empty">{t("workflow.picker.noMatches")}</p>}>
                <Listbox.Root<NameMatch>
                  as="div"
                  id={listId}
                  aria-label={t("workflow.names.title")}
                  class="wfn-picker-list wfn-model-list"
                  options={names()}
                  optionValue={(match) => match.option.name}
                  optionTextValue={(match) => match.option.name}
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
                      class="wfn-picker-row wfn-name-row"
                      onPointerDown={(event: PointerEvent) => event.preventDefault()}
                    >
                      <span class="wfn-menu-icon" data-kind={item.rawValue.option.kind} aria-hidden="true">
                        {addItem(item.rawValue.option.kind).icon()}
                      </span>
                      <span class="wfn-name-text">
                        <MatchedName name={item.rawValue.option.name} at={item.rawValue.at} size={typed().length} />
                        <span class="wfn-name-source">
                          {t("workflow.names.source", {
                            step: item.rawValue.option.steps.join(", "),
                            detail: item.rawValue.option.detail,
                          })}
                        </span>
                      </span>
                    </Listbox.Item>
                  )}
                />
              </Show>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
