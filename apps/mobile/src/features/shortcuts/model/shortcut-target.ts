export interface ShortcutTarget {
  serverId: string;
  agentId: string;
}

export type ShortcutOpenTarget =
  | {
      screen: "chat";
      agentId: string;
      draft: { serverId: string; text: string } | null;
    }
  | { screen: "settings" }
  | { screen: "home" };
