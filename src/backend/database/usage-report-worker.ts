import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { type HostAnalyticsInput, parseHostAnalyticsInput } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { readUsageReport } from "./usage-report";

const BUSY_TIMEOUT_MS = 5_000;

function readRequest(value: unknown): { databasePath: string; input: HostAnalyticsInput } {
  if (!isDynamicRecord(value) || typeof value.databasePath !== "string")
    throw new Error("The usage report worker received no database path.");
  return { databasePath: value.databasePath, input: parseHostAnalyticsInput(value.input) };
}

const request = readRequest(workerData);
const connection = new DatabaseSync(request.databasePath, { readOnly: true });
try {
  connection.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  parentPort?.postMessage(readUsageReport(connection, request.input));
} finally {
  connection.close();
}
