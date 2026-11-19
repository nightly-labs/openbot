import type { CrmPrivateField } from "@openbot/contracts/ipc";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Button,
  buttonVariants,
  Check,
  Checkbox,
  DropdownMenu,
  Eye,
  EyeOff,
  Field,
  Filter,
  IconButton,
  Input,
  Lock,
  Popover,
  RotateCcw,
  SlidersHorizontal,
  toast,
  type UsersRound,
  X,
} from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, matches, parseNumber, type SheetRange, type SheetSort } from "./crm-model";

export type CrmIcon = typeof UsersRound;

type SortKind = "text" | "date" | "number";
type SortValue = string | number | null;

const ORDER_KEYS = {
  text: ["crm.sheet.order.textAscending", "crm.sheet.order.textDescending"],
  date: ["crm.sheet.order.dateAscending", "crm.sheet.order.dateDescending"],
  number: ["crm.sheet.order.numberAscending", "crm.sheet.order.numberDescending"],
} as const;

export interface SheetColumn<R> {
  id: string;
  label: string;
  icon: CrmIcon;
  width: number;
  numeric?: boolean;
  field?: CrmPrivateField;
  sort?: { kind: SortKind; value: (row: R) => SortValue };
  cell: (row: R) => JSX.Element;
  text: (row: R) => string;
  total?: (rows: readonly R[]) => { label: string; lines: string[] } | null;
  filter?: "text" | "none" | { range: (row: R) => number | null };
}

export interface SheetAction<R> {
  label: string;
  width: number;
  cell: (row: R) => JSX.Element;
}

export interface SheetPick<R> {
  ids: readonly string[];
  label: (row: R) => string;
  onChange: (ids: string[]) => void;
}

const INDEX_WIDTH = 40;

export function sortRows<R>(
  rows: readonly R[],
  columns: readonly SheetColumn<R>[],
  sort: SheetSort | null,
): readonly R[] {
  const value = sort ? columns.find((column) => column.id === sort.column)?.sort?.value : undefined;
  if (!sort || !value) return rows;
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) {
      if (x === y) return 0;
      return x === null ? 1 : -1;
    }
    if (typeof x === "number" && typeof y === "number") return sign * (x - y);
    return sign * String(x).localeCompare(String(y));
  });
}

function columnTest<R>(
  column: SheetColumn<R>,
  find: Record<string, string>,
  range: Record<string, SheetRange>,
): ((row: R) => boolean) | null {
  const filter = column.filter ?? "text";
  if (filter === "none") return null;
  if (filter === "text") {
    const text = find[column.id]?.trim() ?? "";
    return text === "" ? null : (row) => matches(text, column.text(row));
  }
  const bounds = range[column.id];
  if (!bounds || (bounds.min === null && bounds.max === null)) return null;
  const { min, max } = bounds;
  return (row) => {
    const value = filter.range(row);
    return value !== null && (min === null || value >= min) && (max === null || value <= max);
  };
}

export function filterCount<R>(
  columns: readonly SheetColumn<R>[],
  find: Record<string, string>,
  range: Record<string, SheetRange>,
): number {
  return columns.filter((column) => columnTest(column, find, range) !== null).length;
}

export function filterRows<R>(
  rows: readonly R[],
  columns: readonly SheetColumn<R>[],
  find: Record<string, string>,
  range: Record<string, SheetRange>,
): readonly R[] {
  const tests = columns.flatMap((column) => columnTest(column, find, range) ?? []);
  return tests.length === 0 ? rows : rows.filter((row) => tests.every((test) => test(row)));
}

export function visibleColumns<R>(columns: readonly SheetColumn<R>[], hidden: readonly string[]): SheetColumn<R>[] {
  return columns.filter((column, index) => index === 0 || !hidden.includes(column.id));
}

export function orderColumns<C extends { id: string }>(columns: readonly C[], order: readonly string[]): C[] {
  if (order.length === 0) return [...columns];
  const rank = (column: C) => {
    const at = order.indexOf(column.id);
    return at === -1 ? order.length + columns.indexOf(column) : at;
  };
  return [...columns].sort((a, b) => rank(a) - rank(b));
}

export function moveColumn(all: readonly string[], shown: readonly string[], id: string, step: -1 | 1): string[] {
  const at = shown.indexOf(id);
  const target = shown[at + step];
  if (at < 1 || at + step < 1 || target === undefined) return [...all];
  const next = all.filter((item) => item !== id);
  const place = next.indexOf(target);
  next.splice(step === 1 ? place + 1 : place, 0, id);
  return next;
}

export function placeColumn(all: readonly string[], id: string, target: string, after: boolean): string[] {
  const next = all.filter((item) => item !== id);
  const at = next.indexOf(target);
  if (at === -1 || (at === 0 && !after)) return [...all];
  next.splice(after ? at + 1 : at, 0, id);
  return next;
}

interface ColumnDrag {
  id: string;
  offset: number;
  target: string | null;
  after: boolean;
  line: number | null;
}

const DRAG_START = 4;
const DRAG_EDGE = 48;
const DRAG_MAX_SPEED = 24;

export function useCsvExport() {
  const { t } = useText();
  return <R,>(name: string, columns: readonly SheetColumn<R>[], rows: readonly R[]) => {
    const safe = (value: string) => (/^[=+@\t\r]|^-(?!\d)/u.test(value) ? `'${value}` : value);
    const cell = (raw: string) => {
      const value = safe(raw);
      return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    };
    const lines = [
      columns.map((column) => cell(column.label)).join(","),
      ...rows.map((row) => columns.map((column) => cell(column.text(row))).join(",")),
    ];
    const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    toast(t("crm.export.done", { count: rows.length, file: name }));
  };
}

export function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

function SheetHead<R>(props: {
  column: SheetColumn<R>;
  width: number;
  sort: SheetSort | null;
  first: boolean;
  second: boolean;
  last: boolean;
  onSort: (sort: SheetSort | null) => void;
  onHide: (id: string) => void;
  onMove: (step: -1 | 1) => void;
  onWidth: (width: number | null) => void;
  onResizing: (on: boolean) => void;
  private: boolean;
  onPrivate: ((on: boolean) => void) | undefined;
  onPress: (event: PointerEvent, click: () => void) => void;
  offset: number | null;
}) {
  const { t } = useText();
  const id = createUniqueId();
  const [menu, setMenu] = createSignal(false);
  const active = () => props.sort?.column === props.column.id;
  const order = () => {
    if (!active()) return "none";
    return props.sort?.descending ? "descending" : "ascending";
  };
  const labels = () => ORDER_KEYS[props.column.sort?.kind ?? "text"];
  const transform = () => (props.offset === null ? undefined : `translateX(${props.offset}px)`);
  return (
    <th
      id={id}
      scope="col"
      class="crm-sheet-head"
      aria-sort={active() ? order() : undefined}
      data-column={props.column.id}
      data-dragging={props.offset === null ? undefined : ""}
      style={{ transform: transform() }}
      ref={(element: HTMLTableCellElement) => {
        element.addEventListener(
          "pointerdown",
          (event) => {
            if (props.first || event.button !== 0 || event.pointerType === "touch") return;
            if (!(event.target instanceof Element) || !event.target.closest(".crm-sheet-head-button")) return;
            event.stopPropagation();
            props.onPress(event, () => setMenu((open) => !open));
          },
          { capture: true },
        );
      }}
    >
      <DropdownMenu.Root placement="bottom-start" gutter={4} open={menu()} onOpenChange={setMenu}>
        <DropdownMenu.Trigger
          class={`${buttonVariants({ variant: "ghost", size: "xs" })} crm-sheet-head-button`}
          data-numeric={props.column.numeric ? "" : undefined}
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault();
            setMenu(true);
          }}
        >
          <props.column.icon class="crm-sheet-head-icon" aria-hidden="true" />
          <span class="crm-sheet-head-label">{props.column.label}</span>
          <Show when={props.private}>
            <Lock class="crm-sheet-head-lock" aria-hidden="true" />
            <span class="sr-only">{t("crm.sheet.hiddenFromAgents")}</span>
          </Show>
          <Show when={order() === "ascending"}>
            <ArrowUp class="crm-sheet-head-order" aria-hidden="true" />
          </Show>
          <Show when={order() === "descending"}>
            <ArrowDown class="crm-sheet-head-order" aria-hidden="true" />
          </Show>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <Show when={props.column.sort}>
              <DropdownMenu.RadioGroup
                value={order()}
                onChange={(value: string) => {
                  if (value === "none") props.onSort(null);
                  else props.onSort({ column: props.column.id, descending: value === "descending" });
                }}
              >
                <DropdownMenu.RadioItem value="ascending" closeOnSelect>
                  <MenuMark on={order() === "ascending"} />
                  {t(labels()[0])}
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="descending" closeOnSelect>
                  <MenuMark on={order() === "descending"} />
                  {t(labels()[1])}
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="none" closeOnSelect>
                  <MenuMark on={order() === "none"} />
                  {t("crm.sheet.order.none")}
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
            </Show>
            <Show when={!props.first}>
              <Show when={props.column.sort}>
                <DropdownMenu.Separator />
              </Show>
              <DropdownMenu.Item disabled={props.second} onSelect={() => props.onMove(-1)}>
                <ArrowLeft aria-hidden="true" />
                {t("crm.sheet.moveLeft")}
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled={props.last} onSelect={() => props.onMove(1)}>
                <ArrowRight aria-hidden="true" />
                {t("crm.sheet.moveRight")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => props.onHide(props.column.id)}>
                <EyeOff aria-hidden="true" />
                {t("crm.sheet.hideColumn")}
              </DropdownMenu.Item>
            </Show>
            <Show when={props.onPrivate}>
              {(onPrivate) => (
                <>
                  <Show when={props.column.sort || !props.first}>
                    <DropdownMenu.Separator />
                  </Show>
                  <DropdownMenu.CheckboxItem checked={props.private} onChange={(on: boolean) => onPrivate()(on)}>
                    <MenuMark on={props.private} />
                    {t("crm.sheet.hideFromAgents")}
                  </DropdownMenu.CheckboxItem>
                </>
              )}
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <PanelResizer
        class="crm-sheet-resizer"
        label={t("crm.sheet.columnWidth", { column: props.column.label })}
        controls={id}
        direction="left"
        value={props.width}
        defaultValue={props.column.width}
        min={COLUMN_MIN_WIDTH}
        max={COLUMN_MAX_WIDTH}
        onResize={(value) => {
          props.onResizing(true);
          props.onWidth(value);
        }}
        onResizeEnd={(value) => {
          props.onWidth(value);
          props.onResizing(false);
        }}
        onReset={() => props.onWidth(null)}
      />
    </th>
  );
}

function FindCell(props: { label: string; value: string; onChange: (text: string) => void }) {
  const { t } = useText();
  return (
    <Input
      size="sm"
      type="search"
      class="crm-sheet-find"
      aria-label={t("crm.sheet.filter.column", { column: props.label })}
      placeholder={t("crm.sheet.filter.text")}
      value={props.value}
      onValueChange={props.onChange}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Escape" || props.value === "") return;
        event.preventDefault();
        event.stopPropagation();
        props.onChange("");
      }}
    />
  );
}

function RangeCell(props: {
  label: string;
  value: SheetRange | undefined;
  onChange: (range: SheetRange | null) => void;
}) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  const [min, setMin] = createSignal("");
  const [max, setMax] = createSignal("");
  const shown = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  const bad = (text: string) => text.trim() !== "" && parseNumber(text) === null;
  const summary = () => {
    const low = props.value?.min ?? null;
    const high = props.value?.max ?? null;
    if (low !== null && high !== null)
      return t("crm.sheet.filter.between", { min: format.number(low), max: format.number(high) });
    if (low !== null) return t("crm.sheet.filter.atLeast", { min: format.number(low) });
    if (high !== null) return t("crm.sheet.filter.atMost", { max: format.number(high) });
    return null;
  };
  const update = (lowText: string, highText: string) => {
    const low = parseNumber(lowText);
    const high = parseNumber(highText);
    props.onChange(low === null && high === null ? null : { min: low, max: high });
  };
  const closeOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setOpen(false);
  };
  return (
    <Popover.Root
      placement="bottom-start"
      gutter={4}
      open={open()}
      onOpenChange={(next: boolean) => {
        if (next) {
          setMin(shown(props.value?.min));
          setMax(shown(props.value?.max));
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger class="crm-sheet-range" data-empty={summary() === null ? "" : undefined}>
        <span class="sr-only">{t("crm.sheet.filter.column", { column: props.label })}</span>
        {summary() ?? t("crm.sheet.filter.any")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface crm-menu crm-range">
          <Field label={t("crm.sheet.filter.min")}>
            <Input
              size="sm"
              inputmode="decimal"
              autocomplete="off"
              invalid={bad(min())}
              value={min()}
              onValueChange={(text) => {
                setMin(text);
                update(text, max());
              }}
              onKeyDown={closeOnEnter}
            />
          </Field>
          <Field label={t("crm.sheet.filter.max")}>
            <Input
              size="sm"
              inputmode="decimal"
              autocomplete="off"
              invalid={bad(max())}
              value={max()}
              onValueChange={(text) => {
                setMax(text);
                update(min(), text);
              }}
              onKeyDown={closeOnEnter}
            />
          </Field>
          <Show when={props.value}>
            <Button
              variant="ghost"
              size="sm"
              class="crm-menu-option"
              onClick={() => {
                props.onChange(null);
                setOpen(false);
              }}
            >
              <X aria-hidden="true" />
              {t("crm.sheet.filter.clear")}
            </Button>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Sheet<R>(props: {
  label: string;
  columns: readonly SheetColumn<R>[];
  rows: readonly R[];
  rowId: (row: R) => string;
  sort: SheetSort | null;
  widths: Record<string, number>;
  onSort: (sort: SheetSort | null) => void;
  onHide: (id: string) => void;
  onMove: (id: string, step: -1 | 1) => void;
  onPlace: (id: string, target: string, after: boolean) => void;
  onWidth: (id: string, width: number | null) => void;
  onOpen: (id: string) => void;
  current: (row: R) => boolean;
  isPrivate: (field: CrmPrivateField) => boolean;
  onPrivate: (field: CrmPrivateField, on: boolean) => void;
  find: Record<string, string>;
  range: Record<string, SheetRange>;
  onFind: (id: string, text: string) => void;
  onRange: (id: string, range: SheetRange | null) => void;
  onClearFilters: () => void;
  empty: JSX.Element;
  pick?: SheetPick<R> | undefined;
  action?: SheetAction<R> | undefined;
}) {
  const { t } = useText();
  const columnWidth = (column: SheetColumn<R>) => props.widths[column.id] ?? column.width;
  const width = () =>
    INDEX_WIDTH + props.columns.reduce((sum, column) => sum + columnWidth(column), 0) + (props.action?.width ?? 0);
  const picked = (row: R) => props.pick?.ids.includes(props.rowId(row)) ?? false;
  const allPicked = () => props.rows.length > 0 && props.rows.every(picked);
  const togglePick = (row: R, on: boolean) => {
    const pick = props.pick;
    if (!pick) return;
    const id = props.rowId(row);
    pick.onChange(on ? [...pick.ids.filter((item) => item !== id), id] : pick.ids.filter((item) => item !== id));
  };
  const privateHandler = (column: SheetColumn<R>) => {
    const field = column.field;
    if (!field) return undefined;
    return (on: boolean) => props.onPrivate(field, on);
  };
  const autoScroll = createAutoScroll();
  const fades = createSheetFades();
  const [drag, setDrag] = createSignal<ColumnDrag | null>(null);
  const [resizing, setResizing] = createSignal<string | null>(null);
  const filtered = () => filterCount(props.columns, props.find, props.range) > 0;
  let scroller: HTMLDivElement | undefined;
  let track: HTMLDivElement | undefined;
  let thumb: HTMLDivElement | undefined;

  const edge = () => {
    const id = resizing();
    const at = props.columns.findIndex((column) => column.id === id);
    if (at === -1 || !scroller) return null;
    const right = props.columns.slice(0, at + 1).reduce((sum, column) => sum + columnWidth(column), INDEX_WIDTH);
    const left = right - 1 + (at === 0 ? scroller.scrollLeft : 0);
    return { left: `${left}px`, top: `${scroller.scrollTop}px`, height: `${scroller.clientHeight}px` };
  };
  const onResizing = (id: string, on: boolean) => {
    if (!on) {
      setResizing(null);
      return;
    }
    if (resizing() === id) return;
    setResizing(id);
    const stop = () => setResizing(null);
    window.addEventListener("pointerup", stop, { capture: true, once: true });
    window.addEventListener("pointercancel", stop, { capture: true, once: true });
  };

  const pressBar = (event: PointerEvent) => {
    const box = scroller;
    const bar = track;
    if (!box || !bar || !thumb || event.button !== 0) return;
    const range = box.scrollWidth - box.clientWidth;
    const room = bar.clientWidth - thumb.offsetWidth;
    if (range <= 0 || room <= 0) return;
    event.preventDefault();
    const left = bar.getBoundingClientRect().left;
    const onThumb = event.target instanceof Node && thumb.contains(event.target);
    const grab = onThumb ? event.clientX - thumb.getBoundingClientRect().left : thumb.offsetWidth / 2;
    const scrollTo = (x: number) => {
      box.scrollLeft = ((x - left - grab) / room) * range;
    };
    if (!onThumb) scrollTo(event.clientX);
    bar.setPointerCapture(event.pointerId);
    bar.dataset.dragging = "";
    const move = (next: PointerEvent) => scrollTo(next.clientX);
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
      delete bar.dataset.dragging;
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };

  const press = (id: string, event: PointerEvent, click: () => void) => {
    const box = scroller;
    if (!box) return;
    const startX = event.clientX;
    const startScroll = box.scrollLeft;
    let x = startX;
    let moving = false;
    let frame = 0;
    const heads = () => [...box.querySelectorAll<HTMLElement>("thead th[data-column]")];
    const update = () => {
      const offset = x - startX + box.scrollLeft - startScroll;
      const place = (head: HTMLElement) => {
        const rect = head.getBoundingClientRect();
        const shift = head.dataset.column === id ? new DOMMatrixReadOnly(getComputedStyle(head).transform).m41 : 0;
        return { left: rect.left - shift, right: rect.right - shift };
      };
      const others = heads().slice(1);
      let target: HTMLElement | undefined;
      let after = false;
      for (const head of others) {
        const rect = place(head);
        if (x >= rect.left && x < rect.right) {
          target = head;
          after = x > (rect.left + rect.right) / 2;
        }
      }
      const left = others[0];
      const last = others[others.length - 1];
      if (!target && last && x >= place(last).right) {
        target = last;
        after = true;
      } else if (!target && left && x < place(left).left) {
        target = left;
      }
      const targetId = target && target.dataset.column !== id ? (target.dataset.column ?? null) : null;
      const edge = target && targetId ? place(target)[after ? "right" : "left"] : null;
      setDrag({
        id,
        offset,
        target: targetId,
        after,
        line: edge === null ? null : edge - box.getBoundingClientRect().left + box.scrollLeft,
      });
    };
    const tick = () => {
      const rect = box.getBoundingClientRect();
      const left = heads()[0]?.getBoundingClientRect().right ?? rect.left;
      let speed = 0;
      if (x < left + DRAG_EDGE) speed = -Math.min(DRAG_MAX_SPEED, Math.ceil((left + DRAG_EDGE - x) / 4));
      else if (x > rect.right - DRAG_EDGE)
        speed = Math.min(DRAG_MAX_SPEED, Math.ceil((x - rect.right + DRAG_EDGE) / 4));
      if (speed !== 0) {
        const before = box.scrollLeft;
        box.scrollLeft += speed;
        if (box.scrollLeft !== before) update();
      }
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      delete box.dataset.columnDrag;
      setDrag(null);
    };
    const onMove = (move: PointerEvent) => {
      x = move.clientX;
      if (!moving) {
        if (Math.abs(x - startX) < DRAG_START) return;
        moving = true;
        box.dataset.columnDrag = "";
        frame = requestAnimationFrame(tick);
      }
      update();
    };
    const onUp = () => {
      const done = drag();
      stop();
      if (!moving) click();
      else if (done?.target) props.onPlace(id, done.target, done.after);
    };
    const onCancel = () => stop();
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      stop();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
  };
  const line = () => {
    const at = drag()?.line;
    if (at === null || at === undefined || !scroller) return null;
    return { left: `${at - 1}px`, top: `${scroller.scrollTop}px`, height: `${scroller.clientHeight}px` };
  };
  const dragOffset = (column: SheetColumn<R>) => {
    const current = drag();
    return current?.id === column.id ? current.offset : null;
  };

  return (
    <div class="crm-sheet-frame" ref={(element: HTMLDivElement) => fades.frame(element)}>
      <div
        class="crm-sheet-scroll"
        ref={(element: HTMLDivElement) => {
          scroller = element;
          autoScroll.bind(element);
          fades.bind(element);
        }}
        onScroll={() => fades.measure()}
      >
        <Show when={line()} keyed>
          {(style) => <div class="crm-drop-line" style={style} aria-hidden="true" />}
        </Show>
        <Show when={edge()} keyed>
          {(style) => <div class="crm-drop-line crm-resize-line" style={style} aria-hidden="true" />}
        </Show>
        <table
          class="crm-sheet"
          aria-label={props.label}
          data-picking={props.pick && props.pick.ids.length > 0 ? "" : undefined}
          data-action={props.action ? "" : undefined}
          style={{ width: `${width()}px` }}
          ref={(element) => {
            fades.watch(element);
            element.addEventListener("click", (event) => {
              const target = event.target instanceof Element ? event.target : null;
              if (!target || target.closest("button, input, a, .ui-checkbox")) return;
              const row = target.closest<HTMLElement>("tbody tr[data-row]");
              if (row?.dataset.row) props.onOpen(row.dataset.row);
            });
          }}
        >
          <colgroup>
            <col style={{ width: `${INDEX_WIDTH}px` }} />
            <For each={props.columns}>{(column) => <col style={{ width: `${columnWidth(column)}px` }} />}</For>
            <Show when={props.action}>{(action) => <col style={{ width: `${action().width}px` }} />}</Show>
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="crm-sheet-index">
                <Show when={props.pick} fallback={<span class="sr-only">{t("crm.sheet.row")}</span>}>
                  <Checkbox
                    class="crm-sheet-pick"
                    aria-label={t("crm.sheet.selectAll")}
                    checked={allPicked()}
                    onChange={(event) =>
                      props.pick?.onChange(event.currentTarget.checked ? props.rows.map(props.rowId) : [])
                    }
                  />
                </Show>
              </th>
              <For each={props.columns}>
                {(column, index) => (
                  <SheetHead
                    column={column}
                    width={columnWidth(column)}
                    sort={props.sort}
                    first={index() === 0}
                    second={index() === 1}
                    last={index() === props.columns.length - 1}
                    onSort={props.onSort}
                    onHide={props.onHide}
                    onMove={(step) => props.onMove(column.id, step)}
                    onWidth={(value) => props.onWidth(column.id, value)}
                    onResizing={(on) => onResizing(column.id, on)}
                    private={column.field !== undefined && props.isPrivate(column.field)}
                    onPrivate={privateHandler(column)}
                    onPress={(event, click) => press(column.id, event, click)}
                    offset={dragOffset(column)}
                  />
                )}
              </For>
              <Show when={props.action}>
                {(action) => (
                  <th scope="col" class="crm-sheet-action">
                    <span class="sr-only">{action().label}</span>
                  </th>
                )}
              </Show>
            </tr>
            <tr class="crm-sheet-filters">
              <td class="crm-sheet-index">
                <Show when={filtered()} fallback={<Filter class="crm-sheet-filters-icon" aria-hidden="true" />}>
                  <IconButton
                    variant="ghost"
                    size="icon-xs"
                    label={t("crm.sheet.filter.clearAll")}
                    onClick={() => props.onClearFilters()}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                </Show>
              </td>
              <For each={props.columns}>
                {(column) => {
                  const offset = () => dragOffset(column);
                  return (
                    <td
                      data-dragging={offset() === null ? undefined : ""}
                      style={{ transform: offset() === null ? undefined : `translateX(${offset()}px)` }}
                    >
                      <Show
                        when={column.filter !== undefined && typeof column.filter === "object" ? column.filter : null}
                        fallback={
                          <Show when={column.filter !== "none"}>
                            <FindCell
                              label={column.label}
                              value={props.find[column.id] ?? ""}
                              onChange={(text) => props.onFind(column.id, text)}
                            />
                          </Show>
                        }
                      >
                        <RangeCell
                          label={column.label}
                          value={props.range[column.id]}
                          onChange={(range) => props.onRange(column.id, range)}
                        />
                      </Show>
                    </td>
                  );
                }}
              </For>
              <Show when={props.action}>
                <td class="crm-sheet-action" />
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row, index) => (
                <tr
                  data-row={props.rowId(row)}
                  data-current={props.current(row) ? "" : undefined}
                  data-picked={picked(row) ? "" : undefined}
                >
                  <td class="crm-sheet-index">
                    <span class="crm-sheet-number">{index() + 1}</span>
                    <Show when={props.pick}>
                      {(pick) => (
                        <Checkbox
                          class="crm-sheet-pick"
                          aria-label={t("crm.sheet.selectRow", { name: pick().label(row) })}
                          checked={picked(row)}
                          onChange={(event) => togglePick(row, event.currentTarget.checked)}
                        />
                      )}
                    </Show>
                  </td>
                  <For each={props.columns}>
                    {(column) => <td data-numeric={column.numeric ? "" : undefined}>{column.cell(row)}</td>}
                  </For>
                  <Show when={props.action}>{(action) => <td class="crm-sheet-action">{action().cell(row)}</td>}</Show>
                </tr>
              )}
            </For>
          </tbody>
          <tbody class="crm-sheet-fill" aria-hidden="true">
            <tr>
              <td class="crm-sheet-index" />
              <For each={props.columns}>{() => <td />}</For>
              <Show when={props.action}>
                <td class="crm-sheet-action" />
              </Show>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="crm-sheet-index" />
              <For each={props.columns}>
                {(column) => (
                  <td data-numeric={column.numeric ? "" : undefined}>
                    <Show when={column.total?.(props.rows)} keyed>
                      {(total) => (
                        <span class="crm-sheet-total">
                          <span class="crm-sheet-total-label">{total.label}</span>
                          <span class="crm-sheet-total-lines">
                            <For each={total.lines}>{(item) => <span>{item}</span>}</For>
                          </span>
                        </span>
                      )}
                    </Show>
                  </td>
                )}
              </For>
              <Show when={props.action}>
                <td class="crm-sheet-action" />
              </Show>
            </tr>
          </tfoot>
        </table>
      </div>
      <Show when={props.rows.length === 0}>
        <div class="crm-sheet-empty">{props.empty}</div>
      </Show>
      <div class="crm-sheet-bar" aria-hidden="true">
        <div
          class="crm-sheet-track"
          ref={(element: HTMLDivElement) => {
            track = element;
          }}
          onPointerDown={pressBar}
          onWheel={(event: WheelEvent) => {
            if (!scroller || event.deltaX !== 0) return;
            event.preventDefault();
            scroller.scrollLeft += event.deltaY;
          }}
        >
          <div
            class="crm-sheet-thumb"
            ref={(element: HTMLDivElement) => {
              thumb = element;
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function ColumnsMenu<R>(props: {
  columns: readonly SheetColumn<R>[];
  hidden: readonly string[];
  moved: boolean;
  onChange: (hidden: string[]) => void;
  onReset: () => void;
}) {
  const { t } = useText();
  const count = () => props.columns.slice(1).filter((column) => props.hidden.includes(column.id)).length;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "sm" })}>
        <SlidersHorizontal aria-hidden="true" />
        {t("crm.columns.button")}
        <Show when={count() > 0}>
          <span class="crm-count-pill">{t("crm.columns.hidden", { count: count() })}</span>
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <For each={props.columns.slice(1)}>
            {(column) => (
              <DropdownMenu.CheckboxItem
                checked={!props.hidden.includes(column.id)}
                closeOnSelect={false}
                onChange={(on: boolean) =>
                  props.onChange(on ? props.hidden.filter((id) => id !== column.id) : [...props.hidden, column.id])
                }
              >
                <MenuMark on={!props.hidden.includes(column.id)} />
                {column.label}
              </DropdownMenu.CheckboxItem>
            )}
          </For>
          <Show when={count() > 0 || props.moved}>
            <DropdownMenu.Separator />
            <Show when={count() > 0}>
              <DropdownMenu.Item onSelect={() => props.onChange([])}>
                <Eye aria-hidden="true" />
                {t("crm.columns.showAll")}
              </DropdownMenu.Item>
            </Show>
            <Show when={props.moved}>
              <DropdownMenu.Item onSelect={props.onReset}>
                <RotateCcw aria-hidden="true" />
                {t("crm.columns.defaultOrder")}
              </DropdownMenu.Item>
            </Show>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const AUTOSCROLL_DEAD_ZONE = 10;
const AUTOSCROLL_SPEED = 8;

export function createAutoScroll() {
  let element: HTMLElement | undefined;
  let state: {
    x: number;
    y: number;
    pointerX: number;
    pointerY: number;
    carryX: number;
    carryY: number;
    dragged: boolean;
    last: number;
    frame: number;
    marker: HTMLElement;
  } | null = null;

  const velocity = (offset: number) => {
    const past = Math.abs(offset) - AUTOSCROLL_DEAD_ZONE;
    return past > 0 ? Math.sign(offset) * past * AUTOSCROLL_SPEED : 0;
  };

  const step = (time: number) => {
    if (!state || !element) return;
    const seconds = Math.min(time - state.last, 50) / 1000;
    state.last = time;
    state.carryX += velocity(state.pointerX - state.x) * seconds;
    state.carryY += velocity(state.pointerY - state.y) * seconds;
    const x = Math.trunc(state.carryX);
    const y = Math.trunc(state.carryY);
    state.carryX -= x;
    state.carryY -= y;
    if (x !== 0 || y !== 0) element.scrollBy(x, y);
    state.frame = requestAnimationFrame(step);
  };

  const onMove = (event: PointerEvent) => {
    if (!state) return;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    const far = Math.hypot(event.clientX - state.x, event.clientY - state.y) > AUTOSCROLL_DEAD_ZONE;
    if (far && (event.buttons & 4) !== 0) state.dragged = true;
  };
  const onUp = (event: PointerEvent) => {
    if (event.button === 1 && state?.dragged) stop();
  };
  const swallowClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) window.addEventListener("click", swallowClick, { capture: true, once: true });
    stop();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    stop();
  };

  function stop() {
    if (!state) return;
    cancelAnimationFrame(state.frame);
    state.marker.remove();
    state = null;
    document.documentElement.classList.remove("crm-autoscrolling");
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("wheel", stop, true);
    window.removeEventListener("blur", stop);
  }

  const start = (event: PointerEvent) => {
    if (event.button !== 1 || event.pointerType !== "mouse" || state || !element) return;
    event.preventDefault();
    const scrollsX = element.scrollWidth > element.clientWidth;
    const scrollsY = element.scrollHeight > element.clientHeight;
    if (!scrollsX && !scrollsY) return;
    const marker = document.createElement("div");
    marker.className = "crm-autoscroll-marker";
    marker.dataset.axis = scrollsX && scrollsY ? "both" : scrollsX ? "x" : "y";
    marker.style.left = `${event.clientX}px`;
    marker.style.top = `${event.clientY}px`;
    document.body.append(marker);
    document.documentElement.classList.add("crm-autoscrolling");
    state = {
      x: event.clientX,
      y: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      carryX: 0,
      carryY: 0,
      dragged: false,
      last: performance.now(),
      frame: 0,
      marker,
    };
    state.frame = requestAnimationFrame(step);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", stop, true);
    window.addEventListener("blur", stop);
  };
  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };

  onCleanup(() => {
    stop();
    element?.removeEventListener("pointerdown", start);
    element?.removeEventListener("auxclick", onAuxClick);
  });

  return {
    bind: (next: HTMLElement) => {
      element?.removeEventListener("pointerdown", start);
      element?.removeEventListener("auxclick", onAuxClick);
      element = next;
      next.addEventListener("pointerdown", start);
      next.addEventListener("auxclick", onAuxClick);
    },
  };
}

const THUMB_MIN = 40;

function createSheetFades() {
  let element: HTMLElement | undefined;
  let frame: HTMLElement | undefined;
  const observer = new ResizeObserver(() => measure());
  const measure = () => {
    if (!element || !frame) return;
    const table = element.querySelector("table");
    const cells = table?.tHead ? [...(table.tHead.rows[0]?.cells ?? [])] : [];
    const last = cells.at(-1);
    const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = element;
    const head = table?.tHead?.offsetHeight ?? 0;
    const foot = table?.tFoot?.offsetHeight ?? 0;
    const start = (cells[0]?.offsetWidth ?? 0) + (cells[1]?.offsetWidth ?? 0);
    const end = last?.classList.contains("crm-sheet-action") ? last.offsetWidth : 0;
    const track = Math.max(0, clientWidth - start - end);
    const range = scrollWidth - clientWidth;
    const thumb = range > 0 ? Math.max(THUMB_MIN, (track * track) / (track + range)) : track;
    const sizes = {
      head,
      foot,
      start,
      end,
      body: Math.max(0, clientHeight - head - foot),
      thumb,
      "thumb-at": range > 0 ? (scrollLeft / range) * (track - thumb) : 0,
    };
    for (const [name, size] of Object.entries(sizes)) frame.style.setProperty(`--crm-sheet-${name}`, `${size}px`);
    frame.toggleAttribute("data-scrolls-x", range > 1);
    element.toggleAttribute("data-fade-top", scrollTop > 0);
    element.toggleAttribute("data-fade-bottom", scrollTop + clientHeight < scrollHeight - 1);
    element.toggleAttribute("data-fade-left", scrollLeft > 0);
    element.toggleAttribute("data-fade-right", scrollLeft + clientWidth < scrollWidth - 1);
  };
  onCleanup(() => observer.disconnect());
  return {
    frame: (next: HTMLElement) => {
      frame = next;
    },
    bind: (next: HTMLElement) => {
      element = next;
      observer.observe(next);
    },
    watch: (table: HTMLElement) => observer.observe(table),
    measure,
  };
}
