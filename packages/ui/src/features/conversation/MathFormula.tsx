import type katex from "katex";
import { createMemo, createSignal, Show } from "solid-js";
import { CodeBlock } from "./CodeBlock";

// Settled messages render again as the list scrolls, so each formula is typeset once. Cap the size
// so a long session cannot grow this without bound.
const MATH_CACHE_LIMIT = 500;
const mathCache = new Map<string, string | null>();

// KaTeX is its own chunk: most conversations have no formula. The first formula loads it, and a
// failed load is tried again by the next formula that renders.
const [loadedKatex, setLoadedKatex] = createSignal<typeof katex>();
let katexLoading = false;
function loadKatex(): void {
  if (katexLoading) return;
  katexLoading = true;
  import("katex").then(
    (module) => setLoadedKatex(() => module.default),
    () => {
      katexLoading = false;
    },
  );
}

/**
 * KaTeX HTML for `tex`, or null when KaTeX cannot parse it. `trust: false` keeps `\href`,
 * `\includegraphics` and the `\html*` commands inert, and KaTeX escapes all text it writes.
 */
function renderMath(engine: typeof katex, tex: string, display: boolean): string | null {
  const key = `${display ? "d" : "i"}${tex}`;
  const cached = mathCache.get(key);
  if (cached !== undefined) return cached;
  let html: string | null;
  try {
    html = engine.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore" });
  } catch {
    html = null;
  }
  if (mathCache.size >= MATH_CACHE_LIMIT) {
    const oldest = mathCache.keys().next();
    if (!oldest.done) mathCache.delete(oldest.value);
  }
  mathCache.set(key, html);
  return html;
}

/**
 * A LaTeX formula typeset with KaTeX. A formula that does not parse shows its source: as a code
 * block when the formula is a block of its own, and as inline code inside a line of text.
 */
export function MathFormula(props: { tex: string; raw: string; display: boolean; block?: boolean }) {
  const html = createMemo(() => {
    const engine = loadedKatex();
    if (!engine) {
      loadKatex();
      return undefined;
    }
    return renderMath(engine, props.tex, props.display);
  });
  const source = () =>
    props.block ? (
      <CodeBlock block={{ type: "code", code: props.tex, language: "latex" }} />
    ) : (
      <code dir="ltr">{props.raw}</code>
    );
  return (
    // While KaTeX loads, the formula shows its source text.
    <Show when={html() !== undefined} fallback={props.raw}>
      <Show when={html()} fallback={source()}>
        {(value) => (
          // A formula reads left to right in every paragraph, and its own direction isolates it.
          <span class={props.display ? "message-math-display" : undefined} dir="ltr" innerHTML={value()} />
        )}
      </Show>
    </Show>
  );
}
