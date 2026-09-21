/**
 * Telling the team server whether the user is composing. Its own module because two owners with
 * different lifetimes need it and neither can import the other: the server-scoped conversation
 * domain, and the controller in `app-providers.tsx`. It caches nothing - one fire-and-forget IPC.
 */
export function notifyTeamTyping(agentId: string, typing: boolean): void {
  void window.openbot.servers.setTyping({ agentId: typing ? agentId : null, typing }).catch(() => {
    // Typing state is optional and must not interrupt message composition.
  });
}
