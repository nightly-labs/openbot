import { createContext, useContext } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { type Gesture, ScrollView as GestureScrollView } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";

export type ChatSwipeGesture = ReturnType<typeof Gesture.Pan>;

/**
 * The swipe away from Back over the messages of an agent's chat. A swipe in the same direction on a
 * message bubble blocks it, so that swipe shows the message times and a swipe beside it opens.
 */
export const ChatSwipeGestureContext = createContext<ChatSwipeGesture | null>(null);

/** The width of the message times beside the chat, in points. The swipe moves the chat this far. */
export const MESSAGE_TIME_WIDTH = 72;

/**
 * How far the rows of the chat move away from Back to show the message times, in points: from 0 to
 * about `MESSAGE_TIME_WIDTH`. A swipe on a message bubble sets it; each row reads it.
 */
export const ChatTimeRevealContext = createContext<SharedValue<number> | null>(null);

/**
 * A horizontal scroll view in a message, such as a wide table or formula. In an agent's chat it is a
 * gesture handler scroll view: when it scrolls, it cancels the swipe of the chat and the reply swipe
 * of the bubble. Elsewhere, such as in a sheet, it stays the React Native scroll view.
 */
export function ChatHorizontalScrollView(props: ScrollViewProps) {
  const swipe = useContext(ChatSwipeGestureContext);
  return swipe ? <GestureScrollView {...props} horizontal /> : <ScrollView {...props} horizontal />;
}
