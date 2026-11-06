import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";
import type { DayMarkerOptions } from "./chat-day-markers";
import type { ChatVirtualizer } from "./createChatVirtualizer";

/**
 * How long the rail's place takes to reach the opened section after a jump from the rail. A fixed
 * length, not a decay: the place passes each section's start in order, so the current tick runs
 * through the sections between.
 */
const JUMP_MS = 450;

/** How close the pointer comes to the rail, in pixels, before the ticks show. */
const NEAR_PX = 80;

/** A transcript with fewer sections is short enough to find a place in without the rail. */
const MIN_SECTIONS = 2;

/** The most characters of a message that its title or reply keeps. The card cuts longer text with an ellipsis. */
const LABEL_LENGTH = 160;

/** One part of the transcript: a message the reader wrote and the replies under it. */
export interface ChatScrollSection {
  /** The id of the row the part opens with. A page that loads above it does not change it. */
  key: string;
  label: string;
  /** The start of the first reply under the message. Absent before a reply comes in. */
  reply?: string;
  /**
   * Where the part starts in the scroll content. Unknown until its first row has a position. The part
   * above the loaded rows starts above the content, so its start is negative.
   */
  start: number | undefined;
  /** The row the part opens with. Absent for the part that is not loaded yet. */
  row?: number;
}

/** A transcript row as the rail reads it. */
export interface ChatScrollRow {
  id: string;
}

/** A message the reader wrote: the row it is on, its title, and the start of the first reply under it. */
export interface ChatScrollQuestion {
  index: number;
  key: string;
  label: string;
  reply?: string;
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
 * The messages the reader wrote, each with a one-line title as the chat shows it: a mention shows its
 * name and Markdown marks are removed. A message with no text, such as one with only an attachment,
 * opens no section. `reply` gives the text of a reply row; the first one under a message becomes its
 * reply. `labels` keeps the plain text of the last call, so a reply that streams in does not read each
 * message again.
 */
export function chatScrollQuestions<Row extends ChatScrollRow>(
  rows: readonly Row[],
  question: (row: Row) => string | undefined,
  labels: Map<string, string> = new Map(),
  reply?: (row: Row) => string | undefined,
): { questions: ChatScrollQuestion[]; labels: Map<string, string> } {
  const questions: ChatScrollQuestion[] = [];
  const next = new Map<string, string>();
  const plain = (source: string | undefined): string | undefined => {
    // A long paste needs only its start: the card shows one or two lines.
    const text = source?.slice(0, LABEL_LENGTH * 4);
    if (!text) return undefined;
    const label = next.get(text) ?? labels.get(text) ?? markdownPreviewText(text).slice(0, LABEL_LENGTH);
    next.set(text, label);
    return label || undefined;
  };
  // The message the next reply answers. A message with no section has no card, so its reply goes to none.
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

/**
 * The rail's sections: one per message the reader wrote, and above them one for the history that is
 * not loaded yet. That part is as tall as its messages would be at the height each loaded message
 * takes, so the rail shows the whole length of the chat before the reader pages through it.
 */
export function chatScrollSections(input: {
  questions: readonly ChatScrollQuestion[];
  /** The rendered rows. */
  rowCount: number;
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
    // With no part above, the first section also holds the rows above its message, such as an agent's
    // introduction, so the rail covers the whole chat.
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

/** Where an open card stands: its tick's middle and the rail's edges, in the window. */
interface CardPlace {
  /** The section's key, not its index: a page that loads above it moves its index. */
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

/**
 * The rail of one transcript: the messages the reader wrote in the rendered rows, the part that is not
 * loaded, and the jumps. Give `ref` the scroll container and spread `props` on `ChatScrollRail`.
 */
export function createChatScrollRail<Row extends ChatScrollRow>(options: {
  /** The rendered rows, in order. */
  rows: () => readonly Row[];
  /** The text of a row the reader wrote, which opens a section. Undefined for any other row. */
  question: (row: Row) => string | undefined;
  /** The text of a reply row. The card of a section shows the start of the first one. */
  reply?: (row: Row) => string | undefined;
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
  // The titles change only with the rows. A new measurement moves the starts, not the titles.
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
  /*
   * A loaded message opens at its row, with a smooth scroll. The part that is not loaded opens at the
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
 * its right edge gives the reader's place in the transcript.
 *
 * One tick per message the reader wrote, at the same spacing for each. The ticks above the reader's
 * place are stronger, and the tick of the current section is the longest. With a mouse, the ticks show
 * only when the pointer comes near the rail, and grow when it is on the rail. A jump from the rail eases the
 * place there, so the current tick runs through the sections between. Pointing at a tick, or focusing
 * it, opens a card over a blur of the transcript with the message and the start of its reply, and the
 * tick opens its section.
 *
 * It is there only when the transcript scrolls and has at least two sections.
 *
 * Render it as the first child of the scroll container: it stays in place over the transcript and
 * takes no room in it.
 */
export function ChatScrollRail(props: ChatScrollRailProps) {
  const { t } = useText();
  // The layout fields change on a resize or a new section; `active` on a scroll.
  const [rail, setRail] = createStore<RailState>({
    shown: false,
    height: 0,
    inset: 0,
    active: 0,
  });
  const [held, setHeld] = createSignal(false);
  // The pointer is near the rail, so the ticks show.
  const [near, setNear] = createSignal(false);
  // The section whose card is open, where its tick is in the window, and the rail's two edges.
  const [card, setCard] = createSignal<CardPlace>();

  let nav: HTMLElement | undefined;
  let track: HTMLElement | undefined;
  let list: HTMLOListElement | undefined;
  let frame = 0;
  let relayout = true;
  // The place the rail draws, in the scroll content, and the jump that eases it from where it was.
  let drawn: number | undefined;
  let jump: { from: number; startedAt: number } | undefined;
  let update = () => {};
  /*
   * The section the reader opened from the rail, by its key. Near the end of a chat the jump stops at
   * the bottom, where the place on the rail is the last section; the opened one stays current until the
   * reader scrolls or the app scrolls for them. A key, not an index: a page that loads above it moves
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

  createEffect(
    () => props.scrollElement(),
    (element) => {
      // A pointer over the rail of the previous chat left with it.
      setHeld(false);
      setNear(false);
      setCard(undefined);
      opened = undefined;
      drawn = undefined;
      jump = undefined;
      relayout = true;
      if (!element) return;
      // The container's side padding, read again only on a resize: it reads the computed style.
      let inset: number | undefined;

      // The rail's box in the window, for the pointer's distance to it. The rail sticks to the top of the
      // container, so a scroll does not move it; a resize or a new layout reads it again.
      let nearBox: DOMRect | undefined;

      // Where each section starts and ends, read again only when the layout or the sections change.
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
        // Each start is at least the one before it: an unknown start ends the section above it at once.
        const starts: number[] = [];
        for (const section of sections) {
          const previous = starts.at(-1);
          starts.push(Math.max(section.start ?? previous ?? 0, previous ?? Number.NEGATIVE_INFINITY));
        }
        const ends = [...starts.slice(1), content];
        geometry = { starts, ends, lastScroll, height };
        // The rail sits at the inline end: the right edge, or the left one right to left.
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
        // The reader's place moves from the top of the viewport to its bottom over the whole scroll, so
        // the first section is current at the top and the last one at the bottom.
        const reading = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));
        const openedIndex =
          opened === undefined ? -1 : untrack(props.sections).findIndex((section) => section.key === opened);
        // An opened section shows the place at the top of the viewport, kept inside the section: near the
        // end of the chat the place above is past the section, and the jump opens the section at its start.
        const target =
          openedIndex >= 0
            ? Math.min(Math.max(element.scrollTop, starts[openedIndex] ?? 0), ends[openedIndex] ?? reading)
            : reading;
        // A jump eases the place to the target, so the current tick runs through the sections between in
        // order. After it, the rail follows the scroll directly again.
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

      // The reader scrolls on their own again, so their place decides the current section.
      const onInput = () => {
        opened = undefined;
        jump = undefined;
        schedule(false);
      };
      // Every scroll moves the current section, also one the app makes. A scroll that does not come from
      // the rail, such as Show latest or a search match, ends the opened section. The jump itself runs
      // while the pointer or the focus is still on the rail.
      const onScroll = () => {
        if (opened !== undefined && !held() && !nav?.contains(document.activeElement)) opened = undefined;
        schedule(false);
      };
      // A touch has no pointer to come near the rail, so only a mouse or a pen shows and hides it.
      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === "touch" || !nav) return;
        nearBox ??= nav.getBoundingClientRect();
        const box = nearBox;
        const dx = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
        const dy = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
        setNear(dx <= NEAR_PX && dy <= NEAR_PX);
      };
      const onPointerLeave = () => setNear(false);
      // Keys typed into a field in the transcript, such as an answer to a question, scroll nothing.
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

  // New rows and new measurements move the sections.
  createEffect(
    () => props.sections(),
    () => schedule(true),
  );

  // A list taller than the rail scrolls itself, not the transcript, to keep the current tick in view.
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

  /*
   * The card stands level with the tick it belongs to, beside the rail. It is in a portal: the mask that
   * fades the transcript's edges would otherwise stop its backdrop blur.
   */
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
  // When the ticks scroll, also when the focus or the current tick scrolls them, the card follows its tick.
  const followCard = () => {
    const open = card();
    if (open) placeCard(open.key);
  };
  // The pointer leaves the rail, but a tick can still have the keyboard focus: its card stays.
  const leaveRail = () => {
    setHeld(false);
    const focused = list ? [...list.children].findIndex((item) => item.matches(":has(:focus-visible)")) : -1;
    const key = props.sections()[focused]?.key;
    if (key) placeCard(key);
    else setCard(undefined);
  };
  // Escape closes the card, also when the pointer stays on its tick.
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
  // A closed card keeps its last text while it fades out.
  const shownCard = createMemo<(CardPlace & { label: string; reply: string | undefined }) | undefined>((last) => {
    const open = card();
    const section = open ? props.sections().find((item) => item.key === open.key) : undefined;
    return open && section ? { ...open, label: section.label, reply: section.reply } : last;
  });
  const state = (index: number) => {
    if (index === rail.active) return "active";
    return index < rail.active ? "read" : "unread";
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
        {/* The message and the start of its reply, beside the tick under the pointer or the focus. */}
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
