import { Listbox, Popover, Textarea, type TextareaProps } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, flush, omit, Show } from "solid-js";
import { useText } from "../../text";
import { useBoard } from "./workflow-board";

interface NameQuery {
  start: number;
  end: number;
  typed: string;
}

const TYPED_NAME = /\{\{\s*([A-Za-z0-9_]{0,40})$/u;
const NAME_REST = /^[A-Za-z0-9_]*/u;
const CLOSING = /^\s*\}\}/u;

function nameQuery(text: string, caret: number): NameQuery | null {
  const typed = TYPED_NAME.exec(text.slice(0, caret))?.[1];
  return typed === undefined ? null : { start: caret - typed.length, end: caret, typed };
}

function withName(text: string, query: NameQuery, name: string): { text: string; caret: number } {
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
  const names = createMemo(() => {
    const found = query();
    if (!found || props.readonly || board.catalogs().answers !== true) return [];
    const typed = found.typed.toLowerCase();
    return board.answerNames(props.node).filter((name) => name.toLowerCase().startsWith(typed));
  });
  const open = () => names().length > 0;
  const activeName = () => names()[Math.min(active(), names().length - 1)];
  const activeKeys = () => {
    const name = activeName();
    return name ? [name] : [];
  };
  const activeId = () => (open() ? `${listId}-${names().indexOf(activeName() ?? "")}` : undefined);
  const listControls = () => (open() ? listId : undefined);
  const expanded = () => (open() ? "true" : "false");
  const look = (element: HTMLTextAreaElement) => {
    const next =
      element.selectionStart === element.selectionEnd ? nameQuery(element.value, element.selectionStart) : null;
    setQuery(next);
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
      const name = activeName();
      if (!name) return;
      event.preventDefault();
      event.stopPropagation();
      choose(name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };
  return (
    <>
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
              <Listbox.Root<string>
                as="div"
                id={listId}
                aria-label={t("workflow.names.title")}
                class="wfn-picker-list wfn-model-list"
                options={names()}
                optionValue={(name) => name}
                optionTextValue={(name) => name}
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
                    id={`${listId}-${names().indexOf(item.rawValue)}`}
                    class="wfn-picker-row"
                    onPointerDown={(event: PointerEvent) => event.preventDefault()}
                  >
                    <span class="wfn-name-option">{item.rawValue}</span>
                  </Listbox.Item>
                )}
              />
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
