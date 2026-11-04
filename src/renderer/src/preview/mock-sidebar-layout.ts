import {
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  type SidebarSection,
  sidebarFolderParents,
  sidebarFolderTreeOrder,
} from "@openbot/contracts/ipc";

/** As the store does: each action, then the folders back in tree order. */
export function applySidebarLayoutAction(
  layout: SidebarLayoutSnapshot,
  action: SidebarLayoutAction,
): SidebarLayoutSnapshot {
  const next = applyFlatAction(layout, action);
  const parents = sidebarFolderParents(next);
  return {
    ...next,
    sections: next.sections.map(({ id, name }) => withParent({ id, name }, parents.get(id))),
    order: sidebarFolderTreeOrder(next.order, parents),
  };
}

function withParent(section: SidebarSection, parentId: string | undefined): SidebarSection {
  return parentId === undefined ? { id: section.id, name: section.name } : { ...section, parentId };
}

function applyFlatAction(layout: SidebarLayoutSnapshot, action: SidebarLayoutAction): SidebarLayoutSnapshot {
  const revision = layout.revision + 1;
  if (action.type === "create") {
    const id = crypto.randomUUID();
    return {
      ...layout,
      revision,
      sections: [...layout.sections, withParent({ id, name: action.name.trim() }, action.parentId)],
      order: [...layout.order, id],
      agentAssignments: action.agentId
        ? { ...layout.agentAssignments, [action.agentId]: id }
        : { ...layout.agentAssignments },
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "rename") {
    return {
      ...layout,
      revision,
      sections: layout.sections.map((section) =>
        section.id === action.sectionId ? { ...section, name: action.name.trim() } : section,
      ),
    };
  }
  if (action.type === "delete") {
    const parentId = sidebarFolderParents(layout).get(action.sectionId);
    return {
      ...layout,
      revision,
      sections: layout.sections
        .filter((section) => section.id !== action.sectionId)
        .map((section) => (section.parentId === action.sectionId ? withParent(section, parentId) : section)),
      order: layout.order.filter((sectionId) => sectionId !== action.sectionId),
      agentAssignments: Object.fromEntries(
        Object.entries(layout.agentAssignments).flatMap(([agentId, sectionId]) => {
          if (sectionId !== action.sectionId) return [[agentId, sectionId]];
          return parentId === undefined ? [] : [[agentId, parentId]];
        }),
      ),
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "nest") {
    const order = layout.order.filter((sectionId) => sectionId !== action.sectionId);
    const insertionIndex = action.beforeSectionId === null ? order.length : order.indexOf(action.beforeSectionId);
    order.splice(insertionIndex < 0 ? order.length : insertionIndex, 0, action.sectionId);
    return {
      ...layout,
      revision,
      sections: layout.sections.map((section) =>
        section.id === action.sectionId ? withParent(section, action.parentId ?? undefined) : section,
      ),
      order,
    };
  }
  if (action.type === "move") {
    const order = [...layout.order];
    const index = order.indexOf(action.sectionId);
    const target = index + (action.direction === "up" ? -1 : 1) * (action.steps ?? 1);
    if (index >= 0 && target >= 0 && target < order.length) {
      const [movedSectionId] = order.splice(index, 1);
      if (movedSectionId) order.splice(target, 0, movedSectionId);
    }
    return { ...layout, revision, order };
  }
  if (action.type === "move-agent") {
    const agentOrder = layout.agentOrder.filter((agentId) => agentId !== action.agentId);
    const insertionIndex = action.beforeAgentId === null ? agentOrder.length : agentOrder.indexOf(action.beforeAgentId);
    agentOrder.splice(insertionIndex < 0 ? agentOrder.length : insertionIndex, 0, action.agentId);
    const agentAssignments = { ...layout.agentAssignments };
    if (action.sectionId === null) delete agentAssignments[action.agentId];
    else agentAssignments[action.agentId] = action.sectionId;
    return { ...layout, revision, agentAssignments, agentOrder };
  }
  const agentAssignments = { ...layout.agentAssignments };
  if (action.sectionId === null) delete agentAssignments[action.agentId];
  else agentAssignments[action.agentId] = action.sectionId;
  return { ...layout, revision, agentAssignments };
}
