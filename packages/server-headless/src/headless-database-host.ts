// headless-database-host: replaces utilityProcess.fork of
// src/main/agent-database-host-process.ts:17 with a Bun/Node child process running the
// same agent-database-host entry. The frozen line protocol is
// src/backend/agent-data/agent-database-protocol.ts; the supervisor contract is in
// agent-database-supervisor.ts.
//
// TODO (not implemented): the packaged app ships agent-database-host as part of the
// Electron build; under Bun we fork the source entry directly and pass the protocol
// over stdio, exactly as the desktop host does. Blocked on verifying which compiled
// entry exists in the release tree and on node:sqlite behavior under Bun/arm64.

export interface SpawnAgentDatabaseHost {
  (options: { entry: string; userData: string }): { pid: number; send(message: unknown): void; on(event: string, listener: (...args: never[]) => void): void };
}

export const spawnAgentDatabaseHostBun: SpawnAgentDatabaseHost = (options) => {
  // TODO: Bun.spawn([bun, options.entry], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OPENBOT_AGENT_DATA: options.userData } })
  throw new Error("headless database host spawn not implemented yet (see TODO in this file)");
};
