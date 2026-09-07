import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeSaveAgentProfileResult } from "@openbot/contracts/ipc";
import { isGeneratedAgentId, isUuidV4 } from "@openbot/contracts/validation";
import type { OpenBotDatabase } from "../openbot-database";

/** A marker precedes every profile-created row, so a crash cannot orphan an executable agent. */
export class ProfileCreationRecovery {
  constructor(
    private readonly root: string,
    private readonly workspaces: string,
  ) {}

  async begin(agentId: string, operationId: string): Promise<void> {
    if (!isGeneratedAgentId(agentId) || !isUuidV4(operationId)) throw new Error("Invalid profile creation identity.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Both identities live in the filename: interruption of the write cannot leave a partial payload.
    await writeFile(join(this.root, `${agentId}.${operationId}.pending`), "", { flag: "wx", mode: 0o600 });
  }

  async recover(database: OpenBotDatabase, removeAgent: (agentId: string) => Promise<void>): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const [agentId, operationId, suffix, extra] = entry.name.split(".");
      if (suffix !== "pending" || extra !== undefined || !isGeneratedAgentId(agentId) || !isUuidV4(operationId))
        continue;
      const receipt = database.commandResult(`agent-profile:${operationId}`);
      const exists = database.listAgents().some((agent) => agent.id === agentId);
      if (receipt !== undefined && exists) {
        if (decodeSaveAgentProfileResult(receipt).agent.id !== agentId)
          throw new Error("Profile creation receipt does not match its agent.");
      } else {
        if (exists) await removeAgent(agentId);
        // Also covers a crash after mkdir but before the row was persisted. Never trust a stored path.
        await rm(join(this.workspaces, agentId), { recursive: true, force: true });
      }
      // Keep the marker through a successful save until recovery observes its committed receipt.
      // Failed cleanup also leaves it available for the next startup to retry.
      await rm(join(this.root, entry.name), { force: true });
    }
  }
}
