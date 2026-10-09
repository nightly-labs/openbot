import type { JSX } from "@solidjs/web";
import QRCode from "qrcode";
import { children, createEffect, createSignal, onCleanup, onSettled, Show } from "solid-js";
import { Spinner } from "./surface";
import { useText } from "./text";
import { cx } from "./utils";

export interface QrCodeProps {
  value: string;
  label?: string;
  size?: number;
  class?: string;
  /** Small logos in the center. The code then uses the highest error correction and leaves a clear
   * hole of whole modules for them, so a camera rebuilds the missing modules. Keep the mark under a
   * third of the code's width. */
  children?: JSX.Element;
}

/** The quiet zone around the code, in modules. */
const QR_MARGIN = 2;

interface MarkBox {
  width: number;
  height: number;
}

/** The smallest odd number of modules that holds `pixels` plus one clear module on each side. A
 * code is always an odd number of modules wide, so an odd hole sits exactly in the center. */
function holeModules(pixels: number, modulePixels: number): number {
  const modules = Math.ceil(pixels / modulePixels) + 2;
  return modules % 2 === 1 ? modules : modules + 1;
}

function qrSvg(value: string, size: number, mark: MarkBox | null): string {
  const code = QRCode.create(value, { errorCorrectionLevel: mark ? "H" : "M" });
  const count = code.modules.size;
  const total = count + QR_MARGIN * 2;
  const modulePixels = size / total;
  const holeWidth = mark && mark.width > 0 ? Math.min(holeModules(mark.width, modulePixels), count) : 0;
  const holeHeight = mark && mark.height > 0 ? Math.min(holeModules(mark.height, modulePixels), count) : 0;
  const holeLeft = (count - holeWidth) / 2;
  const holeTop = (count - holeHeight) / 2;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    const inHoleRow = row >= holeTop && row < holeTop + holeHeight;
    for (let column = 0; column < count; column += 1) {
      if (inHoleRow && column >= holeLeft && column < holeLeft + holeWidth) continue;
      if (code.modules.get(row, column)) path += `M${column + QR_MARGIN} ${row + QR_MARGIN}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}

export function QrCode(props: QrCodeProps): JSX.Element {
  const { t } = useText();
  const size = () => props.size ?? 196;
  const [source, setSource] = createSignal<string | null>(null);
  const [error, setError] = createSignal(false);
  const [markBox, setMarkBox] = createSignal<MarkBox | null>(null);
  const mark = children(() => props.children);
  const hasMark = () => mark.toArray().length > 0;
  let markElement: HTMLSpanElement | undefined;
  let disposed = false;

  // The hole is cut to the size of the logos, so they are measured before the code is drawn.
  onSettled(() => {
    if (markElement) setMarkBox({ width: markElement.offsetWidth, height: markElement.offsetHeight });
  });

  createEffect(
    () => ({ value: props.value, size: size(), marked: hasMark(), box: markBox() }),
    ({ value, size: requestedSize, marked, box }) => {
      if (disposed || (marked && !box)) return;
      try {
        setSource(`data:image/svg+xml,${encodeURIComponent(qrSvg(value, requestedSize, marked ? box : null))}`);
        setError(false);
      } catch {
        setSource(null);
        setError(true);
      }
    },
  );

  onCleanup(() => {
    disposed = true;
  });

  return (
    <div
      class={cx("ui-qr-code", props.class)}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="img"
      aria-label={props.label ?? t("app.qrCode.label")}
      aria-busy={!source() && !error() ? "true" : undefined}
    >
      <Show
        when={source()}
        fallback={
          <Show when={error()} fallback={<Spinner size="sm" />}>
            <span class="sr-only">{t("app.qrCode.unavailable")}</span>
          </Show>
        }
      >
        {(url) => <img src={url()} alt="" width={size()} height={size()} />}
      </Show>
      <Show when={hasMark()}>
        <span ref={markElement} class="ui-qr-code-mark" data-ready={source() ? "" : undefined} aria-hidden="true">
          {mark()}
        </span>
      </Show>
    </div>
  );
}
