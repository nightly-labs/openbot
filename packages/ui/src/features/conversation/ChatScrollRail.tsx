import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { type ChatDaySection, calendarDaysBetween, type DayMarkerOptions } from "./chat-day-markers";

/** How long the rail stays after the reader stops scrolling. */
const IDLE_MS = 1_200;

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
 * That part is as tall as its messages would be at the loaded rows' average height, so the rail shows
 * the whole length of the chat before the reader pages through it.
 */
export function chatScrollSections(input: {
  days: readonly ChatDaySection[];
  rows: readonly { createdAt?: string | undefined }[];
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
  if (!unloaded || unloaded.count === 0 || input.rows.length === 0) return loaded;
  const firstStart = input.itemStart(0) ?? 0;
  const averageRow = input.totalSize / input.rows.length;
  const firstLoadedAt = input.rows[0]?.createdAt;
  const { t, format } = input.text;
  const oldest = unloaded.oldestAt ? new Date(unloaded.oldestAt) : undefined;
  const earlier: ChatScrollSection = {
    label:
      oldest && !Number.isNaN(oldest.getTime())
        ? t("chat.scrollRail.earlierSince", { date: format.date(oldest, { month: "short", day: "numeric" }) })
        : t("chat.scrollRail.earlier"),
    start: firstStart - unloaded.count * averageRow,
    // The days before the first loaded one. History on that same day adds none.
    days: unloaded.oldestAt && firstLoadedAt ? calendarDaysBetween(unloaded.oldestAt, firstLoadedAt) : 1,
  };
  return [earlier, ...loaded];
}

export interface ChatScrollRailProps {
  scrollElement: () => HTMLElement | undefined;
  sections: () => readonly ChatScrollSection[];
  onJump: (section: number) => void;
}

/**
 * Where the reader is in a long transcript. The scroll container shows no scroll bar, so this rail on
 * its right edge gives the length of the transcript and the reader's place in it.
 *
 * One segment per section, as long as the section, filling while the reader is in it. It comes in
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
  const [viewport, setViewport] = createSignal({ height: 0, inset: 0 });
  const [lengths, setLengths] = createSignal<number[]>([]);
  const [fills, setFills] = createSignal<number[]>([]);
  const [active, setActive] = createSignal(0);
  const [scrolling, setScrolling] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [shown, setShown] = createSignal(false);

  let frame = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let measure = () => {};
  /*
   * The section the reader opened from the rail, by its label. Near the end of a chat the jump stops at
   * the bottom, where the place on the rail is the last section; the opened one stays current until the
   * reader scrolls. A label, not an index: a page that loads above it moves its index.
   */
  let opened: string | undefined;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };

  createEffect(props.scrollElement, (element) => {
    if (!element) return;

    measure = () => {
      const height = element.clientHeight;
      const content = element.scrollHeight;
      const lastScroll = Math.max(0, content - height);
      const sections = props.sections();
      setViewport({ height, inset: Number.parseFloat(getComputedStyle(element).paddingRight) || 0 });
      const days = sections.reduce((total, section) => total + (section.days ?? 1), 0);
      setShown(lastScroll > 0 && days >= MIN_DAYS);
      if (days < MIN_DAYS) return;

      // Each start is at least the one before it: an unknown start ends the section above it at once.
      const starts: number[] = [];
      for (const section of sections) {
        const previous = starts.at(-1);
        starts.push(Math.max(section.start ?? previous ?? 0, previous ?? Number.NEGATIVE_INFINITY));
      }
      const ends = [...starts.slice(1), content];
      // The reader's place moves from the top of the viewport to its bottom over the whole scroll, so
      // the first section is empty at the top and the last one is full at the bottom.
      const position = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));

      setLengths(starts.map((start, index) => Math.max(1, (ends[index] ?? content) - start)));
      setFills(starts.map((start, index) => clamp((position - start) / Math.max(1, (ends[index] ?? content) - start))));
      const openedIndex = opened === undefined ? -1 : sections.findIndex((section) => section.label === opened);
      setActive(
        openedIndex >= 0
          ? openedIndex
          : Math.max(
              0,
              starts.findLastIndex((start) => position >= start),
            ),
      );
    };

    // Only what the reader does brings the rail in. A scroll after it, such as momentum, keeps it.
    const reveal = () => {
      setScrolling(true);
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => setScrolling(false), IDLE_MS);
      schedule();
    };
    // The reader scrolls on their own again, so their place decides the current section.
    const onInput = () => {
      opened = undefined;
      reveal();
    };
    // Every scroll moves the current day, also one the app makes: focus can open the rail at any time.
    const onScroll = () => {
      if (scrolling()) reveal();
      else schedule();
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) onInput();
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onInput, { passive: true });
    element.addEventListener("touchmove", onInput, { passive: true });
    element.addEventListener("keydown", onKey);
    const resizes = new ResizeObserver(schedule);
    resizes.observe(element);
    schedule();

    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onInput);
      element.removeEventListener("touchmove", onInput);
      element.removeEventListener("keydown", onKey);
      resizes.disconnect();
    };
  });

  // New rows and new measurements move the sections.
  createEffect(props.sections, schedule);

  onSettled(() => () => {
    if (frame) cancelAnimationFrame(frame);
    if (idle) clearTimeout(idle);
  });

  const count = () => props.sections().length;
  const state = (index: number) => {
    if (index === active()) return "active";
    return index < active() ? "read" : "unread";
  };

  return (
    <Show when={shown()}>
      <div
        class="chat-scroll-rail"
        data-visible={scrolling() || held() ? "true" : "false"}
        style={{
          height: `${viewport().height}px`,
          "margin-bottom": `${-viewport().height}px`,
          "--chat-scroll-rail-inset": `${viewport().inset}px`,
        }}
      >
        <nav
          class="chat-scroll-rail-nav"
          aria-label={t("chat.scrollRail.label")}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
        >
          <span class="chat-scroll-rail-surface" aria-hidden="true" />
          <p class="chat-scroll-rail-eyebrow" aria-hidden="true">
            <span>{t("chat.scrollRail.label")}</span>
            <span class="chat-scroll-rail-count">
              {pad(active() + 1)} / {pad(count())}
            </span>
          </p>
          <ol class="chat-scroll-rail-list">
            <For each={props.sections()} keyed={false}>
              {(section, index) => (
                <li
                  class="chat-scroll-rail-item"
                  data-state={state(index)}
                  style={{
                    "flex-grow": lengths()[index] ?? 1,
                    "--chat-scroll-rail-fill": fills()[index] ?? 0,
                    "--chat-scroll-rail-index": index,
                  }}
                >
                  <Button
                    variant="link"
                    type="button"
                    class="chat-scroll-rail-link"
                    aria-current={index === active() ? "location" : undefined}
                    onClick={() => {
                      opened = section().label;
                      schedule();
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
        </nav>
      </div>
    </Show>
  );
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
