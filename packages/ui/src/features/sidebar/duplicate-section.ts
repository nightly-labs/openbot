/**
 * Duplicating a section is a chain of calls the host already answers: create the section, copy each
 * agent, move each copy in, and move the section behind the original. No host has a single action
 * for it, so the chain runs here for every consumer. Each call answers the layout it produced, and
 * the next step reads that layout rather than a signal that has not flushed yet.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";

export interface SectionDuplicateDeps {
  /** The layout when the user chose Duplicate. */
  layout: SidebarLayoutSnapshot;
  /** The agents that can be copied, in roster order: not hidden by the user, and not a channel. */
  agentIds: readonly string[];
  /** Copies one agent and answers the copy's id and the layout that holds it. `null`: the scope has ended. */
  duplicateAgent: (agentId: string) => Promise<{ agentId: string; layout: SidebarLayoutSnapshot } | null>;
  /** Applies one layout action and answers the new layout. `null`: the scope has ended. */
  mutateLayout: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot | null>;
}

/**
 * "Name copy", then "Name copy 2" and so on, unique without regard to case and within the name limit.
 * A copy of "Name copy" is "Name copy 2", not "Name copy copy", as the host names agent copies.
 */
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

/** The ids of a section's agents in the order the sidebar shows them. */
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

/**
 * Copies a section and its agents. A failed step stops the chain and throws; what was made stays in
 * the new section, because removing an agent deletes its workspace and the user can delete the copy.
 * Answers the new section's id, or `null` when the scope ended first.
 */
export async function duplicateSection(deps: SectionDuplicateDeps, sectionId: string): Promise<string | null> {
  const source = deps.layout.sections.find((section) => section.id === sectionId);
  if (!source) throw new Error("Unknown sidebar section.");
  const copied = sectionAgentIds(deps.layout, sectionId, deps.agentIds);
  const name = duplicateSectionName(
    source.name,
    deps.layout.sections.map((section) => section.name),
  );
  let layout = await deps.mutateLayout({ type: "create", name });
  if (!layout) return null;
  // The new section is the one this create added. Another client can add a section at the same time,
  // so the name picks between new sections; the host may store the name in another form.
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
  // A source that another client deleted meanwhile has no place to follow, so the copy stays last.
  const sourceIndex = layout.order.indexOf(sectionId);
  const from = layout.order.indexOf(created.id);
  const to = sourceIndex + 1;
  if (sourceIndex >= 0 && from > to)
    await deps.mutateLayout({ type: "move", sectionId: created.id, direction: "up", steps: from - to });
  return created.id;
}
