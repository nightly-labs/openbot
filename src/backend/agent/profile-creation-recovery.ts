import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeSaveAgentProfileResult } from "@openbot/contracts/ipc";
import { isGeneratedAgentId, isUuidV4 } from "@openbot/contracts/validation";
import { Effect } from "effect";
import type { OpenBotDatabase } from "../openbot-database";
import { StoredStateFailure, storedIO, storedSync } from "../stored-state-effects";

/** A marker precedes every profile-created row, so a crash cannot orphan an executable agent. */
export class ProfileCreationRecovery {
  constructor(
    private readonly root: string,
    private readonly workspaces: string,
  ) {}

  begin = Effect.fn("ProfileCreationRecovery.begin")(function* (
    this: ProfileCreationRecovery,
    agentId: string,
    operationId: string,
  ) {
    if (!isGeneratedAgentId(agentId) || !isUuidV4(operationId))
      return yield* new StoredStateFailure({ cause: new Error("Invalid profile creation identity.") });
    yield* storedIO(() => mkdir(this.root, { recursive: true, mode: 0o700 }));
    // Both identities live in the filename: interruption of the write cannot leave a partial payload.
    yield* storedIO(() =>
      writeFile(join(this.root, `${agentId}.${operationId}.pending`), "", { flag: "wx", mode: 0o600 }),
    );
  }, Effect.uninterruptible);

  recover = Effect.fn("ProfileCreationRecovery.recover")(function* (
    this: ProfileCreationRecovery,
    database: OpenBotDatabase,
    removeAgent: (agentId: string) => Effect.Effect<void, StoredStateFailure>,
  ) {
    yield* storedIO(() => mkdir(this.root, { recursive: true, mode: 0o700 }));
    for (const entry of yield* storedIO(() => readdir(this.root, { withFileTypes: true }))) {
      if (!entry.isFile()) continue;
      const [agentId, operationId, suffix, extra] = entry.name.split(".");
      if (
        agentId === undefined ||
        operationId === undefined ||
        suffix !== "pending" ||
        extra !== undefined ||
        !isGeneratedAgentId(agentId) ||
        !isUuidV4(operationId)
      )
        continue;
      const receipt = yield* storedSync(() => database.commandResult(`agent-profile:${operationId}`));
      const exists = yield* storedSync(() => database.listAgents().some((agent) => agent.id === agentId));
      if (receipt !== undefined && exists) {
        if ((yield* storedSync(() => decodeSaveAgentProfileResult(receipt))).agent.id !== agentId)
          return yield* new StoredStateFailure({
            cause: new Error("Profile creation receipt does not match its agent."),
          });
      } else {
        if (exists) yield* removeAgent(agentId);
        // Also covers a crash after mkdir but before the row was persisted. Never trust a stored path.
        yield* storedIO(() => rm(join(this.workspaces, agentId), { recursive: true, force: true }));
      }
      // Keep the marker through a successful save until recovery observes its committed receipt.
      // Failed cleanup also leaves it available for the next startup to retry.
      yield* storedIO(() => rm(join(this.root, entry.name), { force: true }));
    }
  }, Effect.uninterruptible);
}
