import { Button, IconButton, Input, Plus, Text, Trash2 } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/**
 * One column of a repeatable row. `read` and `write` stay with the caller that knows the row shape,
 * so the shared markup below reaches a field without an index signature or a cast.
 */
export interface RepeatableColumn<T> {
  /** The accessible name of the field in row `number`, as `Model 1 ID`. */
  label: (number: number) => string;
  /** The row is given so that one row can differ, as a saved value that an empty field keeps. */
  placeholder: (row: T) => string;
  maxlength: number;
  /** An identifier must not be autocorrected. A display name is prose and may be. */
  identifier?: boolean;
  /** A count, such as a number of tokens: touch keyboards show digits. */
  numeric?: boolean;
  /** The value is code, such as a model ID, and shows in the code font. */
  mono?: boolean;
  read: (row: T) => string;
  write: (index: number, value: string) => void;
  /** The text for the field while the user edits it, as a count in plain digits. */
  editText?: (value: string) => string;
  /** The text for the field after the user leaves it, as a count in groups of digits. */
  restText?: (value: string) => string;
}

interface RepeatableRowsProps<T> {
  /** Names the section, as `Models`. */
  label: string;
  /** Names the remove control of row `number`, as `Remove model 1`. */
  removeLabel: (number: number) => string;
  addLabel: string;
  /**
   * One column for a plain list, such as addresses; two for a name and its value. A table has the
   * columns that its header names.
   */
  columns: readonly RepeatableColumn<T>[];
  rows: readonly T[];
  limit: number;
  busy: boolean;
  sectionError?: string | undefined;
  rowError: (index: number) => string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** A control beside the section label, such as the button that finds models. */
  action?: JSX.Element;
  /** Content between the label and the rows, such as the models that an endpoint reports. */
  children?: JSX.Element;
  /** Makes the rows a table, as the models of this computer. */
  table?: RepeatableTable<T> | undefined;
}

/** The rows as a table: the name of each column once above the rows, not in each row. */
export interface RepeatableTable<T> {
  /** The names of the columns, then the names of the cells, in the sequence of one row. */
  header: readonly string[];
  /** The cells of one row after its fields, such as the efforts of a model. */
  cells: (row: T, index: () => number) => JSX.Element;
}

/**
 * The models list and the headers list differ only in their two columns and their limit, so they
 * share one row, error and add-button shape instead of keeping two copies that drift apart.
 */
export function RepeatableRows<T>(props: RepeatableRowsProps<T>) {
  function retype(column: RepeatableColumn<T>, row: T, index: number, text: ((value: string) => string) | undefined) {
    const shown = column.read(row);
    const next = text ? text(shown) : shown;
    if (next !== shown) column.write(index, next);
  }

  return (
    <section class="custom-provider-rows" aria-label={props.label}>
      <div class="custom-provider-rows-heading">
        <Text variant="label-sm">{props.label}</Text>
        {props.action}
        <Show when={props.sectionError}>
          {(message) => (
            <Text class="custom-provider-rows-error" tone="danger" variant="caption" role="alert">
              {message()}
            </Text>
          )}
        </Show>
      </div>
      {props.children}
      <Show when={props.table}>
        {(table) => (
          // Each field has its own accessible name, so a screen reader does not need the column names.
          <div class="custom-provider-row-inputs custom-provider-row-table custom-provider-row-head" aria-hidden="true">
            <For each={table().header}>
              {(name) => (
                <Text tone="muted" variant="caption">
                  {name}
                </Text>
              )}
            </For>
          </div>
        )}
      </Show>
      <For each={props.rows}>
        {(row, index) => (
          <div class="custom-provider-row">
            <div
              class={[
                "custom-provider-row-inputs",
                {
                  "custom-provider-row-single": props.columns.length === 1,
                  "custom-provider-row-table": Boolean(props.table),
                },
              ]}
            >
              <For each={props.columns}>
                {(column) => (
                  <Input
                    aria-label={column.label(index() + 1)}
                    value={column.read(row)}
                    onValueChange={(value) => column.write(index(), value)}
                    onFocus={() => retype(column, row, index(), column.editText)}
                    onBlur={() => retype(column, row, index(), column.restText)}
                    placeholder={column.placeholder(row)}
                    autocomplete={column.identifier ? "off" : undefined}
                    spellcheck={column.identifier ? false : undefined}
                    inputmode={column.numeric ? "numeric" : undefined}
                    class={column.mono ? "custom-provider-mono" : undefined}
                    maxlength={column.maxlength}
                    disabled={props.busy}
                  />
                )}
              </For>
              {props.table?.cells(row, index)}
              <IconButton
                label={props.removeLabel(index() + 1)}
                variant="ghost"
                disabled={props.busy || props.rows.length < 2}
                onClick={() => props.onRemove(index())}
              >
                <Trash2 />
              </IconButton>
            </div>
            <Show when={props.rowError(index())}>
              {(message) => (
                <Text class="custom-provider-row-error" tone="danger" variant="caption" role="alert">
                  {message()}
                </Text>
              )}
            </Show>
          </div>
        )}
      </For>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.busy || props.rows.length >= props.limit}
        onClick={() => props.onAdd()}
      >
        <Plus />
        {props.addLabel}
      </Button>
    </section>
  );
}
