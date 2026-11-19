import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { HomeBackdropBand, useChatBackdropBase } from "@/features/chat/components/chat-backdrop-layer";

export const HOME_CARD_RADIUS = 28;

export function useHomeCard(): boolean {
  return useChatBackdropBase() !== null;
}

export function HomeCardBackdrop({
  height,
  top,
  edge,
  scrolled,
  background,
  active,
}: {
  height: number;
  top: number;
  edge: SharedValue<number>;
  scrolled: SharedValue<number>;
  background: string;
  active: boolean;
}) {
  const sceneStyle = useAnimatedStyle(() => {
    const pull = Math.max(0, -scrolled.get());
    return { transform: [{ scale: height > 0 ? (height + pull) / height : 1 }] };
  });
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
      <Animated.View style={[styles.card, { height, backgroundColor: background }, cardStyle]} />
    </View>
  );
}

interface CardFill {
  card: boolean;
  background: string;
  serverId: string;
  cardServer: SharedValue<string>;
  settled: boolean;
}

function useCardFill({ background, serverId, cardServer, settled }: CardFill) {
  return useAnimatedStyle(
    () => ({
      backgroundColor: settled || cardServer.get() === serverId ? background : "transparent",
    }),
    [background, serverId, settled],
  );
}

export function HomeCardTop(props: CardFill) {
  const fill = useCardFill(props);
  if (!props.card) return null;
  return <Animated.View pointerEvents="none" style={[styles.top, fill]} />;
}

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
