import type { LegendListRef } from "@legendapp/list/react-native";
import { type RefObject, useEffect } from "react";
import { Dimensions, Platform, type ScaledSize } from "react-native";

const FOLDS = Platform.OS === "ios" && !Platform.isPad;
const SETTLE_FRAMES = 12;

type Anchor = { kind: "end" } | { kind: "row"; index: number; offset: number };

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

export function useFoldScrollAnchor(listRef: RefObject<LegendListRef | null>): void {
  useEffect(() => {
    if (!FOLDS) return;
    let width = Dimensions.get("window").width;
    let frame: number | null = null;
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
