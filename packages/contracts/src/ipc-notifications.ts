// The desktop notification switch and the event main sends when the user clicks a notification.

export interface NotificationPreference {
  desktopNotifications: boolean;
}

// The conversation a clicked notification was about. The renderer opens it.
export interface NotificationOpenedEvent {
  serverId: string;
  agentId: string;
  threadId: string | null;
}
