import { createContext, useContext } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { type Gesture, ScrollView as GestureScrollView } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";

export type ChatSwipeGesture = ReturnType<typeof Gesture.Pan>;

export const ChatSwipeGestureContext = createContext<ChatSwipeGesture | null>(null);

export const MESSAGE_TIME_WIDTH = 72;

export interface ChatTimeReveal {
  offset: SharedValue<number>;
  mount: () => void;
}

export const ChatTimeRevealContext = createContext<ChatTimeReveal | null>(null);

export const ChatTimesMountedContext = createContext(false);

export function ChatHorizontalScrollView(props: ScrollViewProps) {
  const inList = useContext(ChatTimeRevealContext) !== null;
  return inList ? <GestureScrollView {...props} horizontal /> : <ScrollView {...props} horizontal />;
}
