import type { JSX } from "@solidjs/web";
import { type Accessor, createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { createListVirtualizer } from "./createListVirtualizer";

interface ListNode {
  type: "item" | "section";
}

export interface VirtualRowProps {
  readonly "data-index": number;
  readonly style: JSX.CSSProperties;
  ref: (element: HTMLElement) => void;
}

interface VirtualListboxProps<Node extends ListNode> {
  collection: Iterable<Node>;
  nodeKey: (node: Node) => string;
  scrollElement: () => HTMLElement | undefined;
  estimateSize: (node: Node, index: number) => number;
  renderRow: (node: Accessor<Node>, index: Accessor<number>, row: VirtualRowProps) => JSX.Element;
  registerScrollToItem: (scroll: (key: string) => void) => void;
  onEndReached?: (() => void) | undefined;
}

const OVERSCAN = 8;
const END_REACHED_ROWS = 10;

export function VirtualListbox<Node extends ListNode>(props: VirtualListboxProps<Node>) {
  let spacer: HTMLLIElement | undefined;
  const [scrollMargin, setScrollMargin] = createSignal(0);
  const [activeKey, setActiveKey] = createSignal<string>();
  let pointerFocus = false;

  const nodes = createMemo(() => [...props.collection]);
  const keys = createMemo(() => nodes().map(props.nodeKey));
  const indexByKey = createMemo(() => new Map(keys().map((key, index) => [key, index])));
  const activeIndex = createMemo(() => {
    const key = activeKey();
    return key === undefined ? -1 : (indexByKey().get(key) ?? -1);
  });
  const virtualizer = createListVirtualizer({
    rows: createMemo(() =>
      nodes().map((node, index) => ({ key: keys()[index] ?? String(index), size: props.estimateSize(node, index) })),
    ),
    getScrollElement: props.scrollElement,
    scrollMargin,
    pinnedIndex: activeIndex,
    overscan: OVERSCAN,
  });

  let sectionAbove: boolean[] = [];
  let indexes = new Map<string, number>();
  createEffect(
    () => ({ next: indexByKey(), above: nodes().map((_, index, list) => list[index - 1]?.type === "section") }),
    ({ next, above }) => {
      indexes = next;
      sectionAbove = above;
    },
  );
  props.registerScrollToItem((key) => {
    setActiveKey(key);
    if (pointerFocus) return;
    queueMicrotask(() => {
      const index = indexes.get(key);
      if (index !== undefined) virtualizer.reveal(sectionAbove[index] ? index - 1 : index, index);
    });
  });

  createEffect(
    () => ({ end: virtualizer.endIndex(), count: nodes().length, onEndReached: props.onEndReached }),
    ({ end, count, onEndReached }) => {
      if (count > 0 && end >= count - END_REACHED_ROWS) onEndReached?.();
    },
  );

  onSettled(() => {
    const listbox = spacer?.parentElement;
    if (!listbox) return;
    setScrollMargin(listbox.offsetTop);
    const onPointerMove = () => {
      pointerFocus = true;
    };
    const onKeyDown = () => {
      pointerFocus = false;
    };
    listbox.addEventListener("pointermove", onPointerMove);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      listbox.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });

  return (
    <>
      <li ref={spacer} role="presentation" aria-hidden="true" style={{ height: `${virtualizer.totalSize()}px` }} />
      <For each={virtualizer.items()} keyed={(item) => item.key}>
        {(item) => {
          const index = () => indexByKey().get(String(item().key));
          const node = () => {
            const current = index();
            return current === undefined ? undefined : nodes()[current];
          };
          return (
            <Show when={node()}>
              {(current) =>
                props.renderRow(current, () => index() ?? 0, {
                  get "data-index"() {
                    return item().index;
                  },
                  get style() {
                    return { top: `${item().start - scrollMargin()}px` };
                  },
                  ref: virtualizer.measureElement,
                })
              }
            </Show>
          );
        }}
      </For>
    </>
  );
}
