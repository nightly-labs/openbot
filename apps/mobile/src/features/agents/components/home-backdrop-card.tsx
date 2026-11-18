import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { useChatBackdropBase } from "@/features/chat/components/chat-backdrop-layer";

/** The corner radius of the list card. */
export const HOME_CARD_RADIUS = 28;

/**
 * Whether Home shows its list as a card over the backdrop. With no backdrop, the header and the list
 * have the same color, so Home keeps its plain list.
 */
export function useHomeCard(): boolean {
  return useChatBackdropBase() !== null;
}

/** The rounded top edge of the list card. It is the last part of the list header, under the pinned agents. */
export function HomeCardTop({ card, background }: { card: boolean; background: string }) {
  if (!card) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        height: HOME_CARD_RADIUS,
        marginTop: 8,
        backgroundColor: background,
        borderTopLeftRadius: HOME_CARD_RADIUS,
        borderTopRightRadius: HOME_CARD_RADIUS,
        borderCurve: "continuous",
      }}
    />
  );
}

/** One row of the list card: an opaque row, so the fixed backdrop under the clear list does not show through it. */
export function HomeCardRow({ card, background, children }: PropsWithChildren<{ card: boolean; background: string }>) {
  if (!card) return children;
  return <View style={{ backgroundColor: background }}>{children}</View>;
}
