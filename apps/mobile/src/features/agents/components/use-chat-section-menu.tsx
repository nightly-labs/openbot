import { SIDEBAR_UNASSIGNED_SECTION_ID, sidebarFolderParents, sidebarFolderPath } from "@openbot/contracts/ipc";
import { Link, router } from "expo-router";
import { useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

export function useChatSectionMenu(serverId: string, chatId: string) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const layout = useMobileWorkspaceSelector(({ sidebarByServer }) => sidebarByServer[serverId]?.layout);
  const online = useMobileWorkspaceSelector(({ servers }) =>
    servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const disabled = saving || !online;
  const names = new Map<string, string>();
  if (layout) {
    const parents = sidebarFolderParents(layout);
    for (const section of layout.sections)
      names.set(section.id, sidebarFolderPath(layout, parents, section.id).join(" / "));
  }
  const sections = (layout?.order ?? []).flatMap((id) => {
    const name = id === SIDEBAR_UNASSIGNED_SECTION_ID ? t("mobile.agent.section.unassigned") : names.get(id);
    return name ? [{ id, name }] : [];
  });
  const assigned = layout?.agentAssignments[chatId] ?? SIDEBAR_UNASSIGNED_SECTION_ID;
  async function assign(sectionId: string) {
    if (disabled || pending.current || !sections.some((section) => section.id === sectionId)) return;
    pending.current = true;
    setSaving(true);
    try {
      await workspace().mutateSidebarLayout(serverId, {
        type: "assign",
        agentId: chatId,
        sectionId: sectionId === SIDEBAR_UNASSIGNED_SECTION_ID ? null : sectionId,
      });
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "turn",
        text.t("mobile.agent.section.moveFailed"),
        text.errorMessage(error, text.t("mobile.agent.section.tryAgain")),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const androidActions: MenuAction[] = layout
    ? [
        {
          id: "sections",
          title: t("mobile.agent.section.moveTo"),
          image: "folder",
          attributes: { disabled },
          subactions: [
            ...sections.map((section) => ({
              id: `section:${section.id}`,
              title: section.name,
              state: assigned === section.id ? ("on" as const) : ("off" as const),
              attributes: { disabled: disabled || assigned === section.id },
            })),
            { id: "section-new", title: t("mobile.agent.section.newFolder"), attributes: { disabled } },
          ],
        },
      ]
    : [];
  // As on the desktop, a new folder from this menu takes the chat.
  const createFolder = () => {
    if (!disabled) router.push({ pathname: "/section-form", params: { serverId, agentId: chatId } });
  };
  return {
    androidActions,
    onAction: (id: string) => {
      if (id.startsWith("section:")) void assign(id.slice("section:".length));
      if (id === "section-new") createFolder();
    },
    menu: layout ? (
      <Link.Menu icon="folder" title={t("mobile.agent.section.moveTo")}>
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
        <Link.MenuAction icon="folder.badge.plus" disabled={disabled} onPress={createFolder}>
          {t("mobile.agent.section.newFolder")}
        </Link.MenuAction>
      </Link.Menu>
    ) : null,
  };
}
