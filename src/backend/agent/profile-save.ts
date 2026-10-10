import { rm } from "node:fs/promises";
import type {
  AgentSummary,
  ConversationMessageSender,
  SaveAgentProfileInput,
  SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import {
  agentAutomationAllowed,
  agentComputerUseEnabled,
  decodeSaveAgentProfileResult,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Schema, Semaphore } from "effect";
import type { AgentStore } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import type { SidebarLayoutStore } from "../sidebar-layout-store";

interface ProfileSaveHooks {
  create(
    input: SaveAgentProfileInput,
    configure: (agent: AgentSummary) => Effect.Effect<AgentSummary, ProfileSaveFailed>,
    sender: ConversationMessageSender | undefined,
  ): Effect.Effect<AgentSummary, ProfileSaveFailed>;
  changed(agent: AgentSummary, previous: AgentSummary | null | undefined): void;
  delete(agent: AgentSummary): Effect.Effect<void, ProfileSaveFailed>;
}

/** Coordinates reviewed profiles with the separately persisted sidebar, and receipts for network retries. */
export class ProfileSave {
  readonly #pendingAgents = new Set<string>();

  mayDrain(agentId: string): boolean {
    return !this.#pendingAgents.has(agentId);
  }

  readonly #queue = Semaphore.makeUnsafe(1);
  constructor(
    private readonly store: AgentStore,
    private readonly hooks: ProfileSaveHooks,
  ) {}

  /** `sender` is the person who writes the first message of a new agent. */
  save(
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
    sender?: ConversationMessageSender,
  ) {
    return this.#queue.withPermit(this.#save(input, sidebar, sender));
  }

  readonly #save = Effect.fn("ProfileSave.save")(function* (
    this: ProfileSave,
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
    sender: ConversationMessageSender | undefined,
  ) {
    const commandId = `agent-profile:${input.operationId}`;
    const receipt = yield* profileStep(() => this.store.database.commandResult(commandId));
    if (receipt !== undefined) {
      return yield* profileStep(() => {
        const saved = decodeSaveAgentProfileResult(receipt);
        if (input.agentId && saved.agent.id !== input.agentId)
          throw new Error(sourceText("error.agent.saveOtherAgent"));
        const agent = this.store.list().find((candidate) => candidate.id === saved.agent.id);
        if (!agent) throw new Error(sourceText("error.agent.savedGone"));
        return { agent, layout: sidebar.getSnapshot() };
      });
    }
    const previous = yield* profileStep(() => {
      const agent = input.agentId ? this.store.list().find((candidate) => candidate.id === input.agentId) : null;
      if (input.agentId && !agent) throw new Error(sourceText("error.agent.gone"));
      return agent;
    });
    const oldAvatar = previous ? this.store.resolveAvatar(previous.id) : null;
    // The sidebar owns its serialization; the callback runs the profile workflow under that lock.
    const result = yield* sidebar
      .withProfileAssignment(input.draft.sectionId, (assign) =>
        this.#assign(
          input,
          previous,
          commandId,
          sidebar.getSnapshot(),
          (agentId) => assign(agentId).pipe(toProfileSaveFailed),
          sender,
        ),
      )
      .pipe(toProfileSaveFailed);
    if (oldAvatar) yield* profileIo(() => rm(oldAvatar.path, { force: true })).pipe(Effect.ignore);
    this.hooks.changed(result.agent, previous);
    return result;
  }, Effect.uninterruptible);

  readonly #assign = Effect.fn("ProfileSave.assign")(function* (
    this: ProfileSave,
    input: SaveAgentProfileInput,
    previous: AgentSummary | null | undefined,
    commandId: string,
    initialLayout: SidebarLayoutSnapshot,
    assign: (agentId: string) => Effect.Effect<SidebarLayoutSnapshot, ProfileSaveFailed>,
    sender: ConversationMessageSender | undefined,
  ) {
    let layout = initialLayout;
    const pending: { created: AgentSummary | null } = { created: null };
    const operation = Effect.gen({ self: this }, function* () {
      let agent: AgentSummary;
      if (previous) {
        layout = yield* assign(previous.id);
        agent = yield* profileStep(
          () => this.store.commitReviewedProfile(previous.id, input.draft, commandId, layout).agent,
        );
      } else {
        agent = yield* this.hooks.create(
          input,
          (candidate) =>
            Effect.gen({ self: this }, function* () {
              pending.created = candidate;
              this.#pendingAgents.add(candidate.id);
              layout = yield* assign(candidate.id);
              return yield* profileStep(() => this.store.saveReviewedProfile(candidate.id, input.draft));
            }),
          sender,
        );
        agent = yield* profileStep(
          () => this.store.commitReviewedProfile(agent.id, input.draft, commandId, layout).agent,
        );
      }
      return { agent, layout };
    });
    const compensated = Effect.gen({ self: this }, function* () {
      const exit = yield* Effect.exit(operation);
      if (Exit.isSuccess(exit)) return exit.value;
      const created = pending.created;
      if (created && this.store.list().some((agent) => agent.id === created.id)) yield* this.hooks.delete(created);
      return yield* Effect.failCause(exit.cause);
    });
    return yield* compensated.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (pending.created) this.#pendingAgents.delete(pending.created.id);
        }),
      ),
    );
  }, Effect.uninterruptible);
}

export class ProfileSaveFailed extends Schema.TaggedError<ProfileSaveFailed>()("ProfileSaveFailed", {
  cause: Schema.Defect(),
}) {}

const { io: profileIo, sync: profileStep, rewrap: toProfileSaveFailed } = causeHelpers(ProfileSaveFailed);

export { toProfileSaveFailed };

/** Model and effort use live turn settings; these fields change standing context or access. */
export function standingProfileChanged(previous: AgentSummary | null | undefined, agent: AgentSummary): boolean {
  return (
    !previous ||
    previous.name !== agent.name ||
    previous.title !== agent.title ||
    previous.description !== agent.description ||
    previous.workspacePath !== agent.workspacePath ||
    previous.provider !== agent.provider ||
    workspaceAccessEnforced(previous) !== workspaceAccessEnforced(agent) ||
    agentComputerUseEnabled(previous) !== agentComputerUseEnabled(agent) ||
    agentAutomationAllowed(previous) !== agentAutomationAllowed(agent)
  );
}
