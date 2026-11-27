import { Button, IconButton, Input, Plus, Text, Trash2 } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

export interface RepeatableColumn<T> {
  label: (number: number) => string;
  placeholder: (row: T) => string;
  maxlength: number;
  identifier?: boolean;
  numeric?: boolean;
  mono?: boolean;
  read: (row: T) => string;
  write: (index: number, value: string) => void;
  editText?: (value: string) => string;
  restText?: (value: string) => string;
}

interface RepeatableRowsProps<T> {
  label: string;
  removeLabel: (number: number) => string;
  addLabel: string;
  columns: readonly RepeatableColumn<T>[];
  rows: readonly T[];
  limit: number;
  busy: boolean;
  sectionError?: string | undefined;
  rowError: (index: number) => string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  action?: JSX.Element;
  children?: JSX.Element;
  table?: RepeatableTable<T> | undefined;
}

export interface RepeatableTable<T> {
  header: readonly string[];
  cells: (row: T, index: () => number) => JSX.Element;
}

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
