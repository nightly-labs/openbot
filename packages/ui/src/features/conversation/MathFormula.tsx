import katex from "katex";
import { createMemo, Show } from "solid-js";
import { CodeBlock } from "./CodeBlock";

// Settled messages render again as the list scrolls, so each formula is typeset once. Cap the size
// so a long session cannot grow this without bound.
const MATH_CACHE_LIMIT = 500;
const mathCache = new Map<string, string | null>();

/**
 * KaTeX HTML for `tex`, or null when KaTeX cannot parse it. `trust: false` keeps `\href`,
 * `\includegraphics` and the `\html*` commands inert, and KaTeX escapes all text it writes.
 */
function renderMath(tex: string, display: boolean): string | null {
  const key = `${display ? "d" : "i"}${tex}`;
  const cached = mathCache.get(key);
  if (cached !== undefined) return cached;
  let html: string | null;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore" });
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
  const html = createMemo(() => renderMath(props.tex, props.display));
  const source = () =>
    props.block ? <CodeBlock block={{ type: "code", code: props.tex, language: "latex" }} /> : <code>{props.raw}</code>;
  return (
    <Show when={html()} fallback={source()}>
      {(value) => <span class={props.display ? "message-math-display" : undefined} innerHTML={value()} />}
    </Show>
  );
}
