/** The agent that gets the messages of the Send Message shortcut. */
export interface ShortcutTarget {
  serverId: string;
  agentId: string;
}

/** Where a button of a shortcut card opens the app. */
export type ShortcutOpenTarget =
  | {
      screen: "chat";
      agentId: string;
      /** A message that the shortcut could not send. It goes to the composer of the chat. */
      draft: { serverId: string; text: string } | null;
    }
  | { screen: "settings" }
  | { screen: "home" };
