import type { ComputerUseHighlightPlacement } from "@openbot/contracts/ipc";
import { createSignal, onSettled, Show } from "solid-js";
import { ComputerUseAgentCursor } from "./ComputerUseAgentCursor";
import { ComputerUseWindowHighlight } from "./ComputerUseWindowHighlight";

/**
 * The whole content of the overlay window OpenBot lays over the desktop while an agent works.
 *
 * The window covers the whole desktop and stays where it is; this surface draws the rim at the
 * place main sends, so following a window the user drags costs a repaint rather than a window move
 * on every frame. The same message carries the agent cursor, which is drawn here wherever the
 * driver draws none.
 *
 * The window is transparent, click-through and never focused, so this surface holds no control and
 * invokes nothing: the placement arrives on a one-way channel. That keeps a window which floats
 * over another application free of any channel it could be driven through.
 */
export function ComputerUseHighlightSurface() {
  const [placement, setPlacement] = createSignal<ComputerUseHighlightPlacement | null>(null);
  onSettled(() => window.openbot.onComputerUseHighlightPlacement(setPlacement));
  return (
    <div class="computer-use-highlight-surface">
      <Show when={placement()}>
        {(current) => (
          <div
            class="computer-use-highlight-surface-frame"
            style={{
              left: `${current().x}px`,
              top: `${current().y}px`,
              width: `${current().width}px`,
              height: `${current().height}px`,
            }}
          >
            <ComputerUseWindowHighlight
              windowTitle={current().windowTitle}
              cornerRadius={current().cornerRadius}
              width={current().width}
              height={current().height}
              // In the rim's own pixels: main sends them on the overlay, and the rim sits at the
              // window, so the window's own corner comes off each of them.
              covered={current().covered.map((area) => ({
                ...area,
                x: area.x - current().x,
                y: area.y - current().y,
              }))}
            />
          </div>
        )}
      </Show>
      {/*
       * Outside the frame, because the cursor is placed on the overlay and not on the window: an
       * agent aims at a point the window it works in does not always hold, and a cursor cut off at
       * the edge of that window would say the action stopped there.
       */}
      <Show when={placement()?.cursor}>{(point) => <ComputerUseAgentCursor x={point().x} y={point().y} />}</Show>
    </div>
  );
}
