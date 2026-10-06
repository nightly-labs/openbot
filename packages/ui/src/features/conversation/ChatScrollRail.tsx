import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";

/** How long the rail stays after the reader stops scrolling. */
const IDLE_MS = 1_200;

/** A transcript of one or two days is short enough to find a place in without the rail. */
const MIN_SECTIONS = 3;

/** One part of the transcript, such as a day. */
export interface ChatScrollSection {
  label: string;
  /** Where the part starts in the scroll content. Unknown until its first row has a position. */
  start: number | undefined;
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
 * It is there only when the transcript scrolls and has at least three sections.
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
      setShown(lastScroll > 0 && sections.length >= MIN_SECTIONS);
      if (sections.length < MIN_SECTIONS) return;

      // Each start is at least the one before it: an unknown start ends the section above it at once.
      const starts: number[] = [];
      for (const section of sections) starts.push(Math.max(section.start ?? 0, starts.at(-1) ?? 0));
      const ends = [...starts.slice(1), content];
      // The reader's place moves from the top of the viewport to its bottom over the whole scroll, so
      // the first section is empty at the top and the last one is full at the bottom.
      const position = element.scrollTop + height * (element.scrollTop / Math.max(1, lastScroll));

      setLengths(starts.map((start, index) => Math.max(1, (ends[index] ?? content) - start)));
      setFills(starts.map((start, index) => clamp((position - start) / Math.max(1, (ends[index] ?? content) - start))));
      setActive(
        Math.max(
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
    // Every scroll moves the current day, also one the app makes: focus can open the rail at any time.
    const onScroll = () => {
      if (scrolling()) reveal();
      else schedule();
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) reveal();
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", reveal, { passive: true });
    element.addEventListener("touchmove", reveal, { passive: true });
    element.addEventListener("keydown", onKey);
    const resizes = new ResizeObserver(schedule);
    resizes.observe(element);
    schedule();

    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", reveal);
      element.removeEventListener("touchmove", reveal);
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
                    onClick={() => props.onJump(index)}
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
