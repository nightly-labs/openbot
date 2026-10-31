import { Portal } from "@solidjs/web";
import { Show } from "solid-js";
import { ThreadTabIcon } from "./ThreadStatusMark";
import { carriedThreadTab, type ThreadTabRow } from "./thread-tab-drag";

/**
 * A copy of the tab that the pointer holds over the other row. The row that the tab comes from draws
 * it, so the copy shows once.
 */
export function ThreadTabGhost(props: { from: ThreadTabRow }) {
  const carried = () => {
    const carry = carriedThreadTab();
    return carry?.from === props.from ? carry : undefined;
  };
  const position = (x: number, y: number) => `left: ${x}px; top: ${y}px;`;
  return (
    <Show when={carried()}>
      {(carry) => (
        <Portal>
          <div class="side-panel-tab thread-tab-ghost" style={position(carry().x, carry().y)} aria-hidden="true">
            <span class="side-panel-tab-close">
              <span class="side-panel-tab-icon">
                <ThreadTabIcon status={carry().thread.status} />
              </span>
            </span>
            <span class="side-panel-tab-label">{carry().thread.title}</span>
          </div>
        </Portal>
      )}
    </Show>
  );
}
