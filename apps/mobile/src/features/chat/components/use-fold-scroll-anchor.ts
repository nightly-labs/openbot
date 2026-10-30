import type { LegendListRef } from "@legendapp/list/react-native";
import { type RefObject, useEffect } from "react";
import { Dimensions, Platform, type ScaledSize } from "react-native";

/**
 * An iPhone window changes width only when iPhone Duo folds or unfolds: other iPhones keep the app in
 * portrait. iPad and Android keep the list as it is.
 */
const FOLDS = Platform.OS === "ios" && !Platform.isPad;
/** The frames over which the rows measure again at the new width, and the list keeps its place. */
const SETTLE_FRAMES = 12;

type Anchor = { kind: "end" } | { kind: "row"; index: number; offset: number };

/** The message at the top of the screen and its distance from the top, or the end of the chat. */
function anchorOf(list: LegendListRef): Anchor | null {
  const state = list.getState();
  if (state.data.length === 0) return null;
  if (state.isAtEnd) return { kind: "end" };
  for (let index = Math.max(0, state.start); index <= state.end && index < state.data.length; index += 1) {
    const position = state.positionAtIndex(index);
    if (position + state.sizeAtIndex(index) > state.scroll) {
      return { kind: "row", index, offset: position - state.scroll };
    }
  }
  return null;
}

/**
 * Keeps the chat at the same message when iPhone Duo folds or unfolds. The new width wraps every row
 * again, and the list would otherwise move to another message. The message at the top keeps its
 * place, and a chat at its latest message stays there.
 */
export function useFoldScrollAnchor(listRef: RefObject<LegendListRef | null>): void {
  useEffect(() => {
    if (!FOLDS) return;
    let width = Dimensions.get("window").width;
    let frame: number | null = null;
    // The event comes before the rows have their new sizes, so the list still has the old place.
    const subscription = Dimensions.addEventListener("change", ({ window }: { window: ScaledSize }) => {
      if (window.width === width) return;
      width = window.width;
      const list = listRef.current;
      const anchor = list ? anchorOf(list) : null;
      if (!list || !anchor) return;
      if (frame !== null) cancelAnimationFrame(frame);
      let frames = 0;
      const keep = () => {
        if (anchor.kind === "end") void list.scrollToEnd({ animated: false });
        else void list.scrollToIndex({ index: anchor.index, viewOffset: anchor.offset, animated: false });
        frames += 1;
        frame = frames < SETTLE_FRAMES ? requestAnimationFrame(keep) : null;
      };
      frame = requestAnimationFrame(keep);
    });
    return () => {
      subscription.remove();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [listRef]);
}
