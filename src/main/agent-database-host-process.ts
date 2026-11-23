import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { utilityProcess } from "electron";
import {
  AGENT_DATABASE_LIMITS,
  type AgentDatabaseHostMessage,
  type AgentDatabaseHostProcess,
} from "../backend/agent-data/agent-database-protocol";

const logger = createOpenBotLogger("database-check");
const DAMAGED_FILE_CODES = new Set([11, 26]);

const OUTPUT_TAIL_CHARS = 1_900;

export function spawnAgentDatabaseHost(): AgentDatabaseHostProcess {
  const child = utilityProcess.fork(join(__dirname, "agent-database-host.js"), [], {
    serviceName: "OpenBot databases",
    stdio: ["ignore", "ignore", "pipe"],
  });
  let output = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
  });
  return {
    send: (request) => child.postMessage(request),
    onMessage: (listener) => {
      child.on("message", (message: AgentDatabaseHostMessage) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", (code) => listener(code));
    },
    recentOutput: () => output.trim(),
    kill: () => {
      child.kill();
    },
  };
}

export function checkDatabaseIntegrityInHost(databasePath: string): Effect.Effect<readonly unknown[] | null> {
  return Effect.callback<readonly unknown[] | null>((resume) => {
    let host: AgentDatabaseHostProcess;
    try {
      host = spawnAgentDatabaseHost();
    } catch (error) {
      logger.warn("Could not start the database check process.", toLogValue(error));
      resume(Effect.succeed(null));
      return;
    }
    let settled = false;
    const settle = (problems: readonly unknown[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(startDeadline);
      host.kill();
      resume(Effect.succeed(problems));
    };
    const startDeadline = setTimeout(() => {
      logger.warn("The database check process did not start in time.");
      settle(null);
    }, AGENT_DATABASE_LIMITS.hostStartDeadlineMs);
    host.onMessage((message) => {
      if ("kind" in message) {
        clearTimeout(startDeadline);
        host.send({ kind: "integrity-check", id: 1, databasePath });
      } else if (message.ok) {
        settle(message.result.rows.map((row) => row[0]));
      } else if (DAMAGED_FILE_CODES.has((message.failure.sqliteCode ?? 0) & 0xff)) {
        settle([message.failure.message]);
      } else {
        logger.warn("The database check process could not run the check.", message.failure);
        settle(null);
      }
    });
    host.onExit(() => {
      if (!settled) logger.warn("The database check process stopped before the check ended.");
      settle(null);
    });
    return Effect.sync(() => settle(null));
  });
}
