import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { HomeBackdropBand, useChatBackdropBase } from "@/features/chat/components/chat-backdrop-layer";

/** The corner radius of the list card. */
export const HOME_CARD_RADIUS = 28;

/**
 * Whether Home shows its list as a card over the backdrop. With no backdrop, the header and the list
 * have the same color, so Home keeps its plain list.
 */
export function useHomeCard(): boolean {
  return useChatBackdropBase() !== null;
}

/**
 * The backdrop under the Home list, with the top of the card on it. The card top is drawn here, at
 * `top + edge`, so that it keeps its round corners while a new list mounts and moves smoothly when the
 * header changes height. A pull past the top moves the card top down with the list and stretches the
 * scene from the top, so the title and the pinned agents stay on the scene.
 *
 * Keep the card top and the pull stretch here. Do not give the band a fixed height again, and do not
 * make the list header the only part that draws the card top. With a fixed band, a pull moves the
 * title and the pinned agents off the scene onto the card. With the card top only in the list, a
 * change of server shows a straight band edge while the new list mounts, and the edge jumps to the
 * new height.
 */
export function HomeCardBackdrop({
  height,
  top,
  edge,
  scrolled,
  background,
  active,
}: {
  /** The height of the band at rest. */
  height: number;
  /** Where the list header starts: under the bar. */
  top: number;
  /** The top of the card, from the top of the list header. */
  edge: SharedValue<number>;
  /** The scroll distance of the list from its rest place. A pull past the top makes it negative. */
  scrolled: SharedValue<number>;
  background: string;
  active: boolean;
}) {
  const sceneStyle = useAnimatedStyle(() => {
    const pull = Math.max(0, -scrolled.get());
    return { transform: [{ scale: height > 0 ? (height + pull) / height : 1 }] };
  });
  // Until the list header has a height, the band shows only the scene, under the bar.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: edge.get() < 0 ? 0 : 1,
    transform: [{ translateY: top + Math.max(0, edge.get()) + Math.max(0, -scrolled.get()) }],
  }));
  if (height <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.band, { height }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scene, sceneStyle]}>
        <HomeBackdropBand height={height} active={active} />
      </Animated.View>
      {/* It reaches the bottom of the band also while the card top moves up to a shorter header. */}
      <Animated.View style={[styles.card, { height, backgroundColor: background }, cardStyle]} />
    </View>
  );
}

interface CardFill {
  card: boolean;
  background: string;
  /** The server of the list. */
  serverId: string;
  /** The server whose card is in place. Until it is `serverId`, the part is clear. */
  cardServer: SharedValue<string>;
  /**
   * The list reveal has ended, after the card top is in place. The part then takes a plain opaque
   * style: a later render cannot put back the clear first-render value of the animated style.
   */
  settled: boolean;
}

function useCardFill({ background, serverId, cardServer, settled }: CardFill) {
  const fill = useAnimatedStyle(() => ({
    backgroundColor: cardServer.get() === serverId ? background : "transparent",
  }));
  return settled ? { backgroundColor: background } : fill;
}

/**
 * The rounded top edge of the list card. It is the last part of the list header, under the pinned
 * agents. It is clear while the backdrop draws the card top for a new list.
 */
export function HomeCardTop(props: CardFill) {
  const fill = useCardFill(props);
  if (!props.card) return null;
  return <Animated.View pointerEvents="none" style={[styles.top, fill]} />;
}

/** One row of the list card: an opaque row, so the fixed backdrop under the clear list does not show through it. */
export function HomeCardRow({ children, ...props }: PropsWithChildren<CardFill>) {
  const fill = useCardFill(props);
  if (!props.card) return children;
  return <Animated.View style={fill}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, right: 0, top: 0 },
  scene: { transformOrigin: "top" },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderTopLeftRadius: HOME_CARD_RADIUS,
    borderTopRightRadius: HOME_CARD_RADIUS,
    borderCurve: "continuous",
  },
  top: {
    height: HOME_CARD_RADIUS,
    marginTop: 8,
    borderTopLeftRadius: HOME_CARD_RADIUS,
    borderTopRightRadius: HOME_CARD_RADIUS,
    borderCurve: "continuous",
  },
});
