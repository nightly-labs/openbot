import type { NotificationSound } from "./notification-relay";

export interface LiveActivityRelayPush {
  token: string;
  environment: "production" | "development";
  event: "update" | "end";
  sealed: string | null;
  timestamp: number;
  staleAt: number | null;
  priority: 5 | 10;
  alert: { sound: NotificationSound | null } | null;
}

export const LIVE_ACTIVITY_SEALED_LIMIT = 3_600;
export const LIVE_ACTIVITY_TOKEN_PATTERN = /^(?:[0-9a-f]{2}){8,256}$/u;
