/**
 * The sections at the top of the list in the order the layout gives, plus the draft folder a create
 * is editing there. A folder draws the folders in it itself. The draft sits after the list rather
 * than inside it because it has no id yet, so nothing in the layout order can place it.
 */

import { SIDEBAR_PEOPLE_SECTION_ID } from "@openbot/contracts/ipc";
import { For } from "solid-js";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarPeopleSection } from "./SidebarPeopleSection";
import { SidebarSectionDraft } from "./SidebarSectionEditor";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSectionList() {
  const { sectionChildren } = useSidebarScope();
  return (
    <>
      <For each={sectionChildren(null)}>
        {(sectionId) =>
          sectionId === SIDEBAR_PEOPLE_SECTION_ID ? (
            <SidebarPeopleSection sectionId={sectionId} />
          ) : (
            <SidebarAgentSection sectionId={sectionId} depth={0} />
          )
        }
      </For>
      <SidebarSectionDraft parentId={null} />
    </>
  );
}
