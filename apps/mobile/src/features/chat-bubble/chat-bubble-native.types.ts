export interface ChatBubbleTarget {
  serverId: string;
  agentId: string;
}

export interface ChatBubbleNative {
  isSupported(): boolean;
  areBubblesEnabled(): boolean;
  openBubbleSettings(): void;
  currentTarget(): ChatBubbleTarget | null;
  dismiss(serverId: string, agentId: string): void;
  close(): void;
  openApp(): void;
}
