// The desktop notification switches and the event main sends when the user clicks a notification.

export interface NotificationPreference {
  desktopNotifications: boolean;
  /** Show the start of the agent's reply, question or command instead of a fixed text. */
  messagePreview: boolean;
}

// The conversation a clicked notification was about. The renderer opens it.
export interface NotificationOpenedEvent {
  serverId: string;
  agentId: string;
  threadId: string | null;
  /** The channel of a channel notification. The renderer opens the channel, not the agent chat. */
  channelId?: string;
}
