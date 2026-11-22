import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";
import type { DayMarkerOptions } from "./chat-day-markers";
import type { ChatVirtualizer } from "./createChatVirtualizer";

const JUMP_MS = 450;

const NEAR_PX = 80;

const MIN_SECTIONS = 2;

const LABEL_LENGTH = 160;

export interface ChatScrollSection {
  key: string;
  label: string;
  reply?: string;
  start: number | undefined;
  row?: number;
}

export interface ChatScrollRow {
  id: string;
}

export interface ChatScrollQuestion {
  index: number;
  key: string;
  label: string;
  reply?: string;
}

export interface UnloadedHistory {
  count: number;
  oldestAt?: string | undefined;
}

export function unloadedHistory(
  page: { olderCount?: number | undefined; oldestAt?: string | undefined } | null | undefined,
): UnloadedHistory | undefined {
  return page?.olderCount ? { count: page.olderCount, oldestAt: page.oldestAt } : undefined;
}

export function chatScrollQuestions<Row extends ChatScrollRow>(
  rows: readonly Row[],
  question: (row: Row) => string | undefined,
  labels: Map<string, string> = new Map(),
  reply?: (row: Row) => string | undefined,
): { questions: ChatScrollQuestion[]; labels: Map<string, string> } {
  const questions: ChatScrollQuestion[] = [];
  const next = new Map<string, string>();
  const plain = (source: string | undefined): string | undefined => {
    const text = source?.slice(0, LABEL_LENGTH * 4);
    if (!text) return undefined;
    const label = next.get(text) ?? labels.get(text) ?? markdownPreviewText(text).slice(0, LABEL_LENGTH);
    next.set(text, label);
    return label || undefined;
  };
  let current: ChatScrollQuestion | undefined;
  rows.forEach((row, index) => {
    const text = question(row);
    if (text !== undefined) {
      const label = plain(text);
      current = label ? { index, key: row.id, label } : undefined;
      if (current) questions.push(current);
      return;
    }
    if (!reply || !current || current.reply) return;
    const answer = plain(reply(row));
    if (answer) current.reply = answer;
  });
  return { questions, labels: next };
}

export function chatScrollSections(input: {
  questions: readonly ChatScrollQuestion[];
  rowCount: number;
  storedCount: number;
  itemStart: (index: number) => number | undefined;
  totalSize: number;
  unloaded: UnloadedHistory | undefined;
  text: Required<Pick<DayMarkerOptions, "t" | "format">>;
}): ChatScrollSection[] {
  const loaded: ChatScrollSection[] = input.questions.map((question) => ({
    key: question.key,
    label: question.label,
    ...(question.reply ? { reply: question.reply } : {}),
    start: input.itemStart(question.index),
    row: question.index,
  }));
  const unloaded = input.unloaded;
  const firstStart = input.itemStart(0) ?? 0;
  if (!unloaded || unloaded.count === 0 || input.rowCount === 0 || input.storedCount === 0) {
    const first = loaded[0];
    if (first && first.start !== undefined) first.start = Math.min(first.start, firstStart);
    return loaded;
  }
  const heightPerMessage = input.totalSize / input.storedCount;
  const { t, format } = input.text;
  const oldest = unloaded.oldestAt ? new Date(unloaded.oldestAt) : undefined;
  const earlier: ChatScrollSection = {
    key: "",
    label:
      oldest && !Number.isNaN(oldest.getTime())
        ? t("chat.scrollRail.earlierSince", { date: format.date(oldest, { month: "short", day: "numeric" }) })
        : t("chat.scrollRail.earlier"),
    start: firstStart - unloaded.count * heightPerMessage,
  };
  return [earlier, ...loaded];
}

interface CardPlace {
  key: string;
  top: number;
  left: number;
  right: number;
}

interface RailState {
  shown: boolean;
  height: number;
  inset: number;
  active: number;
}

export interface ChatScrollRailProps {
  scrollElement: () => HTMLElement | undefined;
  sections: () => readonly ChatScrollSection[];
  onJump: (section: number) => void;
}

export function createChatScrollRail<Row extends ChatScrollRow>(options: {
  rows: () => readonly Row[];
  question: (row: Row) => string | undefined;
  reply?: (row: Row) => string | undefined;
  storedCount?: () => number;
  unloaded: () => UnloadedHistory | undefined;
  virtualizer: Pick<ChatVirtualizer<Element>, "itemStart" | "scrollToIndex" | "getTotalSize">;
  onLoadOlder: () => void;
  onJump: () => void;
}): { ref: (element: HTMLElement) => void; props: ChatScrollRailProps } {
  const { t, format } = useText();
  const [scrollElement, setScrollElement] = createSignal<HTMLElement>();
  let labels = new Map<string, string>();
  const questions = createMemo(() => {
    const read = chatScrollQuestions(options.rows(), options.question, labels, options.reply);
    labels = read.labels;
    return read.questions;
  });
  const sections = createMemo(() => {
    const rowCount = options.rows().length;
    return chatScrollSections({
      questions: questions(),
      rowCount,
      storedCount: options.storedCount?.() ?? rowCount,
      itemStart: options.virtualizer.itemStart,
      totalSize: options.virtualizer.getTotalSize(),
      unloaded: options.unloaded(),
      text: { t, format },
    });
  });
  const onJump = (index: number) => {
    const section = sections()[index];
    if (!section) return;
    options.onJump();
    if (section.row === undefined) {
      options.virtualizer.scrollToIndex(0);
      options.onLoadOlder();
      return;
    }
    options.virtualizer.scrollToIndex(section.row, { smooth: !prefersReducedMotion() });
  };
  return { ref: setScrollElement, props: { scrollElement, sections, onJump } };
}

export function ChatScrollRail(props: ChatScrollRailProps) {
  const { t } = useText();
  const [rail, setRail] = createStore<RailState>({
    shown: false,
    height: 0,
    inset: 0,
    active: 0,
  });
  const [held, setHeld] = createSignal(false);
  const [near, setNear] = createSignal(false);
  const [card, setCard] = createSignal<CardPlace>();

  let nav: HTMLElement | undefined;
  let track: HTMLElement | undefined;
  let list: HTMLOListElement | undefined;
  let frame = 0;
  let relayout = true;
  let drawn: number | undefined;
  let jump: { from: number; startedAt: number } | undefined;
  let update = () => {};
  let opened: string | undefined;
  const schedule = (layout: boolean) => {
    if (layout) relayout = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  createEffect(
    () => props.scrollElement(),
    (element) => {
      setHeld(false);
      setNear(false);
      setCard(undefined);
      opened = undefined;
      drawn = undefined;
      jump = undefined;
      relayout = true;
      if (!element) return;
      let inset: number | undefined;

      let nearBox: DOMRect | undefined;

      let geometry: { starts: number[]; ends: number[]; lastScroll: number; height: number } | undefined;
      const layout = () => {
        nearBox = undefined;
        const height = element.clientHeight;
        const content = element.scrollHeight;
        const lastScroll = Math.max(0, content - height);
        const sections = untrack(props.sections);
        if (lastScroll === 0 || sections.length < MIN_SECTIONS) {
          geometry = undefined;
          setHeld(false);
          setCard(undefined);
          setRail((state) => {
            state.shown = false;
          });
          return;
        }
        const starts: number[] = [];
        for (const section of sections) {
          const previous = starts.at(-1);
          starts.push(Math.max(section.start ?? previous ?? 0, previous ?? Number.NEGATIVE_INFINITY));
        }
        const ends = [...starts.slice(1), content];
        geometry = { starts, ends, lastScroll, height };
        inset ??= Number.parseFloat(getComputedStyle(element).paddingInlineEnd) || 0;
        const railInset = inset;
        setRail((state) => {
          state.shown = true;
          state.height = height;
          state.inset = railInset;
        });
      };

      update = () => {
        if (relayout) {
          relayout = false;
          layout();
        }
        if (!geometry) return;
        const { starts, ends, lastScroll, height } = geometry;
        const reading = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));
        const openedIndex =
          opened === undefined ? -1 : untrack(props.sections).findIndex((section) => section.key === opened);
        const target =
          openedIndex >= 0
            ? Math.min(Math.max(element.scrollTop, starts[openedIndex] ?? 0), ends[openedIndex] ?? reading)
            : reading;
        let position = target;
        if (jump) {
          const progress = Math.min(1, (performance.now() - jump.startedAt) / JUMP_MS);
          if (progress < 1) {
            position = jump.from + (target - jump.from) * easeInOut(progress);
            schedule(false);
          } else jump = undefined;
        }
        drawn = position;
        setRail((state) => {
          state.active =
            openedIndex >= 0 && position === target
              ? openedIndex
              : Math.max(
                  0,
                  starts.findLastIndex((start) => position >= start),
                );
        });
      };

      const onInput = () => {
        opened = undefined;
        jump = undefined;
        schedule(false);
      };
      const onScroll = () => {
        if (opened !== undefined && !held() && !nav?.contains(document.activeElement)) opened = undefined;
        schedule(false);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === "touch" || !nav) return;
        nearBox ??= nav.getBoundingClientRect();
        const box = nearBox;
        const dx = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
        const dy = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
        setNear(dx <= NEAR_PX && dy <= NEAR_PX);
      };
      const onPointerLeave = () => setNear(false);
      const onKey = (event: KeyboardEvent) => {
        if (SCROLL_KEYS.has(event.key) && !editable(event.target)) onInput();
      };

      element.addEventListener("scroll", onScroll, { passive: true });
      element.addEventListener("wheel", onInput, { passive: true });
      element.addEventListener("touchmove", onInput, { passive: true });
      element.addEventListener("keydown", onKey);
      element.addEventListener("pointermove", onPointerMove, { passive: true });
      element.addEventListener("pointerleave", onPointerLeave);
      const resizes = new ResizeObserver(() => {
        inset = undefined;
        nearBox = undefined;
        schedule(true);
      });
      resizes.observe(element);
      schedule(true);

      return () => {
        element.removeEventListener("scroll", onScroll);
        element.removeEventListener("wheel", onInput);
        element.removeEventListener("touchmove", onInput);
        element.removeEventListener("keydown", onKey);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerleave", onPointerLeave);
        resizes.disconnect();
      };
    },
  );

  createEffect(
    () => props.sections(),
    () => schedule(true),
  );

  createEffect(
    () => ({ shown: rail.shown, index: rail.active }),
    ({ index }) => {
      const item = list?.children[index];
      if (!track || !(item instanceof HTMLElement)) return;
      if (track.scrollHeight <= track.clientHeight) return;
      if (item.offsetTop < track.scrollTop) track.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > track.scrollTop + track.clientHeight)
        track.scrollTop = item.offsetTop + item.offsetHeight - track.clientHeight;
    },
  );

  onSettled(() => () => {
    if (frame) cancelAnimationFrame(frame);
  });

  const placeCard = (key: string) => {
    const index = props.sections().findIndex((section) => section.key === key);
    const item = list?.children[index];
    if (!nav || !(item instanceof HTMLElement)) {
      setCard(undefined);
      return;
    }
    const tick = item.getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    setCard({ key, top: tick.top + tick.height / 2, left: box.left, right: box.right });
  };
  const closeCard = (key: string) => {
    if (card()?.key === key) setCard(undefined);
  };
  const followCard = () => {
    const open = card();
    if (open) placeCard(open.key);
  };
  const leaveRail = () => {
    setHeld(false);
    const focused = list ? [...list.children].findIndex((item) => item.matches(":has(:focus-visible)")) : -1;
    const key = props.sections()[focused]?.key;
    if (key) placeCard(key);
    else setCard(undefined);
  };
  createEffect(
    () => card() !== undefined,
    (open) => {
      if (!open) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setCard(undefined);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    },
  );
  const shownCard = createMemo<(CardPlace & { label: string; reply: string | undefined }) | undefined>((last) => {
    const open = card();
    const section = open ? props.sections().find((item) => item.key === open.key) : undefined;
    return open && section ? { ...open, label: section.label, reply: section.reply } : last;
  });
  const state = (index: number) => {
    if (index === rail.active) return "active";
    return index < rail.active ? "read" : "unread";
  };
  const openIndex = createMemo(() => {
    const key = card()?.key;
    return key === undefined ? -1 : props.sections().findIndex((section) => section.key === key);
  });
  const openDistance = (index: number) => {
    const open = openIndex();
    const distance = Math.abs(index - open);
    return open >= 0 && (distance === 1 || distance === 2) ? String(distance) : undefined;
  };

  return (
    <Show when={rail.shown}>
      <div
        class="chat-scroll-rail"
        data-near={near() ? "" : undefined}
        style={{
          height: `${rail.height}px`,
          "margin-bottom": `${-rail.height}px`,
          "--chat-scroll-rail-inset": `${rail.inset}px`,
        }}
      >
        <nav
          ref={(element) => {
            nav = element;
          }}
          class="chat-scroll-rail-nav"
          aria-label={t("chat.scrollRail.label")}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={leaveRail}
        >
          <div
            ref={(element) => {
              track = element;
            }}
            class="chat-scroll-rail-track"
            onScroll={followCard}
          >
            <ol
              ref={(element) => {
                list = element;
              }}
              class="chat-scroll-rail-list"
            >
              <For each={props.sections()} keyed={false}>
                {(section, index) => (
                  <li
                    class="chat-scroll-rail-item"
                    data-state={state(index)}
                    data-open={card()?.key === section().key ? "" : undefined}
                    data-open-distance={openDistance(index)}
                  >
                    <Button
                      variant="link"
                      type="button"
                      class="chat-scroll-rail-link"
                      aria-label={section().label}
                      aria-current={index === rail.active ? "location" : undefined}
                      onPointerEnter={() => placeCard(section().key)}
                      onFocus={() => placeCard(section().key)}
                      onBlur={() => closeCard(section().key)}
                      onClick={() => {
                        opened = section().key;
                        jump =
                          drawn === undefined || prefersReducedMotion()
                            ? undefined
                            : { from: drawn, startedAt: performance.now() };
                        schedule(false);
                        props.onJump(index);
                      }}
                    >
                      <span class="chat-scroll-rail-tick" aria-hidden="true" />
                    </Button>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </nav>
        <Portal>
          <div
            class="chat-scroll-rail-card"
            aria-hidden="true"
            data-open={card() ? "" : undefined}
            style={{
              "--chat-scroll-rail-card-top": `${shownCard()?.top ?? 0}px`,
              "--chat-scroll-rail-card-left": `${shownCard()?.left ?? 0}px`,
              "--chat-scroll-rail-card-right": `${shownCard()?.right ?? 0}px`,
            }}
          >
            <Show when={shownCard()}>
              {(open) => (
                <>
                  <span class="chat-scroll-rail-card-title" dir="auto">
                    {open().label}
                  </span>
                  <Show when={open().reply}>
                    {(reply) => (
                      <span class="chat-scroll-rail-card-reply" dir="auto">
                        {reply()}
                      </span>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>
        </Portal>
      </div>
    </Show>
  );
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
