import { router } from "expo-router";
import { createContext, type PropsWithChildren, useContext } from "react";

export type ChatNavigation = typeof router;

const defaultNavigation: ChatNavigation = {
  back: (...args) => router.back(...args),
  canGoBack: () => router.canGoBack(),
  push: (...args) => router.push(...args),
  navigate: (...args) => router.navigate(...args),
  replace: (...args) => router.replace(...args),
  dismiss: (...args) => router.dismiss(...args),
  dismissTo: (...args) => router.dismissTo(...args),
  dismissAll: (...args) => router.dismissAll(...args),
  canDismiss: () => router.canDismiss(),
  setParams: (params) => router.setParams(params),
  reload: () => router.reload(),
  prefetch: (...args) => router.prefetch(...args),
  setTransitionMode: (...args) => router.setTransitionMode(...args),
};

const ChatNavigationContext = createContext<ChatNavigation>(defaultNavigation);

export function ChatNavigationProvider({ value, children }: PropsWithChildren<{ value: ChatNavigation }>) {
  return <ChatNavigationContext value={value}>{children}</ChatNavigationContext>;
}

export function useChatNavigation(): ChatNavigation {
  return useContext(ChatNavigationContext);
}
