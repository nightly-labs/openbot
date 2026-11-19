export interface NotificationPreference {
  desktopNotifications: boolean;
  messagePreview: boolean;
}

export interface NotificationOpenedEvent {
  serverId: string;
  agentId: string;
  threadId: string | null;
  channelId?: string;
}

export interface WorkflowNotificationOpenedEvent {
  serverId: string;
  workflowId: string;
}
