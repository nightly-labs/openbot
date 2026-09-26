import type { ChannelSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { currentText } from "@/shared/lib/text";
import type { MobileAgent } from "./workspace-types";

export type MobileSidebarItem =
  | { kind: "section"; id: string; name: string; empty: boolean }
  | { kind: "agent"; id: string; agent: MobileAgent }
  | { kind: "channel"; id: string; channel: ChannelSummary };

export function mobileSidebarItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
  collapsedSectionIds: ReadonlySet<string> = new Set(),
  t: MobileTranslate = currentText().t,
): MobileSidebarItem[] {
  const chats: MobileSidebarItem[] = [
    ...channels.map((channel) => ({ kind: "channel" as const, id: channel.id, channel })),
    ...agents.map((agent) => ({ kind: "agent" as const, id: agent.id, agent })),
  ];
  if (!layout) return chats;
  const positions = new Map(layout.agentOrder.map((id, index) => [id, index]));
  chats.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  const groups = new Map<string, MobileSidebarItem[]>();
  for (const chat of chats) {
    const assigned = layout.agentAssignments[chat.id];
    const sectionId = assigned && names.has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(sectionId) ?? [];
    group.push(chat);
    groups.set(sectionId, group);
  }
  return layout.order.flatMap((id) => {
    const group = groups.get(id) ?? [];
    const name = names.get(id) ?? (id === SIDEBAR_UNASSIGNED_SECTION_ID ? t("mobile.workspace.section.agents") : null);
    if (!name || (id === SIDEBAR_UNASSIGNED_SECTION_ID && group.length === 0)) return [];
    return [
      { kind: "section" as const, id, name, empty: group.length === 0 },
      ...(collapsedSectionIds.has(id) ? [] : group),
    ];
  });
}
