import { createContext, useContext } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { type Gesture, ScrollView as GestureScrollView } from "react-native-gesture-handler";

export type ChatSwipeGesture = ReturnType<typeof Gesture.Pan>;

/**
 * The swipe away from Back over the messages of an agent's chat. A message bubble that replies with a
 * swipe in the same direction blocks it, so a swipe on the bubble replies and a swipe beside it opens.
 */
export const ChatSwipeGestureContext = createContext<ChatSwipeGesture | null>(null);

/**
 * A horizontal scroll view in a message, such as a wide table or formula. In an agent's chat it is a
 * gesture handler scroll view: when it scrolls, it cancels the swipe of the chat and the reply swipe
 * of the bubble. Elsewhere, such as in a sheet, it stays the React Native scroll view.
 */
export function ChatHorizontalScrollView(props: ScrollViewProps) {
  const swipe = useContext(ChatSwipeGestureContext);
  return swipe ? <GestureScrollView {...props} horizontal /> : <ScrollView {...props} horizontal />;
}
