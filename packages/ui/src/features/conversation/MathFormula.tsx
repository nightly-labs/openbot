import type katex from "katex";
import { createMemo, createSignal, Show } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { CodeBlock } from "./CodeBlock";

const MATH_CACHE_LIMIT = 500;
const mathCache = new Map<string, string | null>();

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
    <Show when={html() !== undefined} fallback={props.raw}>
      <Show when={html()} fallback={source()}>
        {(value) => (
          <Show
            when={props.block}
            fallback={<span class={props.display ? "message-math-display" : undefined} dir="ltr" innerHTML={value()} />}
          >
            <ScrollEdges axis="x" viewClass="message-math-display" dir="ltr">
              <span innerHTML={value()} />
            </ScrollEdges>
          </Show>
        )}
      </Show>
    </Show>
  );
}
