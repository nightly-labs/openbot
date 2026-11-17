import type { SidebarLayoutSnapshot } from "@openbot/contracts/ipc";

export function serverWorkSharingScope(
  layout: SidebarLayoutSnapshot | undefined,
  sender: string,
  target: string,
): string {
  const section = layout?.agentAssignments[sender];
  return section && layout?.agentAssignments[target] === section && layout.sections.some((item) => item.id === section)
    ? `section:${section}`
    : `agent:${sender}`;
}

/** Host-created work threads use this namespace; ordinary client tasks retain their behavior. */
export function isServerWorkThread(threadId: string | null | undefined): boolean {
  return typeof threadId === "string" && /^openbot-work-[a-f0-9]{20}-[a-f0-9]{40}$/u.test(threadId);
}
