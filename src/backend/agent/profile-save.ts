import { rm } from "node:fs/promises";
import type {
  AgentSummary,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
  SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { decodeSaveAgentProfileResult } from "@openbot/contracts/ipc";
import type { AgentStore } from "../agent-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";

interface ProfileSaveHooks {
  create(
    input: SaveAgentProfileInput,
    configure: (agent: AgentSummary) => Promise<AgentSummary>,
  ): Promise<AgentSummary>;
  changed(agent: AgentSummary): void;
  delete(agentId: string): Promise<void>;
}

/** Coordinates reviewed profiles with the separately persisted sidebar, and receipts for network retries. */
export class ProfileSave {
  #queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly store: AgentStore,
    private readonly hooks: ProfileSaveHooks,
  ) {}

  save(
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
  ): Promise<SaveAgentProfileResult> {
    const operation = this.#queue.then(() => this.#save(input, sidebar));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #save(
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
  ): Promise<SaveAgentProfileResult> {
    const commandId = `agent-profile:${input.operationId}`;
    const receipt = this.store.database.commandResult(commandId);
    if (receipt !== undefined) {
      const saved = decodeSaveAgentProfileResult(receipt);
      if (input.agentId && saved.agent.id !== input.agentId) throw new Error("This save belongs to another agent.");
      const agent = this.store.list().find((candidate) => candidate.id === saved.agent.id);
      if (!agent) throw new Error("The saved agent no longer exists.");
      return { agent, layout: sidebar.getSnapshot() };
    }
    const previous = input.agentId ? this.store.list().find((agent) => agent.id === input.agentId) : null;
    if (input.agentId && !previous) throw new Error("This agent no longer exists.");
    let created: AgentSummary | null = null;
    const oldAvatar = previous ? this.store.resolveAvatar(previous.id) : null;
    const result = await sidebar.withProfileAssignment(input.draft.sectionId, async (assign) => {
      let layout: SidebarLayoutSnapshot = sidebar.getSnapshot();
      try {
        const configure = async (agent: AgentSummary) => {
          layout = await assign(agent.id);
          const saved = this.store.saveReviewedProfile(agent.id, input.draft);
          return saved;
        };
        let agent: AgentSummary;
        if (previous) {
          layout = await assign(previous.id);
          agent = this.store.commitReviewedProfile(previous.id, input.draft, commandId, layout).agent;
        } else {
          agent = await this.hooks.create(input, async (candidate) => {
            created = candidate;
            return configure(candidate);
          });
          agent = this.store.commitReviewedProfile(agent.id, input.draft, commandId, layout).agent;
        }
        const result = { agent, layout };
        return result;
      } catch (error) {
        if (created && this.store.list().some((agent) => agent.id === created?.id)) await this.hooks.delete(created.id);
        throw error;
      }
    });
    if (oldAvatar) await rm(oldAvatar.path, { force: true }).catch(() => undefined);
    this.hooks.changed(result.agent);
    return result;
  }
}
