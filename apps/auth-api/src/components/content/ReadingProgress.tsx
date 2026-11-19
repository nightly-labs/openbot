import { createSignal, createTrackedEffect, For, Show } from "solid-js";

const READING_LINE = 0.3;

interface ReadingSection {
  id: string;
  label: string;
}

interface ReadingGeometry {
  top: number;
  bottom: number;
  starts: number[];
  ends: number[];
}

export interface ReadingProgressProps {
  article: () => HTMLElement | undefined;
  title: string;
  slug: string;
}

export function ReadingProgress(props: ReadingProgressProps) {
  const [sections, setSections] = createSignal<ReadingSection[]>([]);
  const [lengths, setLengths] = createSignal<number[]>([]);
  const [fills, setFills] = createSignal<number[]>([]);
  const [active, setActive] = createSignal(0);
  const [progress, setProgress] = createSignal(0);
  const [visible, setVisible] = createSignal(false);

  createTrackedEffect(() => {
    void props.slug;
    const article = props.article();
    if (!article) return;

    let geometry: ReadingGeometry | undefined;
    let headings: HTMLElement[] = [];

    const layout = () => {
      const top = article.getBoundingClientRect().top + window.scrollY;
      const bottom = top + article.offsetHeight;
      const starts = [top, ...headings.map((heading) => heading.getBoundingClientRect().top + window.scrollY)];
      const ends = [...starts.slice(1), bottom];
      geometry = { top, bottom, starts, ends };
      setLengths(starts.map((start, index) => Math.max(1, (ends[index] ?? bottom) - start)));
    };

    const update = () => {
      if (!geometry) return;
      const { top, bottom, starts, ends } = geometry;
      const viewport = window.innerHeight;
      const line = viewport * READING_LINE;
      const lastScroll = document.documentElement.scrollHeight - viewport;
      const unreachable = Math.max(0, bottom - (lastScroll + line));
      const position =
        window.scrollY + line + unreachable * clamp(1 - (lastScroll - window.scrollY) / Math.max(1, viewport));

      setProgress(clamp((position - top) / Math.max(1, bottom - top)));
      setFills(starts.map((start, index) => clamp((position - start) / Math.max(1, (ends[index] ?? bottom) - start))));
      setActive(
        Math.max(
          0,
          starts.findLastIndex((start) => position >= start),
        ),
      );
      const firstHeading = starts[1] ?? bottom;
      setVisible(window.scrollY + viewport * 0.6 > firstHeading && position < bottom);
    };

    let frame = 0;
    const schedule = (measure: boolean) => {
      if (measure) geometry = undefined;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!geometry) layout();
        update();
      });
    };
    const onScroll = () => schedule(false);
    const onResize = () => schedule(true);

    frame = requestAnimationFrame(() => {
      frame = 0;
      headings = Array.from(article.querySelectorAll<HTMLElement>("h2"));
      const fragment = window.location.hash.slice(1);
      const unopened = fragment !== "" && !document.getElementById(fragment);
      const taken = new Set<string>();
      setSections([
        { id: "top", label: props.title },
        ...headings.map((heading) => ({ id: headingId(heading, taken), label: heading.textContent?.trim() ?? "" })),
      ]);
      if (unopened) document.getElementById(fragment)?.scrollIntoView({ behavior: "instant" });
      layout();
      update();
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    const resizes = globalThis.ResizeObserver ? new ResizeObserver(onResize) : undefined;
    resizes?.observe(article);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      resizes?.disconnect();
    };
  });

  const count = () => sections().length;
  const state = (index: number) => {
    if (index === active()) return "active";
    return index < active() ? "read" : "unread";
  };

  return (
    <Show when={count() > 1}>
      <div
        class="reading-progress"
        data-visible={visible() ? "true" : "false"}
        style={{ "--reading-progress": progress() }}
      >
        <span class="reading-progress-line" aria-hidden="true" />
        <nav class="reading-progress-rail" aria-label="On this page">
          <span class="reading-progress-surface" aria-hidden="true" />
          <p class="reading-progress-eyebrow" aria-hidden="true">
            <span>On this page</span>
            <span class="reading-progress-count">
              {pad(active() + 1)} / {pad(count())}
            </span>
          </p>
          <ol class="reading-progress-list">
            <For each={sections()}>
              {(section, index) => (
                <li
                  class="reading-progress-item"
                  data-state={state(index())}
                  style={{
                    "flex-grow": lengths()[index()] ?? 1,
                    "--reading-fill": fills()[index()] ?? 0,
                    "--reading-index": index(),
                  }}
                >
                  <a
                    class="reading-progress-link"
                    href={`#${section.id}`}
                    aria-current={index() === active() ? "location" : undefined}
                  >
                    <span class="reading-progress-label">{section.label}</span>
                    <span class="reading-progress-bar" aria-hidden="true">
                      <span class="reading-progress-fill" />
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ol>
        </nav>
      </div>
    </Show>
  );
}

function headingId(heading: HTMLElement, taken: Set<string>): string {
  if (heading.id) {
    taken.add(heading.id);
    return heading.id;
  }
  const base =
    (heading.textContent ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  let id = base;
  for (let suffix = 2; taken.has(id) || document.getElementById(id); suffix += 1) id = `${base}-${suffix}`;
  taken.add(id);
  heading.id = id;
  return id;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
