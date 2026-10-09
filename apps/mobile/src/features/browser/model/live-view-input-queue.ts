import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BrowserViewInput } from "@openbot/contracts/team-protocol/browser-view-v1";
import { clamp } from "./live-view-geometry";

/**
 * Input on its way to the peer page. A finger reports a move many times per frame of the screen,
 * so moves and scroll steps wait for the next frame and go as one: the newest move, and the sum of
 * the scroll. A press, a release or a key goes at once, after what waited before it.
 */
export function createLiveViewInputQueue(
  send: (inputs: BrowserViewInput[]) => void,
  nextFrame: (callback: () => void) => () => void,
) {
  let pending: BrowserViewInput[] = [];
  let cancel: (() => void) | null = null;

  const flush = () => {
    cancel?.();
    cancel = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    send(batch);
  };

  const wait = () => {
    cancel ??= nextFrame(() => {
      cancel = null;
      flush();
    });
  };

  return {
    push(input: BrowserViewInput) {
      const last = pending.at(-1);
      if (input.type === "pointer" && input.action === "move") {
        if (last?.type === "pointer" && last.action === "move") pending[pending.length - 1] = input;
        else pending.push(input);
        wait();
        return;
      }
      if (input.type === "pointer" && input.action === "wheel") {
        if (last?.type === "pointer" && last.action === "wheel" && last.x === input.x && last.y === input.y) {
          const limit = INPUT_LIMITS.browserCoordinate;
          pending[pending.length - 1] = {
            ...input,
            deltaX: clamp(last.deltaX + input.deltaX, -limit, limit),
            deltaY: clamp(last.deltaY + input.deltaY, -limit, limit),
          };
        } else {
          pending.push(input);
        }
        wait();
        return;
      }
      pending.push(input);
      flush();
    },
    flush,
    clear() {
      cancel?.();
      cancel = null;
      pending = [];
    },
  };
}
