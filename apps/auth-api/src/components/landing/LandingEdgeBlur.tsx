import { createSignal, For, onSettled } from "solid-js";

const TOP_OFFSET = 24;
const BOTTOM_OFFSET = 140;
const FOOTER_OFFSET = 120;

const EDGE_BLUR_LAYERS = [
  { blur: 0.4, from: 0, to: 12 },
  { blur: 1, from: 10, to: 22 },
  { blur: 1.8, from: 20, to: 32 },
  { blur: 2.8, from: 30, to: 42 },
  { blur: 4, from: 40, to: 52 },
  { blur: 5.4, from: 50, to: 62 },
  { blur: 6.8, from: 60, to: 72 },
  { blur: 8.2, from: 70, to: 82 },
  { blur: 9.6, from: 80, to: 92 },
  { blur: 11.2, from: 88, to: 100 },
] as const;

function edgeBlurVisible(footer: Element | undefined): boolean {
  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
  if (scrollY <= TOP_OFFSET || maxScroll - scrollY <= BOTTOM_OFFSET) return false;
  return !footer || footer.getBoundingClientRect().top > viewportHeight - FOOTER_OFFSET;
}

export function LandingEdgeBlur(props: { footer: () => Element | undefined }) {
  const [visible, setVisible] = createSignal(false);

  onSettled(() => {
    let frameId: number | undefined;
    const measure = () => {
      frameId = undefined;
      setVisible(edgeBlurVisible(props.footer()));
    };
    const scheduleMeasure = () => {
      if (frameId === undefined) frameId = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  });

  return (
    <div class="landing-edge-blur" data-visible={visible() ? "true" : "false"} aria-hidden="true">
      <For each={EDGE_BLUR_LAYERS}>
        {(layer) => (
          <i
            class="landing-edge-blur-layer"
            style={{
              "--edge-blur": `${layer.blur}px`,
              "--edge-from": `${layer.from}%`,
              "--edge-to": `${layer.to}%`,
            }}
          />
        )}
      </For>
    </div>
  );
}
