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

/** The width of the message times beside the chat, in points: the times are fully in at this distance. */
export const MESSAGE_TIME_WIDTH = 72;

/** The swipe on a message bubble that shows the message times. */
export interface ChatTimeReveal {
  /**
   * How far the message bubbles move away from Back, in points. The times are fully in at
   * `MESSAGE_TIME_WIDTH` and stop there; the bubbles can move on past it. Each message reads it.
   */
  offset: SharedValue<number>;
  /** Mounts the times of the messages. The swipe calls it when it starts. */
  mount: () => void;
}

export const ChatTimeRevealContext = createContext<ChatTimeReveal | null>(null);

/**
 * The times mount with the first swipe that shows them, not with each row of the chat, and then
 * stay mounted.
 */
export const ChatTimesMountedContext = createContext(false);

/**
 * A horizontal scroll view in a message, such as a wide table or formula. In the message list of a
 * chat it is a gesture handler scroll view: when it scrolls, it cancels the swipe of the chat and the
 * reply and times swipes of the bubble. Elsewhere, such as in a sheet, it stays the React Native
 * scroll view.
 */
export function ChatHorizontalScrollView(props: ScrollViewProps) {
  // The message list always gives the times swipe, also where it gives the swipe of the chat.
  const inList = useContext(ChatTimeRevealContext) !== null;
  return inList ? <GestureScrollView {...props} horizontal /> : <ScrollView {...props} horizontal />;
}
