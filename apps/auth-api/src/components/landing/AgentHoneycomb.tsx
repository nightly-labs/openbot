import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import { articleGradient, articleGradientCss } from "../../lib/article-gradient";
import { articleArtPath } from "../../lib/content-collection";
import { NEWS_COLLECTION } from "../../lib/news";

const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

const ART_SLUGS = new Set([
  "introducing-openbot",
  "channels-put-agents-in-one-room",
  "every-agent-gets-a-workspace",
  "one-agent-many-providers",
  "routines-give-an-agent-a-schedule",
  "your-work-stays-on-your-computer",
]);

const ART = NEWS_COLLECTION.articles
  .filter((article) => ART_SLUGS.has(article.slug))
  .map((article) => ({
    src: articleArtPath(NEWS_COLLECTION, article.slug, "card"),
    gradient: articleGradientCss(articleGradient(article.title)),
  }));

type HoneycombTile = { kind: "agent"; seed: string } | ({ kind: "art" } & (typeof ART)[number]);

interface HoneycombCell {
  index: number;
  tile: HoneycombTile;
}

function scatteredPhase(index: number): number {
  return ((Math.imul(index + 1, 0x9e3779b1) >>> 0) / 0x100000000) * 60;
}

export function honeycombRows(rows: number, columns: number, artEvery: number, prefix: string): HoneycombCell[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const index = row * columns + column;
      const art = artEvery > 0 && (index * 7 + 3) % artEvery === 0 ? ART[(index * 5) % ART.length] : undefined;
      const tile: HoneycombTile = art ? { kind: "art", ...art } : { kind: "agent", seed: `${prefix}-${index}` };
      return { index, tile };
    }),
  );
}

export function AgentHoneycomb(props: { rows: HoneycombCell[][]; stillUnder: () => HTMLElement | undefined }) {
  let comb: HTMLDivElement | undefined;
  const [near, setNear] = createSignal(false);
  const cells = new Map<number, HTMLElement>();
  const [awake, setAwake] = createSignal<ReadonlySet<number>>(new Set());
  onSettled(() => {
    const box = props.stillUnder();
    if (!comb || !box || !globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(() => {
      const still = box.getBoundingClientRect();
      const next = new Set<number>();
      for (const [index, cell] of cells) {
        const rect = cell.getBoundingClientRect();
        const outside =
          rect.right <= still.left || rect.left >= still.right || rect.bottom <= still.top || rect.top >= still.bottom;
        if (outside && scatteredPhase(index) < 20) next.add(index);
      }
      setAwake(next);
    });
    observer.observe(box);
    observer.observe(comb);
    return () => observer.disconnect();
  });
  const [scrolling, setScrolling] = createSignal(false);
  onSettled(() => {
    let timer: number | undefined;
    const scroll = () => {
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), 200);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      window.clearTimeout(timer);
    };
  });
  onSettled(() => {
    if (!comb || !globalThis.IntersectionObserver) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(comb);
    return () => observer.disconnect();
  });
  const [hovered, setHovered] = createSignal<number | null>(null);
  return (
    <div ref={comb} class="agent-honeycomb">
      <For each={props.rows}>
        {(row) => (
          <div class="agent-honeycomb-row">
            <For each={row}>
              {(cell) => (
                <span
                  ref={(element) => cells.set(cell.index, element)}
                  class="agent-honeycomb-cell"
                  data-kind={cell.tile.kind}
                  onPointerEnter={() => setHovered(cell.index)}
                  onPointerLeave={() => setHovered((index) => (index === cell.index ? null : index))}
                >
                  {cell.tile.kind === "art" ? (
                    <span
                      class="agent-honeycomb-art"
                      style={{
                        "background-image": near()
                          ? `url("${cell.tile.src}"), ${cell.tile.gradient}`
                          : cell.tile.gradient,
                      }}
                    />
                  ) : (
                    <Show when={near()}>
                      <AgentAvatar
                        seed={cell.tile.seed}
                        hue={null}
                        shape="squircle"
                        motion={awake().has(cell.index) && !scrolling() ? "always" : "hover"}
                        animationOffset={scatteredPhase(cell.index)}
                        followPointer={hovered() === cell.index}
                        class="agent-honeycomb-avatar"
                      />
                    </Show>
                  )}
                </span>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
