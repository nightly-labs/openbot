import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";

export interface SectionDuplicateDeps {
  layout: SidebarLayoutSnapshot;
  agentIds: readonly string[];
  duplicateAgent: (agentId: string) => Promise<{ agentId: string; layout: SidebarLayoutSnapshot } | null>;
  mutateLayout: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot | null>;
}

export function duplicateSectionName(sourceName: string, existingNames: Iterable<string>): string {
  const taken = new Set([...existingNames].map((name) => name.toLocaleLowerCase()));
  const sourceBase = /^(.*?)(?: copy(?: \d+)?)$/iu.exec(sourceName)?.[1]?.trim() || sourceName.trim();
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const base = sourceBase.slice(0, Math.max(1, INPUT_LIMITS.sidebarSectionName - suffix.length)).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function sectionAgentIds(
  layout: SidebarLayoutSnapshot,
  sectionId: string,
  agentIds: readonly string[],
): string[] {
  const position = (agentId: string) => {
    const index = layout.agentOrder.indexOf(agentId);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return agentIds
    .filter((agentId) => layout.agentAssignments[agentId] === sectionId)
    .map((agentId, index) => ({ agentId, index }))
    .sort((a, b) => position(a.agentId) - position(b.agentId) || a.index - b.index)
    .map((entry) => entry.agentId);
}

export async function duplicateSection(deps: SectionDuplicateDeps, sectionId: string): Promise<string | null> {
  const source = deps.layout.sections.find((section) => section.id === sectionId);
  if (!source) throw new Error("Unknown sidebar section.");
  const copied = sectionAgentIds(deps.layout, sectionId, deps.agentIds);
  const name = duplicateSectionName(
    source.name,
    deps.layout.sections.map((section) => section.name),
  );
  const parentId = source.parentId;
  let layout = await deps.mutateLayout(
    parentId === undefined ? { type: "create", name } : { type: "create", name, parentId },
  );
  if (!layout) return null;
  const before = new Set(deps.layout.sections.map((section) => section.id));
  const added = layout.sections.filter((section) => !before.has(section.id));
  const created =
    added.find((section) => section.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ??
    (added.length === 1 ? added[0] : undefined);
  if (!created) throw new Error("The new sidebar section is missing.");
  for (const agentId of copied) {
    const copy = await deps.duplicateAgent(agentId);
    if (!copy) return null;
    layout = await deps.mutateLayout({
      type: "move-agent",
      agentId: copy.agentId,
      sectionId: created.id,
      beforeAgentId: null,
    });
    if (!layout) return null;
  }
  if (parentId !== undefined) {
    const parents = new Map(layout.sections.map((section) => [section.id, section.parentId]));
    const siblings = layout.order.filter((id) => id === sectionId || parents.get(id) === parentId);
    const sourceSibling = siblings.indexOf(sectionId);
    if (sourceSibling >= 0) {
      const next = siblings.slice(sourceSibling + 1).find((id) => id !== created.id) ?? null;
      await deps.mutateLayout({ type: "nest", sectionId: created.id, parentId, beforeSectionId: next });
    }
    return created.id;
  }
  const sourceIndex = layout.order.indexOf(sectionId);
  const from = layout.order.indexOf(created.id);
  const to = sourceIndex + 1;
  if (sourceIndex >= 0 && from > to)
    await deps.mutateLayout({ type: "move", sectionId: created.id, direction: "up", steps: from - to });
  return created.id;
}
