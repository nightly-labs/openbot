import type { MenuAction } from "@expo/ui/community/menu";
import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { userErrorMessage } from "@openbot/user-errors";
import { Link } from "expo-router";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function useChatSectionMenu(serverId: string, chatId: string) {
  const { sidebarByServer, servers, mutateSidebarLayout } = useMobileWorkspace();
  const layout = sidebarByServer[serverId]?.layout;
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const disabled = saving || !servers.some((server) => server.id === serverId && server.state === "online");
  const names = new Map(layout?.sections.map((section) => [section.id, section.name]));
  const sections = (layout?.order ?? []).flatMap((id) => {
    const name = id === SIDEBAR_UNASSIGNED_SECTION_ID ? "Agents" : names.get(id);
    return name ? [{ id, name }] : [];
  });
  const assigned = layout?.agentAssignments[chatId] ?? SIDEBAR_UNASSIGNED_SECTION_ID;
  async function assign(sectionId: string) {
    if (disabled || pending.current || !sections.some((section) => section.id === sectionId)) return;
    pending.current = true;
    setSaving(true);
    try {
      await mutateSidebarLayout(serverId, {
        type: "assign",
        agentId: chatId,
        sectionId: sectionId === SIDEBAR_UNASSIGNED_SECTION_ID ? null : sectionId,
      });
    } catch (error) {
      Alert.alert("Could not move chat", userErrorMessage(error, "Please try again."));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const androidActions: MenuAction[] = layout
    ? [
        {
          id: "sections",
          title: "Move to section",
          attributes: { disabled },
          subactions: sections.map((section) => ({
            id: `section:${section.id}`,
            title: section.name,
            state: assigned === section.id ? "on" : "off",
            attributes: { disabled: disabled || assigned === section.id },
          })),
        },
      ]
    : [];
  return {
    androidActions,
    onAction: (id: string) => {
      if (id.startsWith("section:")) void assign(id.slice("section:".length));
    },
    menu: layout ? (
      <Link.Menu icon="folder" title="Move to section">
        {sections.map((section) => (
          <Link.MenuAction
            key={section.id}
            isOn={assigned === section.id}
            disabled={disabled || assigned === section.id}
            onPress={() => void assign(section.id)}
          >
            {section.name}
          </Link.MenuAction>
        ))}
      </Link.Menu>
    ) : null,
  };
}
