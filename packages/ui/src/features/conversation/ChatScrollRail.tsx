import { Button } from "@openbot/ui";
import { createDigitRoll } from "@openbot/ui/digit-roll";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, createStore, For, onSettled, Show } from "solid-js";
import {
  type ChatDayRow,
  type ChatDaySection,
  calendarDaysBetween,
  chatDaySections,
  type DayMarkerOptions,
} from "./chat-day-markers";
import type { ChatVirtualizer } from "./createChatVirtualizer";

/** How long the rail stays after the reader stops scrolling. */
const IDLE_MS = 1_200;

/**
 * How long the rail's place takes to reach the opened section after a jump from the rail. A fixed
 * length, not a decay: the place passes each section's start, and so moves the count, at the same
 * moment as the head.
 */
const JUMP_MS = 450;

/** A transcript of one or two days is short enough to find a place in without the rail. */
const MIN_DAYS = 3;

/** One part of the transcript, such as a day. */
export interface ChatScrollSection {
  label: string;
  /**
   * Where the part starts in the scroll content. Unknown until its first row has a position. The part
   * above the loaded rows starts above the content, so its start is negative.
   */
  start: number | undefined;
  /** The days the part covers, for the rule that shows the rail. One when absent. */
  days?: number;
  /** The row the part opens with. Absent for the part that is not loaded yet. */
  row?: number;
}

/** The messages above the loaded page, from the page's `olderCount` and `oldestAt`. */
export interface UnloadedHistory {
  count: number;
  oldestAt?: string | undefined;
}

/** The unloaded part a history page reports, or nothing when its host does not count it. */
export function unloadedHistory(
  page: { olderCount?: number | undefined; oldestAt?: string | undefined } | null | undefined,
): UnloadedHistory | undefined {
  return page?.olderCount ? { count: page.olderCount, oldestAt: page.oldestAt } : undefined;
}

/**
 * The rail's sections: one per loaded day, and above them one for the history that is not loaded yet.
 * That part is as tall as its messages would be at the height each loaded message takes, so the rail
 * shows the whole length of the chat before the reader pages through it.
 */
export function chatScrollSections(input: {
  days: readonly ChatDaySection[];
  rows: readonly ChatDayRow[];
  /**
   * The stored messages the loaded rows come from. A timeline can hide a stored message or join several
   * into one row, and the unloaded count is of stored messages.
   */
  storedCount: number;
  itemStart: (index: number) => number | undefined;
  totalSize: number;
  unloaded: UnloadedHistory | undefined;
  text: Required<Pick<DayMarkerOptions, "t" | "format">>;
}): ChatScrollSection[] {
  const loaded: ChatScrollSection[] = input.days.map((day) => ({
    label: day.label,
    start: input.itemStart(day.index),
    row: day.index,
  }));
  const unloaded = input.unloaded;
  if (!unloaded || unloaded.count === 0 || input.rows.length === 0 || input.storedCount === 0) return loaded;
  const firstStart = input.itemStart(0) ?? 0;
  const heightPerMessage = input.totalSize / input.storedCount;
  const firstLoadedAt = input.rows[0]?.createdAt;
  const { t, format } = input.text;
  const oldest = unloaded.oldestAt ? new Date(unloaded.oldestAt) : undefined;
  const earlier: ChatScrollSection = {
    label:
      oldest && !Number.isNaN(oldest.getTime())
        ? t("chat.scrollRail.earlierSince", { date: format.date(oldest, { month: "short", day: "numeric" }) })
        : t("chat.scrollRail.earlier"),
    start: firstStart - unloaded.count * heightPerMessage,
    // The days before the first loaded one. History on that same day adds none.
    days: unloaded.oldestAt && firstLoadedAt ? calendarDaysBetween(unloaded.oldestAt, firstLoadedAt) : 1,
  };
  return [earlier, ...loaded];
}

interface RailState {
  shown: boolean;
  height: number;
  inset: number;
  lengths: number[];
  fills: number[];
  active: number;
}

export interface ChatScrollRailProps {
  scrollElement: () => HTMLElement | undefined;
  sections: () => readonly ChatScrollSection[];
  onJump: (section: number) => void;
}

/**
 * The rail of one transcript: its days from the rendered rows, the part that is not loaded, and the
 * jumps. Give `ref` the scroll container and spread `props` on `ChatScrollRail`.
 */
export function createChatScrollRail(options: {
  /** The rendered rows, in order. */
  rows: () => readonly ChatDayRow[];
  /** The stored messages behind the rows. The number of rows when absent. */
  storedCount?: () => number;
  unloaded: () => UnloadedHistory | undefined;
  virtualizer: Pick<ChatVirtualizer<Element>, "itemStart" | "scrollToIndex" | "getTotalSize">;
  onLoadOlder: () => void;
  /** Runs before each jump, such as to stop following the newest message. */
  onJump: () => void;
}): { ref: (element: HTMLElement) => void; props: ChatScrollRailProps } {
  const { t, format } = useText();
  const [scrollElement, setScrollElement] = createSignal<HTMLElement>();
  const days = createMemo(() => chatDaySections(options.rows(), { t, format }));
  const sections = createMemo(() => {
    const rows = options.rows();
    return chatScrollSections({
      days: days(),
      rows,
      storedCount: options.storedCount?.() ?? rows.length,
      itemStart: options.virtualizer.itemStart,
      totalSize: options.virtualizer.getTotalSize(),
      unloaded: options.unloaded(),
      text: { t, format },
    });
  });
  /*
   * A loaded day opens at its first row, with a smooth scroll. The part that is not loaded opens at the
   * top at once and loads a page: a page that loads above a smooth scroll moves its target.
   */
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

/**
 * Where the reader is in a long transcript. The scroll container shows no scroll bar, so this rail on
 * its right edge gives the length of the transcript and the reader's place in it.
 *
 * One segment per section, as long as the section, filling while the reader is in it. A jump from the
 * rail eases the place there, so one fill runs through the days between. It comes in
 * while the reader scrolls and goes again when they stop. A pointer or keyboard focus opens it into
 * the section titles, and each title opens its section. A scroll that the app makes, such as following a
 * reply that streams in, does not bring it in.
 *
 * It is there only when the transcript scrolls and covers at least three days.
 *
 * Render it as the first child of the scroll container: it stays in place over the transcript and
 * takes no room in it.
 */
export function ChatScrollRail(props: ChatScrollRailProps) {
  const { t } = useText();
  // The layout fields change on a resize or a new section; `fills` and `active` on every scroll.
  const [rail, setRail] = createStore<RailState>({
    shown: false,
    height: 0,
    inset: 0,
    lengths: [],
    fills: [],
    active: 0,
  });
  const [scrolling, setScrolling] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  // Where the bar of the current section is in the list, for the reading head.
  const [head, setHead] = createSignal({ top: 0, length: 0 });

  let nav: HTMLElement | undefined;
  let track: HTMLElement | undefined;
  let list: HTMLOListElement | undefined;
  let frame = 0;
  let relayout = true;
  let idle: ReturnType<typeof setTimeout> | undefined;
  // The place the rail draws, in the scroll content, and the jump that eases it from where it was.
  let drawn: number | undefined;
  let jump: { from: number; startedAt: number } | undefined;
  let update = () => {};
  /*
   * The section the reader opened from the rail, by its label. Near the end of a chat the jump stops at
   * the bottom, where the place on the rail is the last section; the opened one stays current until the
   * reader scrolls or the app scrolls for them. A label, not an index: a page that loads above it moves
   * its index.
   */
  let opened: string | undefined;
  const schedule = (layout: boolean) => {
    if (layout) relayout = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  createEffect(props.scrollElement, (element) => {
    // A pointer over the rail of the previous chat left with it.
    setHeld(false);
    opened = undefined;
    drawn = undefined;
    jump = undefined;
    relayout = true;
    if (!element) return;

    // Where each section starts and ends, read again only when the layout or the sections change.
    let geometry: { starts: number[]; ends: number[]; lastScroll: number; height: number } | undefined;
    const layout = () => {
      const height = element.clientHeight;
      const content = element.scrollHeight;
      const lastScroll = Math.max(0, content - height);
      const sections = props.sections();
      const days = sections.reduce((total, section) => total + (section.days ?? 1), 0);
      if (lastScroll === 0 || days < MIN_DAYS) {
        geometry = undefined;
        setHeld(false);
        setRail((state) => {
          state.shown = false;
        });
        return;
      }
      // Each start is at least the one before it: an unknown start ends the section above it at once.
      const starts: number[] = [];
      for (const section of sections) {
        const previous = starts.at(-1);
        starts.push(Math.max(section.start ?? previous ?? 0, previous ?? Number.NEGATIVE_INFINITY));
      }
      const ends = [...starts.slice(1), content];
      geometry = { starts, ends, lastScroll, height };
      setRail((state) => {
        state.shown = true;
        state.height = height;
        state.inset = Number.parseFloat(getComputedStyle(element).paddingRight) || 0;
        state.lengths = starts.map((start, index) => Math.max(1, (ends[index] ?? content) - start));
      });
    };

    update = () => {
      if (relayout) {
        relayout = false;
        layout();
      }
      if (!geometry) return;
      const { starts, ends, lastScroll, height } = geometry;
      // The reader's place moves from the top of the viewport to its bottom over the whole scroll, so
      // the first section is empty at the top and the last one is full at the bottom.
      const reading = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));
      const openedIndex = opened === undefined ? -1 : props.sections().findIndex((section) => section.label === opened);
      // An opened section shows the place at the top of the viewport, kept inside the section: near the
      // end of the chat the place above is past the section, and the jump opens the section at its start.
      const target =
        openedIndex >= 0
          ? Math.min(Math.max(element.scrollTop, starts[openedIndex] ?? 0), ends[openedIndex] ?? reading)
          : reading;
      // A jump eases the place to the target, so one fill runs through the days between in order and
      // the head and the count go with it. After it, the rail follows the scroll directly again.
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
        state.fills = starts.map((start, index) => clamp((position - start) / Math.max(1, (ends[index] ?? 0) - start)));
        state.active =
          openedIndex >= 0 && position === target
            ? openedIndex
            : Math.max(
                0,
                starts.findLastIndex((start) => position >= start),
              );
      });
    };

    // Only what the reader does brings the rail in. A scroll after it, such as momentum, keeps it.
    const reveal = () => {
      setScrolling(true);
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => setScrolling(false), IDLE_MS);
      schedule(false);
    };
    // The reader scrolls on their own again, so their place decides the current section.
    const onInput = () => {
      opened = undefined;
      jump = undefined;
      reveal();
    };
    // Every scroll moves the current day, also one the app makes: focus can open the rail at any time.
    // A scroll that does not come from the rail, such as Show latest or a search match, ends the
    // opened section. The jump itself runs while the pointer or the focus is still on the rail.
    const onScroll = () => {
      if (opened !== undefined && !held() && !nav?.contains(document.activeElement)) opened = undefined;
      if (scrolling()) reveal();
      else schedule(false);
    };
    // Keys typed into a field in the transcript, such as an answer to a question, scroll nothing.
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key) && !editable(event.target)) onInput();
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onInput, { passive: true });
    element.addEventListener("touchmove", onInput, { passive: true });
    element.addEventListener("keydown", onKey);
    const resizes = new ResizeObserver(() => schedule(true));
    resizes.observe(element);
    schedule(true);

    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onInput);
      element.removeEventListener("touchmove", onInput);
      element.removeEventListener("keydown", onKey);
      resizes.disconnect();
    };
  });

  // New rows and new measurements move the sections.
  createEffect(props.sections, () => schedule(true));

  // A list taller than the rail scrolls itself, not the transcript, to keep the current day in view.
  // The reading head goes to the bar of the current day, which moves when the lengths change.
  createEffect(
    () => ({ shown: rail.shown, index: rail.active, lengths: [...rail.lengths] }),
    ({ index }) => {
      const item = list?.children[index];
      if (!track || !(item instanceof HTMLElement)) return;
      setHead({ top: item.offsetTop, length: item.offsetHeight });
      if (track.scrollHeight <= track.clientHeight) return;
      if (item.offsetTop < track.scrollTop) track.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > track.scrollTop + track.clientHeight)
        track.scrollTop = item.offsetTop + item.offsetHeight - track.clientHeight;
    },
  );

  onSettled(() => () => {
    if (frame) cancelAnimationFrame(frame);
    if (idle) clearTimeout(idle);
  });

  const count = () => props.sections().length;
  /*
   * The number of the current section rolls to each new value: from below when the reader goes down
   * the chat, from above when they go up. Only the digits that change roll.
   */
  const roll = createDigitRoll(() => rail.active + 1, { settleMs: 0, animate: () => !prefersReducedMotion() });
  const position = createMemo<{ digits: string[]; previous: string; down: boolean }>((last) => {
    const value = roll.displayed();
    const previous = last ? last.digits.join("") : pad(value);
    return { digits: pad(value).split(""), previous, down: !last || value >= Number(previous) };
  });
  const state = (index: number) => {
    if (index === rail.active) return "active";
    return index < rail.active ? "read" : "unread";
  };

  return (
    <Show when={rail.shown}>
      <div
        class="chat-scroll-rail"
        data-visible={scrolling() || held() ? "true" : "false"}
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
          onPointerLeave={() => setHeld(false)}
        >
          <span class="chat-scroll-rail-surface" aria-hidden="true" />
          <p class="chat-scroll-rail-eyebrow" aria-hidden="true">
            <span>{t("chat.scrollRail.label")}</span>
            <span class="chat-scroll-rail-count">
              <span ref={roll.ref} class="t-digit-group" style={{ "--digit-dir-y": position().down ? 1 : -1 }}>
                <For each={position().digits} keyed={false}>
                  {(digit, index) => (
                    <span class={digit() === position().previous[index] ? undefined : "t-digit"}>{digit()}</span>
                  )}
                </For>
              </span>
              {" / "}
              {pad(count())}
            </span>
          </p>
          <div
            ref={(element) => {
              track = element;
            }}
            class="chat-scroll-rail-track"
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
                    style={{
                      "flex-grow": rail.lengths[index] ?? 1,
                      "--chat-scroll-rail-fill": rail.fills[index] ?? 0,
                      "--chat-scroll-rail-index": index,
                    }}
                  >
                    <Button
                      variant="link"
                      type="button"
                      class="chat-scroll-rail-link"
                      aria-current={index === rail.active ? "location" : undefined}
                      onClick={() => {
                        opened = section().label;
                        jump =
                          drawn === undefined || prefersReducedMotion()
                            ? undefined
                            : { from: drawn, startedAt: performance.now() };
                        schedule(false);
                        props.onJump(index);
                      }}
                    >
                      <span class="chat-scroll-rail-label">{section().label}</span>
                      <span class="chat-scroll-rail-bar" aria-hidden="true">
                        <span class="chat-scroll-rail-fill" />
                      </span>
                    </Button>
                  </li>
                )}
              </For>
            </ol>
            {/* The reading head: where the reader is inside the current day. */}
            <span
              class="chat-scroll-rail-head"
              aria-hidden="true"
              style={{
                "--chat-scroll-rail-head-top": `${head().top}px`,
                "--chat-scroll-rail-head-length": `${head().length}px`,
                "--chat-scroll-rail-fill": rail.fills[rail.active] ?? 0,
              }}
            />
          </div>
        </nav>
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

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
