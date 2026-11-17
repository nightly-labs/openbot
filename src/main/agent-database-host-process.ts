// How the packaged app starts the database host.
//
// It is an Electron `utilityProcess` rather than a child `node`: the app ships the
// `runAsNode: false` fuse, so `process.execPath` cannot be run as Node, and that fuse is part of the
// trust boundary -- it must not be relaxed to make a feature easier to build.
//
// `kill()` has to end a process that is wedged inside `sqlite3_step` and will never reach a signal
// handler. It can, because the host installs no signal listener of its own, so the default
// disposition applies and the kernel ends the process whatever it is doing.

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
/** `SQLITE_CORRUPT` and `SQLITE_NOTADB`. */
const DAMAGED_FILE_CODES = new Set([11, 26]);

/**
 * Enough for the error that stopped a start, such as a module that did not load. Below the 2,000
 * characters that the logger keeps of one value, with its "Its last output: " prefix.
 */
const OUTPUT_TAIL_CHARS = 1_900;

export function spawnAgentDatabaseHost(): AgentDatabaseHostProcess {
  const child = utilityProcess.fork(join(__dirname, "agent-database-host.js"), [], {
    serviceName: "OpenBot databases",
    // Only stderr, for the log when the host does not start (#10463).
    stdio: ["ignore", "ignore", "pipe"],
  });
  let output = "";
  // Always read: a full pipe would stop the host at its next write to stderr.
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

/**
 * Runs the start check of `openbot.db` after a stop that did not close it, in a host of its own, so
 * the main thread stays free while the check reads the whole file. Gives the lines of the check, or
 * null when the host could not start or run it; the caller then runs the check itself. The check has
 * no deadline: a large file can take minutes. The host ends with the check, or when the app quits.
 */
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
        // The check stopped on a damaged page or header: that is its result, not a failure to run it.
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
