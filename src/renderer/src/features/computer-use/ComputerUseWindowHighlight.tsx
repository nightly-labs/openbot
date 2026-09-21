import type { ComputerUseCoveredArea } from "@openbot/contracts/ipc";

export interface ComputerUseWindowHighlightProps {
  /** Which application window the agent is working in, for the screen reader and the label. */
  windowTitle: string;
  /** The corner radius of the window under it, in pixels, so the hue follows the window's shape. */
  cornerRadius?: number;
  /**
   * The parts of the window that other windows cover, in the rim's own pixels, and the size of the
   * window they are cut out of. The three go together: without the size there is nothing to cut
   * from, and without the areas nothing is cut.
   */
  covered?: readonly ComputerUseCoveredArea[];
  width?: number;
  height?: number;
}

/**
 * The hue OpenBot draws over the window an agent is working in.
 *
 * The agent cursor says where a click lands; it does not say which window the next twenty actions
 * belong to. This answers that with one even rim of the accent around the whole window and a short
 * fall inward. It does not move: the agent works for minutes at a time, and anything that turns or
 * breathes for that long pulls the eye away from the work.
 *
 * What another window covers is cut away. The rim is drawn on an overlay that floats over the whole
 * desktop, because macOS keeps no window of one application between two windows of another, so a
 * rim drawn whole would lie over the window in front and read as a rim around that one instead.
 *
 * It draws nothing that can be pressed: the surface that carries it is click-through, and this
 * component holds no control of its own, so it cannot take a click away from the window under it.
 */
export function ComputerUseWindowHighlight(props: ComputerUseWindowHighlightProps) {
  return (
    <div
      class="computer-use-window-highlight"
      style={{
        "--computer-use-window-radius": `${props.cornerRadius ?? 12}px`,
        "clip-path": clipPath(props),
      }}
      // The hue is the only sign a blind user would otherwise miss, and it is not in the window's
      // own tree, so it is announced rather than hidden as decoration.
      role="status"
      aria-label={`OpenBot is working in ${props.windowTitle}`}
    />
  );
}

/**
 * The rim without the parts another window covers: the whole window, then one hole for each.
 *
 * An even-odd rule makes a hole of every subpath inside the first, which is what keeps this to one
 * path however many windows are in front. It holds only because the areas never overlap; two holes
 * over one another would cancel and fill the area back in.
 */
function clipPath(props: ComputerUseWindowHighlightProps): string | undefined {
  const covered = props.covered ?? [];
  if (covered.length === 0 || !props.width || !props.height) return undefined;
  const holes = covered.map((area) => rectangle(area.x, area.y, area.width, area.height));
  return `path(evenodd, "${[rectangle(0, 0, props.width, props.height), ...holes].join(" ")}")`;
}

function rectangle(x: number, y: number, width: number, height: number): string {
  return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
}
