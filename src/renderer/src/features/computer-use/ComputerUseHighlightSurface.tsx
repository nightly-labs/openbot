import type { ComputerUseHighlightPlacement } from "@openbot/contracts/ipc";
import { createSignal, onSettled, Show } from "solid-js";
import { ComputerUseAgentCursor } from "./ComputerUseAgentCursor";
import { ComputerUseWindowHighlight } from "./ComputerUseWindowHighlight";
import { computerUsePort } from "./computer-use-port";

export function ComputerUseHighlightSurface() {
  const [placement, setPlacement] = createSignal<ComputerUseHighlightPlacement | null>(null);
  onSettled(() => computerUsePort().computerUse.onHighlightPlacement(setPlacement));
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
              covered={current().covered.map((area) => ({
                ...area,
                x: area.x - current().x,
                y: area.y - current().y,
              }))}
            />
          </div>
        )}
      </Show>
      <Show when={placement()?.cursor}>{(point) => <ComputerUseAgentCursor x={point().x} y={point().y} />}</Show>
    </div>
  );
}
