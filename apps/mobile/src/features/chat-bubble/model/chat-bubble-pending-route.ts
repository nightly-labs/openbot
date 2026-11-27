import type { router } from "expo-router";

export type ChatBubbleRouteMethod = "push" | "replace" | "navigate";

export type ChatBubbleRouteArgs = Parameters<typeof router.push>;

export interface ChatBubblePendingRoute {
  method: ChatBubbleRouteMethod;
  args: ChatBubbleRouteArgs;
}

let pending: ChatBubblePendingRoute | null = null;

export function setChatBubblePendingRoute(route: ChatBubblePendingRoute): void {
  pending = route;
}

export function consumeChatBubblePendingRoute(): ChatBubblePendingRoute | null {
  const route = pending;
  pending = null;
  return route;
}
