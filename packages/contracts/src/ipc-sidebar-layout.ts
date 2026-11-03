import { isDynamicRecord, isNumber, isString } from "./runtime-values";

export const SIDEBAR_PEOPLE_SECTION_ID = "people";
export const SIDEBAR_UNASSIGNED_SECTION_ID = "unassigned";

export interface SidebarSection {
  id: string;
  name: string;
  /**
   * The folder that holds this one. Absent: the folder is at the top of the list. A parent that is
   * unknown, that makes a loop or that is too deep counts as absent (`sidebarFolderParents`), because
   * an older version that edited the file keeps the field but does not maintain it.
   */
  parentId?: string;
}

/** A folder can hold folders, and those can hold folders: three levels in all. */
export const SIDEBAR_FOLDER_LEVELS = 3;

export interface SidebarLayoutSnapshot {
  revision: number;
  sections: SidebarSection[];
  order: string[];
  agentAssignments: Record<string, string>;
  agentOrder: string[];
}

/**
 * True when `order` names the people section, the unassigned section and each of `sectionIds` exactly
 * once, and nothing else.
 *
 * The renderer draws the sidebar by walking `order` and looking each section up, so a section that
 * `order` leaves out is not drawn -- and every agent assigned to it is off the screen while its
 * roster row, its thread and every message in it are untouched. That reads to the user as history
 * that disappeared. `order` is therefore not a hint about arrangement that a consumer may complete;
 * it is the whole section set in the user's chosen sequence, and a layout that does not carry all of
 * it is invalid rather than partial.
 *
 * Exported because two places hold the same invariant and must agree: this module decodes a layout a
 * remote host sends, and `SidebarLayoutStore` validates the JSON file it wrote itself. One of them
 * checking is not enough -- an agent hidden by a layout from either source looks the same.
 */
export function isCompleteSectionOrder(order: readonly unknown[], sectionIds: Iterable<string>): boolean {
  const expected = new Set([SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID, ...sectionIds]);
  return (
    order.length === expected.size &&
    order.every((sectionId) => isString(sectionId) && expected.has(sectionId)) &&
    new Set(order).size === order.length
  );
}

export function isSidebarLayoutSnapshot(value: unknown): value is SidebarLayoutSnapshot {
  if (!isDynamicRecord(value) || !isNumber(value.revision) || !Number.isInteger(value.revision) || value.revision < 0) {
    return false;
  }
  if (
    !Array.isArray(value.sections) ||
    !Array.isArray(value.order) ||
    !isDynamicRecord(value.agentAssignments) ||
    !Array.isArray(value.agentOrder)
  ) {
    return false;
  }
  const sectionIds = new Set<string>();
  for (const section of value.sections) {
    if (!isDynamicRecord(section) || !isString(section.id) || !isString(section.name)) return false;
    if (section.parentId !== undefined && !isString(section.parentId)) return false;
    if (sectionIds.has(section.id)) return false;
    sectionIds.add(section.id);
  }
  return (
    isCompleteSectionOrder(value.order, sectionIds) &&
    Object.values(value.agentAssignments).every(isString) &&
    value.agentOrder.every(isString) &&
    new Set(value.agentOrder).size === value.agentOrder.length
  );
}

export type SidebarLayoutAction =
  /** `parentId` needs `sidebar-folders-v1` on a remote host. */
  | { type: "create"; name: string; agentId?: string; parentId?: string }
  | { type: "rename"; sectionId: string; name: string }
  | { type: "delete"; sectionId: string }
  | { type: "move"; sectionId: string; direction: "up" | "down"; steps?: number }
  | { type: "assign"; agentId: string; sectionId: string | null }
  | { type: "move-agent"; agentId: string; sectionId: string | null; beforeAgentId: string | null }
  /**
   * Puts a folder, with the folders in it, in `parentId` (null: the top of the list), before the
   * sibling `beforeSectionId` (null: after the last one). At the top, the people and unassigned
   * sections are siblings too. Needs `sidebar-folders-v1` on a remote host.
   */
  | { type: "nest"; sectionId: string; parentId: string | null; beforeSectionId: string | null };

/**
 * The parent of each folder that has one. A parent that is unknown, is the folder itself or makes a
 * loop is dropped; the first link in `order` wins a loop. A folder deeper than
 * `SIDEBAR_FOLDER_LEVELS` moves up to the deepest level, in the same top folder.
 */
export function sidebarFolderParents(layout: Pick<SidebarLayoutSnapshot, "sections" | "order">): Map<string, string> {
  const known = new Map(layout.sections.map((section) => [section.id, section]));
  const rank = new Map(layout.order.map((sectionId, index) => [sectionId, index]));
  const ordered = [...layout.sections].sort(
    (left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const parents = new Map<string, string>();
  for (const section of ordered) {
    const parentId = section.parentId;
    if (parentId === undefined || parentId === section.id || !known.has(parentId)) continue;
    let ancestor: string | undefined = parentId;
    while (ancestor !== undefined && ancestor !== section.id) ancestor = parents.get(ancestor);
    if (ancestor === undefined) parents.set(section.id, parentId);
  }
  for (const sectionId of sidebarFolderTreeOrder(layout.order, parents)) {
    const chain = sidebarFolderAncestors(parents, sectionId);
    if (chain.length >= SIDEBAR_FOLDER_LEVELS) {
      const parentId = chain[SIDEBAR_FOLDER_LEVELS - 2];
      if (parentId !== undefined) parents.set(sectionId, parentId);
    }
  }
  return parents;
}

/** The ancestors of a folder, from the top folder down to its parent. */
export function sidebarFolderAncestors(parents: ReadonlyMap<string, string>, sectionId: string): string[] {
  const chain: string[] = [];
  for (let parentId = parents.get(sectionId); parentId !== undefined; parentId = parents.get(parentId)) {
    if (chain.includes(parentId)) break;
    chain.unshift(parentId);
  }
  return chain;
}

/** How many levels of folders a folder holds under it: 0 for a folder with no folders in it. */
export function sidebarFolderHeight(parents: ReadonlyMap<string, string>, sectionId: string): number {
  let height = 0;
  for (const [childId, parentId] of parents) {
    if (parentId === sectionId) height = Math.max(height, 1 + sidebarFolderHeight(parents, childId));
  }
  return height;
}

/**
 * `order` with each folder directly after its parent and the folders before it in that parent:
 * a parent first, then its folders in the order `order` gives them. Old clients read the order as a
 * flat list, so they show a folder under its parent.
 */
export function sidebarFolderTreeOrder(order: readonly string[], parents: ReadonlyMap<string, string>): string[] {
  const present = new Set(order);
  const children = new Map<string | null, string[]>();
  for (const sectionId of order) {
    const parentId = parents.get(sectionId);
    const key = parentId !== undefined && present.has(parentId) ? parentId : null;
    children.set(key, [...(children.get(key) ?? []), sectionId]);
  }
  const result: string[] = [];
  const visit = (sectionId: string) => {
    if (result.includes(sectionId)) return;
    result.push(sectionId);
    for (const childId of children.get(sectionId) ?? []) visit(childId);
  };
  for (const sectionId of children.get(null) ?? []) visit(sectionId);
  for (const sectionId of order) visit(sectionId);
  return result;
}

/** The names from the top folder down to `sectionId`, such as `["Acme", "Engineering"]`. */
export function sidebarFolderPath(
  layout: Pick<SidebarLayoutSnapshot, "sections">,
  parents: ReadonlyMap<string, string>,
  sectionId: string,
): string[] {
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  return [...sidebarFolderAncestors(parents, sectionId), sectionId].flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [name];
  });
}
